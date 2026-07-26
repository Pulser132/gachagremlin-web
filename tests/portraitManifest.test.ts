import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HSR_PORTRAIT_NAMES } from '../src/data/wishes/portraits/hsr.ts';

const names = [...HSR_PORTRAIT_NAMES];

describe('HSR_PORTRAIT_NAMES', () => {
  it('covers both categories the wiki hosts icons for', () => {
    // 103 character + 166 Light Cone real uploads at time of generation, plus
    // the redirect sweep's alternate spellings.
    expect(names.length).toBeGreaterThan(250);
    expect(HSR_PORTRAIT_NAMES.has('Kafka')).toBe(true);
    expect(HSR_PORTRAIT_NAMES.has('Nowhere to Run')).toBe(true);
  });

  it('is sorted, so a rerun with no wiki change produces an empty diff', () => {
    expect(names).toEqual([...names].sort());
  });

  it('is duplicate-free', () => {
    // A Set can't hold duplicates, so this only bites if the generated source
    // itself lists a name twice — which would silently shrink the file's
    // apparent size against the sweep's count.
    const source = readFileSync(new URL('../src/data/wishes/portraits/hsr.ts', import.meta.url), 'utf8');
    const listed = source.split('\n').filter((line) => /^ {2}['"]/.test(line));
    expect(listed.length).toBe(names.length);
  });

  it('stores names verbatim — trimmed, NFC, punctuation intact', () => {
    for (const name of names) {
      expect(name).toBe(name.trim());
      expect(name).toBe(name.normalize('NFC'));
      expect(name).not.toBe('');
    }
  });

  it('carries the punctuated in-game spellings only the redirect sweep can see', () => {
    // `allimages` lists real uploads, which have the colon/question mark
    // stripped; these titles exist on the wiki only as file redirects.
    expect(HSR_PORTRAIT_NAMES.has('Ninja Record: Sound Hunt')).toBe(true);
    expect(HSR_PORTRAIT_NAMES.has('Ninjutsu Inscription: Dazzling Evilbreaker')).toBe(true);
    expect(HSR_PORTRAIT_NAMES.has('What Is Real?')).toBe(true);
  });

  it('keeps the exact bytes a name arrives with, bullet and ASCII apostrophe included', () => {
    expect(HSR_PORTRAIT_NAMES.has('Dan Heng • Imbibitor Lunae')).toBe(true);
    expect(HSR_PORTRAIT_NAMES.has("It's Showtime")).toBe(true);
    expect(HSR_PORTRAIT_NAMES.has('It’s Showtime')).toBe(false); // smart quote is a different name
  });
});

describe('the generator and the build', () => {
  it('is never invoked by a build — a build must not touch the network', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts['gen:portraits']).toBe('tsx scripts/portraits.ts');
    for (const [name, script] of Object.entries(pkg.scripts as Record<string, string>)) {
      if (name === 'gen:portraits') continue;
      expect(script).not.toMatch(/portraits/);
    }
  });
});
