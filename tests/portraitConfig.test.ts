import { describe, expect, it } from 'vitest';
import { PORTRAIT_CONFIGS } from '../src/data/wishes/portraits/config.ts';

const hsr = PORTRAIT_CONFIGS.hsr!;
const url = (name: string, kind: 'character' | 'lightcone') => hsr.urlForName(name, kind);

describe('hsr urlForName', () => {
  it('derives a full CDN URL from a plain name with no API call', () => {
    expect(url('Kafka', 'character')).toBe(
      'https://static.wikia.nocookie.net/houkai-star-rail/images/8/8c/Character_Kafka_Icon.png' +
        '/revision/latest/scale-to-width-down/64',
    );
  });

  it('uses the Light Cone file prefix for light cones', () => {
    expect(url('Nowhere to Run', 'lightcone')).toContain('/Light_Cone_Nowhere_to_Run_Icon.png/');
  });

  it('serves both surfaces from one width-64 thumbnail shape', () => {
    expect(url('Kafka', 'character')).toMatch(/\/revision\/latest\/scale-to-width-down\/64$/);
  });

  it('points at the CDN path segment, never the wiki host', () => {
    const derived = url('Kafka', 'character');
    expect(derived).toContain('/houkai-star-rail/');
    expect(derived).not.toContain('honkai-star-rail');
  });

  it('strips a colon before hashing, because the stored upload has no colon', () => {
    // The punctuated title is an editor-made redirect; hashing the colon in
    // gives 2/23, which is a 404. Regression test for the #4 formula bug.
    const derived = url('Ninja Record: Sound Hunt', 'lightcone');
    expect(derived).toContain('/images/8/88/');
    expect(derived).not.toContain('/images/2/23/');
    expect(derived).toContain('/Light_Cone_Ninja_Record_Sound_Hunt_Icon.png/');
  });

  it('strips a question mark the same way', () => {
    const derived = url('What Is Real?', 'lightcone');
    expect(derived).toContain('/Light_Cone_What_Is_Real_Icon.png/');
    expect(derived).not.toContain('%3F');
  });

  it('hashes a bullet as UTF-8 bytes', () => {
    const derived = url('Dan Heng • Imbibitor Lunae', 'character');
    expect(derived).toContain('/images/2/2a/');
    expect(derived).toContain('/Character_Dan_Heng_%E2%80%A2_Imbibitor_Lunae_Icon.png/');
  });

  it('percent-encodes the characters encodeURIComponent leaves alone but MediaWiki emits encoded', () => {
    // Measured live: the CDN serves identical bytes for a literal `!` or `'`,
    // so this matches MediaWiki's own spelling rather than fixing a 404.
    expect(url('Woof! Walk Time!', 'lightcone')).toContain('/Light_Cone_Woof%21_Walk_Time%21_Icon.png/');
    expect(url("It's Showtime", 'lightcone')).toContain('/Light_Cone_It%27s_Showtime_Icon.png/');
  });

  it('escapes an ampersand rather than leaving it to read as a query separator', () => {
    expect(url('Rock & Roll', 'lightcone')).toContain('_Rock_%26_Roll_Icon.png');
  });

  it('refuses a category it has no file prefix for rather than guessing one', () => {
    expect(() => hsr.urlForName('Some Weapon', 'weapon')).toThrow(/weapon/);
  });
});

describe('PORTRAIT_CONFIGS', () => {
  it('configures prefixes only for the categories HSR hosts icons for', () => {
    expect(Object.keys(hsr.filePrefixes).sort()).toEqual(['character', 'lightcone']);
    expect(hsr.filePrefixes.weapon).toBeUndefined();
    expect(hsr.filePrefixes.wengine).toBeUndefined();
    expect(hsr.filePrefixes.bangboo).toBeUndefined();
    expect(hsr.filePrefixes.unknown).toBeUndefined();
  });

  it('leaves games with no portrait support entirely unconfigured', () => {
    // `Partial<Record<GameKey, …>>` is what makes "Genshin and ZZZ render
    // exactly as they do today" a type-level fact rather than a convention.
    expect(PORTRAIT_CONFIGS.genshin).toBeUndefined();
    expect(PORTRAIT_CONFIGS.zzz).toBeUndefined();
  });
});
