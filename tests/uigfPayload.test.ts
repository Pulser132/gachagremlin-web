import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseUigfPayload } from '../src/data/wishes/uigf.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'wishes');

function load(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

describe('parseUigfPayload', () => {
  it('converts a Genshin (hk4e) export, including the 400 second-banner gacha_type', () => {
    const result = parseUigfPayload(load('uigf-genshin.json'), 'genshin');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payloads).toHaveLength(1);
    const [payload] = result.payloads;
    expect(payload.game).toBe('genshin');
    expect(payload.uid).toBe('800000099');
    expect(payload.region).toBe('en-us');
    expect(payload.items).toHaveLength(3);
    expect(payload.items.map((i) => i.bannerType)).toEqual(['301', '400', '200']);
    expect(payload.items[0]).toMatchObject({ name: 'Klee', rank: '5', itemType: 'Character' });
  });

  it('converts an HSR (hkrpg) export', () => {
    const result = parseUigfPayload(load('uigf-hsr.json'), 'hsr');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payloads[0].uid).toBe('600000088');
    expect(result.payloads[0].items).toHaveLength(2);
    expect(result.payloads[0].items[0]).toMatchObject({ name: 'Robin', rank: '5', bannerType: '11' });
  });

  it('remaps ZZZ (nap) rank_type 2/3/4 (B/A/S) onto the 3/4/5 scale used everywhere else', () => {
    const result = parseUigfPayload(load('uigf-zzz.json'), 'zzz');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = result.payloads[0].items;
    expect(items.find((i) => i.name === 'Evelyn')?.rank).toBe('5'); // raw 4 (S) -> 5
    expect(items.find((i) => i.name === 'Steel Cushion')?.rank).toBe('4'); // raw 3 (A) -> 4
    expect(items.find((i) => i.name === 'Type III')?.rank).toBe('3'); // raw 2 (B) -> 3
  });

  it('returns one payload per account for a multi-account file', () => {
    const result = parseUigfPayload(load('uigf-genshin-multi.json'), 'genshin');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payloads).toHaveLength(2);
    expect(result.payloads.map((p) => p.uid)).toEqual(['800000001', '800000002']);
  });

  it('rejects a file with no data for the requested game', () => {
    const result = parseUigfPayload(load('uigf-genshin.json'), 'hsr');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no.*honkai.*star rail.*data/i);
  });

  it('rejects a pre-v4 UIGF version with a clear message', () => {
    const payload = JSON.parse(load('uigf-genshin.json'));
    payload.info.version = 'v3.0';
    const result = parseUigfPayload(JSON.stringify(payload), 'genshin');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/uigf v4/i);
    expect(result.error).toMatch(/v3\.0/);
  });

  it('rejects a record missing a name', () => {
    const payload = JSON.parse(load('uigf-genshin.json'));
    delete payload.hk4e[0].list[0].name;
    const result = parseUigfPayload(JSON.stringify(payload), 'genshin');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/missing item names/i);
  });

  it('rejects a record missing rank_type', () => {
    const payload = JSON.parse(load('uigf-genshin.json'));
    delete payload.hk4e[0].list[0].rank_type;
    const result = parseUigfPayload(JSON.stringify(payload), 'genshin');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/missing rarity data/i);
  });

  it('rejects malformed JSON', () => {
    const result = parseUigfPayload('{not json', 'genshin');
    expect(result.ok).toBe(false);
  });

  it('rejects a file with no "info" block', () => {
    const result = parseUigfPayload(JSON.stringify({ hk4e: [] }), 'genshin');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/info/i);
  });
});
