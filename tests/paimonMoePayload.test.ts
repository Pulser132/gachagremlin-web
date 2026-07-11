import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { looksLikePaimonMoeLocalData, parsePaimonMoeLocalData } from '../src/data/wishes/paimonMoe.ts';
import { parseAnyImport } from '../src/data/wishes/payload.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'wishes');

function load(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

describe('looksLikePaimonMoeLocalData', () => {
  it('recognizes a real paimon.moe backup shape', () => {
    expect(looksLikePaimonMoeLocalData(JSON.parse(load('paimon-moe-local-data.json')))).toBe(true);
  });

  it('rejects unrelated JSON', () => {
    expect(looksLikePaimonMoeLocalData({ foo: 'bar' })).toBe(false);
    expect(looksLikePaimonMoeLocalData(null)).toBe(false);
    expect(looksLikePaimonMoeLocalData([])).toBe(false);
  });

  it('requires at least one wish-counter-* key, not just wish-uid', () => {
    expect(looksLikePaimonMoeLocalData({ 'wish-uid': '123' })).toBe(false);
  });
});

describe('parsePaimonMoeLocalData', () => {
  it('converts the fixture into a single Genshin payload with every banner’s pulls', () => {
    const result = parsePaimonMoeLocalData(load('paimon-moe-local-data.json'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payloads).toHaveLength(1);
    const [payload] = result.payloads;
    expect(payload.game).toBe('genshin');
    expect(payload.uid).toBe('630164299');
    expect(payload.region).toBe('America');
    // 1 (beginners) + 2 (standard) + 3 (character-event) + 1 (weapon-event) + 1 (chronicled) = 8;
    // wish-counter-setting must NOT be treated as a pull source.
    expect(payload.items).toHaveLength(8);
  });

  it('resolves item slugs to display names and rarities via the built-in item database', () => {
    const result = parsePaimonMoeLocalData(load('paimon-moe-local-data.json'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = result.payloads[0].items;
    expect(items.find((i) => i.name === 'Jean')).toMatchObject({ rank: '5', bannerType: '200', itemType: 'Character' });
    expect(items.find((i) => i.name === 'Hu Tao')).toMatchObject({ rank: '5', bannerType: '301', itemType: 'Character' });
    expect(items.find((i) => i.name === 'Diona')).toMatchObject({ rank: '4', bannerType: '301' });
    expect(items.find((i) => i.name === 'Emerald Orb')).toMatchObject({ rank: '3', itemType: 'Weapon' });
  });

  it('synthesizes unique, chronologically-sortable ids since the source has none', () => {
    const result = parsePaimonMoeLocalData(load('paimon-moe-local-data.json'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = result.payloads[0].items;
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    for (const id of ids) expect(id).toMatch(/^\d{19}$/); // fixed-width, sorts alongside real API ids

    // Within the character-event banner, pulls should stay in their
    // original chronological order (raven_bow -> diona -> hu_tao).
    const charEventIds = items.filter((i) => i.bannerType === '301').map((i) => i.id);
    expect([...charEventIds].sort()).toEqual(charEventIds);
  });

  it('rejects a file referencing an item id not in the built-in database', () => {
    const payload = JSON.parse(load('paimon-moe-local-data.json'));
    payload['wish-counter-standard'].pulls.push({ type: 'character', code: '200', id: 'some_future_character', time: '2026-01-01 00:00:00', pity: 1 });
    const result = parsePaimonMoeLocalData(JSON.stringify(payload));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/some_future_character/);
  });

  it('rejects malformed JSON', () => {
    const result = parsePaimonMoeLocalData('{not json');
    expect(result.ok).toBe(false);
  });

  it('rejects a file that isn’t a paimon.moe backup', () => {
    const result = parsePaimonMoeLocalData(JSON.stringify({ hello: 'world' }));
    expect(result.ok).toBe(false);
  });
});

describe('parseAnyImport routing for paimon.moe backups', () => {
  it('imports a paimon.moe backup when the dialog is scoped to Genshin', () => {
    const result = parseAnyImport(load('paimon-moe-local-data.json'), 'genshin');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payloads[0].uid).toBe('630164299');
  });

  it('explains that HSR import from another tracker’s backup isn’t supported yet', () => {
    const result = parseAnyImport(load('paimon-moe-local-data.json'), 'hsr');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/genshin/i);
    expect(result.error).toMatch(/not supported yet|isn't supported yet/i);
  });

  it('explains that ZZZ import from another tracker’s backup isn’t supported yet', () => {
    const result = parseAnyImport(load('paimon-moe-local-data.json'), 'zzz');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/genshin/i);
  });
});
