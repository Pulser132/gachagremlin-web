import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAnyImport, parsePayload } from '../src/data/wishes/payload.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'wishes');

function load(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

describe('parsePayload', () => {
  it.each([
    ['genshin', 'genshin.json'],
    ['hsr', 'hsr.json'],
    ['zzz', 'zzz.json'],
  ] as const)('accepts a valid %s fixture payload', (game, file) => {
    const result = parsePayload(load(file), game);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.game).toBe(game);
      expect(result.payload.items.length).toBeGreaterThan(0);
    }
  });

  it('rejects malformed JSON', () => {
    const result = parsePayload('{not json', 'genshin');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/valid JSON/i);
  });

  it('rejects a payload for the wrong game', () => {
    const result = parsePayload(load('hsr.json'), 'genshin');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/hsr.*genshin/i);
  });

  it('rejects a payload with an unrecognized game field', () => {
    const result = parsePayload(JSON.stringify({ game: 'wuwa', uid: '1', region: 'x', exportedAt: 1, items: [] }), 'genshin');
    expect(result.ok).toBe(false);
  });

  it('rejects a payload missing uid', () => {
    const payload = JSON.parse(load('genshin.json'));
    delete payload.uid;
    const result = parsePayload(JSON.stringify(payload), 'genshin');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/uid/i);
  });

  it('rejects a payload with no items', () => {
    const payload = JSON.parse(load('genshin.json'));
    payload.items = [];
    const result = parsePayload(JSON.stringify(payload), 'genshin');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no pulls/i);
  });

  it('rejects a payload with a malformed item', () => {
    const payload = JSON.parse(load('genshin.json'));
    payload.items[0].rank = 'legendary';
    const result = parsePayload(JSON.stringify(payload), 'genshin');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/malformed/i);
  });

  it('rejects a top-level array', () => {
    const result = parsePayload('[]', 'genshin');
    expect(result.ok).toBe(false);
  });
});

describe('parseAnyImport', () => {
  it('routes a native script payload through parsePayload, wrapped in a one-element array', () => {
    const result = parseAnyImport(load('genshin.json'), 'genshin');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payloads).toHaveLength(1);
    expect(result.payloads[0].uid).toBe('800000001');
  });

  it('routes a UIGF export (detected via the "info" key) through the UIGF converter', () => {
    const result = parseAnyImport(load('uigf-genshin.json'), 'genshin');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payloads).toHaveLength(1);
    expect(result.payloads[0].uid).toBe('800000099');
  });

  it('surfaces the native parser’s error for non-UIGF, non-native JSON', () => {
    const result = parseAnyImport(JSON.stringify({ foo: 'bar' }), 'genshin');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/game/i);
  });

  it('rejects malformed JSON before attempting either format', () => {
    const result = parseAnyImport('{not json', 'genshin');
    expect(result.ok).toBe(false);
  });
});
