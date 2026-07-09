import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getGame } from '../src/data/wiki/games.ts';
import { normalizeNewlines, parseInfobox, sectionBullets } from '../src/data/wiki/parser.ts';
import {
  findWalltimes,
  isGlobalTime,
  perServer,
  statusOf,
  toUnix,
  type Walltime,
} from '../src/data/wiki/times.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');

function load(name: string): string {
  return normalizeNewlines(readFileSync(join(FIXTURES, name), 'utf-8'));
}

// Worked example from the skills' discord-time.md / bot test suite:
// 2026/08/11 03:59 server-local.
const END: Walltime = [2026, 8, 11, 3, 59];
const END_UNIX = { America: 1786438740, Europe: 1786417140, Asia: 1786391940, SAR: 1786391940 };

describe('toUnix', () => {
  it('matches the worked example across regions', () => {
    expect(toUnix(...END, -5)).toBe(END_UNIX.America);
    expect(toUnix(...END, 1)).toBe(END_UNIX.Europe);
    expect(toUnix(...END, 8)).toBe(END_UNIX.Asia);
  });
});

describe('perServer', () => {
  it('computes all four Genshin regions', () => {
    const result = perServer(END, getGame('genshin').servers);
    expect(result).toEqual(END_UNIX);
    expect(result!.Asia).toBe(result!.SAR);
  });

  it('computes three HSR regions (no SAR)', () => {
    const result = perServer(END, getGame('hsr').servers);
    expect(Object.keys(result!).sort()).toEqual(['America', 'Asia', 'Europe']);
  });

  it('returns null for a null walltime', () => {
    expect(perServer(null, getGame('genshin').servers)).toBeNull();
  });
});

describe('findWalltimes', () => {
  it('prefers the Duration line over infobox fields', () => {
    const bullets = ['2026/07/01 10:00 – 2026/08/11 03:59'];
    const fields = { time_start: '2099-01-01 00:00:00', time_end: '2099-01-02 00:00:00' };
    const [start, end] = findWalltimes(fields, bullets);
    expect(start).toEqual([2026, 7, 1, 10, 0]);
    expect(end).toEqual([2026, 8, 11, 3, 59]);
  });

  it('falls back to the infobox start when only an end date is displayed', () => {
    const bullets = ['After the Version "Luna VIII" update – 2026/08/11 03:59'];
    const fields = { time_start: '2026-07-01 11:00:00' };
    const [start, end] = findWalltimes(fields, bullets);
    expect(end).toEqual([2026, 8, 11, 3, 59]);
    expect(start).toEqual([2026, 7, 1, 11, 0]);
  });

  it('returns [null, null] when nothing is present', () => {
    expect(findWalltimes({}, [])).toEqual([null, null]);
  });

  it('matches the Fontinalia fixture end-to-end', () => {
    const wt = load('genshin_Sunny_Summer_Fontinalia__Event.wikitext');
    const fields = parseInfobox(wt);
    const [, end] = findWalltimes(fields, sectionBullets(wt, 'Duration'));
    expect(end).toEqual([2026, 8, 11, 3, 59]);
    expect(perServer(end, getGame('genshin').servers)).toEqual(END_UNIX);
  });
});

describe('isGlobalTime', () => {
  it('flags web/login types, not in-game', () => {
    expect(isGlobalTime('Web')).toBe(true);
    expect(isGlobalTime('Login Event')).toBe(true);
    expect(isGlobalTime('In-Game')).toBe(false);
    expect(isGlobalTime('')).toBe(false);
  });

  it('flags the Return to Ridu fixture as global', () => {
    const wt = load('zzz_Return_to_Ridu__Together_in_a_New_Chapter.wikitext');
    const fields = parseInfobox(wt);
    expect(isGlobalTime(fields.type ?? '')).toBe(true);
  });
});

describe('statusOf', () => {
  const end = { America: 2000, Asia: 1500 };
  const start = { America: 1000, Asia: 500 };

  it('is upcoming before the first region starts', () => {
    expect(statusOf(start, end, 100)).toBe('upcoming');
  });

  it('is active once any region has started', () => {
    expect(statusOf(start, end, 700)).toBe('active');
    expect(statusOf(start, end, 1800)).toBe('active'); // Asia ended, America live
  });

  it('is ended once the last region finishes', () => {
    expect(statusOf(start, end, 2001)).toBe('ended');
  });

  it('is active with no start info (not ended)', () => {
    expect(statusOf(null, end, 100)).toBe('active');
  });

  it('is unknown with no end info', () => {
    expect(statusOf(start, null, 100)).toBe('unknown');
  });
});
