import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { categorizeEvent, EVENT_CATEGORIES, isEventCategory } from '../src/data/eventCategories.ts';
import { normalizeNewlines, parseInfobox } from '../src/data/wiki/parser.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');

function load(name: string): string {
  return normalizeNewlines(readFileSync(join(FIXTURES, name), 'utf-8'));
}

describe('categorizeEvent', () => {
  // Every `type` value observed on the wikis, plus empty and unknown.
  it.each([
    ['In-Game', 'ingame'],
    ['Web', 'web'],
    ['Login', 'web'],
    ['Community', 'other'],
    ['In-Person', 'other'],
    ['Test Run', 'ingame'],
    ['Collaboration', 'other'],
    ['', 'ingame'],
    ['Some Future Type', 'other'],
  ])('classifies %j as %s', (type, expected) => {
    expect(categorizeEvent({ type })).toBe(expected);
  });

  it('checks web before in-game, so "Web Event" never misfiles', () => {
    expect(categorizeEvent({ type: 'Web Event' })).toBe('web');
    expect(categorizeEvent({ type: 'In-Game Web Promo' })).toBe('web');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(categorizeEvent({ type: '  IN-GAME  ' })).toBe('ingame');
    expect(categorizeEvent({ type: 'special' })).toBe('other');
  });
});

describe('EVENT_CATEGORIES', () => {
  it('fixes render order In Game, Web, Other', () => {
    expect(EVENT_CATEGORIES.map((c) => c.key)).toEqual(['ingame', 'web', 'other']);
    expect(EVENT_CATEGORIES.map((c) => c.label)).toEqual(['In Game', 'Web', 'Other']);
  });

  it('isEventCategory accepts exactly the known keys', () => {
    expect(isEventCategory('web')).toBe(true);
    expect(isEventCategory('bogus')).toBe(false);
    expect(isEventCategory(undefined)).toBe(false);
  });
});

describe('fixture spot checks through parseInfobox', () => {
  it.each([
    ['genshin_Sunny_Summer_Fontinalia__Event.wikitext', 'ingame'],
    ['zzz_Return_to_Ridu__Together_in_a_New_Chapter.wikitext', 'web'],
    ['zzz_ChaPanda_x_Zenless_Zone_Zero.wikitext', 'other'],
  ])('%s → %s', (fixture, expected) => {
    const fields = parseInfobox(load(fixture));
    expect(categorizeEvent({ type: fields.type ?? '' })).toBe(expected);
  });
});
