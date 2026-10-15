import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGolden, GOLDEN_PATH, serializeGolden } from '../scripts/parityGolden.ts';

describe('events parity golden', () => {
  it('is deterministic', () => {
    expect(serializeGolden(buildGolden())).toBe(serializeGolden(buildGolden()));
  });

  it("matches the checked-in golden file the bot pins (run `npm run gen:parity` after a deliberate parser change)", () => {
    const pinned = readFileSync(GOLDEN_PATH, 'utf-8').replace(/\r\n/g, '\n');
    expect(serializeGolden(buildGolden())).toBe(pinned);
  });

  it('covers each game and the awkward shapes', () => {
    const { events } = buildGolden();
    expect(new Set(events.map((e) => e.game))).toEqual(new Set(['genshin', 'hsr', 'zzz']));
    expect(events.some((e) => e.globalTime)).toBe(true);
    expect(events.some((e) => e.endUnix === null)).toBe(true);
    const keys = events.map((e) => e.eventKey);
    expect(new Set(keys).size).toBeLessThan(keys.length); // a rerun: two pages, one eventKey
    expect(new Set(events.map((e) => e.status)).size).toBeGreaterThan(1);
  });
});
