import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clean,
  cleanEventName,
  getDescription,
  normalizeNewlines,
  parseIndex,
  parseInfobox,
  sectionBullets,
} from '../src/data/wiki/parser.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');

// Fixtures were saved via Python's write_text on Windows, which translated
// \n -> \r\n; normalize the same way fetch.ts normalizes live API responses.
function load(name: string): string {
  return normalizeNewlines(readFileSync(join(FIXTURES, name), 'utf-8'));
}

describe('parseIndex', () => {
  it.each([
    ['genshin', 'Sunny Summer Fontinalia (Event)'],
    ['hsr', 'Pixel Plane Rumble'],
    ['zzz', 'Tales of the Hobbling Crow'],
  ])('finds current events for %s', (game, knownCurrent) => {
    const sections = parseIndex(load(`${game}_index.html`));
    expect(sections.current).toContain(knownCurrent);
    expect(sections.current.length).toBeGreaterThanOrEqual(5);
    expect(sections.upcoming.length).toBeGreaterThan(0);
  });

  it('excludes utility links', () => {
    for (const game of ['genshin', 'hsr', 'zzz']) {
      const sections = parseIndex(load(`${game}_index.html`));
      for (const title of [...sections.current, ...sections.upcoming]) {
        expect(title).not.toMatch(/^(File|Category|Special|Help|Template):/);
        expect(['Event/History', 'Events/History']).not.toContain(title);
      }
    }
  });

  it('deduplicates', () => {
    const sections = parseIndex(load('genshin_index.html'));
    expect(new Set(sections.current).size).toBe(sections.current.length);
  });
});

describe('parseInfobox / event page parsing', () => {
  it('parses the Fontinalia infobox', () => {
    const wt = load('genshin_Sunny_Summer_Fontinalia__Event.wikitext');
    const fields = parseInfobox(wt);
    expect(clean(fields.name)).toBe('Sunny Summer Fontinalia');
    expect(fields.type).toBe('In-Game');
    expect(fields.rewardType).toBe('Character');
    expect(clean(fields.reward)).toContain('Charlotte');
    expect(getDescription(wt, fields)).toBeTruthy();
    const reqs = sectionBullets(wt, 'Requirements');
    expect(reqs).toContain('Adventure Rank 20 or above');
    const duration = sectionBullets(wt, 'Duration');
    expect(duration.some((d) => d.includes('2026/08/11'))).toBe(true);
  });

  it('matches the exact template name only', () => {
    expect(parseInfobox('{{Event Tabs}}\nno infobox here')).toEqual({});
    expect(parseInfobox('{{Event\n|name = X\n}}').name).toBe('X');
    expect(parseInfobox('{{Event Infobox\n|name = Y\n}}').name).toBe('Y');
  });

  it('handles a page with no listed times (ChaPanda collab)', async () => {
    const wt = load('zzz_ChaPanda_x_Zenless_Zone_Zero.wikitext');
    const fields = parseInfobox(wt);
    expect(Object.keys(fields).length).toBeGreaterThan(0);
    const { findWalltimes } = await import('../src/data/wiki/times.ts');
    const [, end] = findWalltimes(fields, sectionBullets(wt, 'Duration'));
    expect(end).toBeNull();
  });
});

describe('cleanEventName', () => {
  it('strips rerun date suffixes', () => {
    expect(cleanEventName('The Final Callback 2026-07-8', 'x')).toBe('The Final Callback');
    expect(cleanEventName('Ley Line Overflow/2026-08-01', 'x')).toBe('Ley Line Overflow');
  });

  it('falls back to the title when the name is empty or unresolvable', () => {
    expect(cleanEventName('', 'Fate Contract: Renewal')).toBe('Fate Contract: Renewal');
    expect(cleanEventName('{{unresolvable template}}', 'Title/2026-07-01')).toBe('Title');
  });
});

describe('getDescription', () => {
  it('ignores commented-out blocks and handles nested templates', () => {
    const wt =
      '<!--{{Description|commented-out old text}}-->\n{{Description|Real {{LL|Version "Luna VI"|x}} text}}';
    expect(getDescription(wt, {})).toBe('Real Version "Luna VI" text');
  });
});

describe('clean', () => {
  it('cleans wikitext to plain text', () => {
    expect(clean('[[Charlotte|Charlotte (Character)]]')).toBe('Charlotte (Character)');
    expect(clean('[[Charlotte]]')).toBe('Charlotte');
    expect(clean("'''bold''' and <b>html</b>")).toBe('bold and html');
    expect(clean('<!-- hidden -->visible')).toBe('visible');
  });
});
