import { describe, expect, it } from 'vitest';
import { buildSinceArg, IMPORT_QUERY_TYPES } from '../src/data/wishes/importQuery.ts';
import type { WishItem } from '../src/types.ts';

// Same fixture vocabulary as tests/wishDedupe.test.ts: '2026-01-01 00:00:00'
// parsed as UTC = 1767225600, the epoch prefix a synthetic id for that time
// embeds. A real HoYoverse id carries a day-boundary prefix instead.
const TIME = '2026-01-01 00:00:00';
const EPOCH = '1767225600';

function item(id: string, bannerType: string, overrides: Partial<WishItem> = {}): WishItem {
  return { id, bannerType, name: 'Sandrone', itemType: 'Character', rank: '5', time: TIME, ...overrides };
}

/** Real HoYoverse-style id: day-boundary epoch prefix + server sequence, 19 digits. */
const realId = (seq: string) => `1767139200${seq.padStart(9, '0')}`;
/** Current deterministic synthetic scheme: exact-second epoch + 3-digit banner code + seq. */
const synId = (seq: string, code = '301') => `${EPOCH}${code}${seq.padStart(6, '0')}`;

describe('buildSinceArg', () => {
  it('returns an empty string for an empty account', () => {
    expect(buildSinceArg('zzz', [])).toBe('');
  });

  it('emits one queryType:maxId pair per banner holding real ids, comma-joined', () => {
    const arg = buildSinceArg('zzz', [
      item(realId('10'), '1'),
      item(realId('20'), '1'),
      item(realId('5'), '2'),
    ]);
    expect(arg).toBe(`1:${realId('20')},2:${realId('5')}`);
  });

  it('omits query types whose stored items are all synthetic', () => {
    // Banner 1 has only synthetic ids (a paimon.moe-style backup import);
    // banner 2 has a real one. A synthetic watermark can sort ABOVE the real
    // id of the same physical pull and would stop paging too early, so
    // banner 1 must be omitted entirely (⇒ fully re-fetched).
    const arg = buildSinceArg('zzz', [
      item(synId('1', '100'), '1'),
      item(synId('2', '100'), '1'),
      item(realId('7'), '2'),
    ]);
    expect(arg).toBe(`2:${realId('7')}`);
  });

  it('picks the max REAL id even when a synthetic id in the same banner sorts higher', () => {
    // Same length (19), but the synthetic exact-second prefix (1767225600...)
    // lexicographically exceeds the real day-boundary prefix (1767139200...).
    const syntheticHigher = synId('999999');
    const real = realId('42');
    expect(syntheticHigher > real).toBe(true); // precondition for the case
    const arg = buildSinceArg('genshin', [item(syntheticHigher, '301'), item(real, '301')]);
    expect(arg).toBe(`301:${real}`);
  });

  it('folds Genshin 400 into the 301 watermark and never emits 400 as a key', () => {
    const arg = buildSinceArg('genshin', [
      item(realId('10'), '301'),
      item(realId('99'), '400'), // newer pull, arrived via the 301 query
    ]);
    expect(arg).toBe(`301:${realId('99')}`);
    expect(arg).not.toContain('400:');
  });

  it('max-picks with compareIds, not string or Number order', () => {
    // Different lengths: string order says '9...' > '10...', Number loses
    // precision entirely at 19 digits. compareIds (length first) must win.
    const short = '999999999'; // 9 digits — classifies as real (length ≠ 19)
    const long = '1000000000000000000'; // 19 digits but non-epoch prefix ⇒ real
    expect(short > long).toBe(true); // string order picks the wrong one
    const arg = buildSinceArg('zzz', [item(short, '1'), item(long, '1')]);
    expect(arg).toBe(`1:${long}`);
  });

  it('covers every query type the scripts fetch, per game', () => {
    // The scripts' channel lists must stay in lockstep with this table; a
    // query type missing here would silently never get a watermark.
    expect(Object.keys(IMPORT_QUERY_TYPES.genshin)).toEqual(['100', '200', '301', '302', '500']);
    expect(Object.keys(IMPORT_QUERY_TYPES.hsr)).toEqual(['1', '2', '11', '12', '21', '22']);
    expect(Object.keys(IMPORT_QUERY_TYPES.zzz)).toEqual(['1', '2', '3', '5']);
  });
});
