import { describe, expect, it } from 'vitest';
import { nameFromTitle, namesFromSweeps, planWrite, renderManifest } from '../scripts/portraits.ts';

describe('nameFromTitle', () => {
  it('recovers a name from an allimages underscored filename', () => {
    expect(nameFromTitle('Character_Kafka_Icon.png', 'Character')).toBe('Kafka');
  });

  it('recovers a name from an allpages File: title', () => {
    expect(nameFromTitle('File:Light Cone Nowhere to Run Icon.png', 'Light Cone')).toBe('Nowhere to Run');
  });

  it('keeps punctuation verbatim — the manifest key is the wiki name unchanged', () => {
    expect(nameFromTitle('File:Light Cone Ninja Record: Sound Hunt Icon.png', 'Light Cone')).toBe(
      'Ninja Record: Sound Hunt',
    );
    expect(nameFromTitle("File:Light Cone It's Showtime Icon.png", 'Light Cone')).toBe("It's Showtime");
    expect(nameFromTitle('Character_Dan_Heng_•_Imbibitor_Lunae_Icon.png', 'Character')).toBe(
      'Dan Heng • Imbibitor Lunae',
    );
  });

  it('rejects everything that is not an icon upload', () => {
    // The `Character ` prefix sweep returns ~1200 files; only ~100 are icons.
    expect(nameFromTitle('Character_Kafka_Artwork.png', 'Character')).toBeNull();
    expect(nameFromTitle('Character_Kafka_Splash.png', 'Character')).toBeNull();
    expect(nameFromTitle('File:Light Cone Nowhere to Run.png', 'Light Cone')).toBeNull();
    expect(nameFromTitle('File:Something Else Icon.png', 'Light Cone')).toBeNull();
    // The prefix alone, with no name between the bookends.
    expect(nameFromTitle('File:Character Icon.png', 'Character')).toBeNull();
  });

  it('does not mistake the Light Cone sweep for the Character one', () => {
    expect(nameFromTitle('File:Light Cone Nowhere to Run Icon.png', 'Character')).toBeNull();
  });
});

describe('namesFromSweeps', () => {
  const uploads = [
    'Light_Cone_Ninja_Record_Sound_Hunt.png',
    'Light_Cone_Ninja_Record_Sound_Hunt_Icon.png',
    'Light_Cone_Nowhere_to_Run_Icon.png',
    'Light_Cone_Nowhere_to_Run_Artwork.png',
  ];

  it('takes every icon upload', () => {
    const { icons } = namesFromSweeps('Light Cone', uploads, []);
    expect(icons).toEqual(['Ninja Record Sound Hunt', 'Nowhere to Run']);
  });

  it('recovers a punctuated spelling that redirects to a real upload', () => {
    // The whole reason the redirect sweep exists: `allimages` lists uploads
    // only, and the colon-bearing in-game title was never uploaded.
    const { spellings } = namesFromSweeps('Light Cone', uploads, [
      'File:Light Cone Ninja Record: Sound Hunt Icon.png',
    ]);
    expect(spellings).toEqual(['Ninja Record: Sound Hunt']);
  });

  it('drops a redirect whose own filename was never uploaded', () => {
    // These hash to a directory holding nothing, and Fandom's 404 decoy fires
    // `load` rather than `error` — so an unvouched name paints a placeholder
    // over the glyph instead of falling back to it.
    const { spellings } = namesFromSweeps('Light Cone', uploads, [
      'File:Light Cone Nowhere to Run (Currency Wars) Icon.png',
      'File:Light Cone Nowhere To Run Icon.png', // casing variant — a different file
      'File:Light Cone Somewhere to Hide Icon.png',
    ]);
    expect(spellings).toEqual([]);
  });

  it('does not repeat a name the upload sweep already found', () => {
    const { icons, spellings } = namesFromSweeps('Light Cone', uploads, [
      'File:Light Cone Nowhere to Run Icon.png',
    ]);
    expect(icons).toContain('Nowhere to Run');
    expect(spellings).toEqual([]);
  });
});

describe('planWrite', () => {
  const set = (...names: string[]) => new Set(names);

  it('writes when the sweep only adds names', () => {
    const plan = planWrite(set('Acheron'), set('Acheron', 'Kafka'), false);
    expect(plan).toMatchObject({ added: ['Kafka'], removed: [], write: true });
  });

  it('writes nothing, and reports no change, when the sweep matches the committed set', () => {
    const plan = planWrite(set('Acheron', 'Kafka'), set('Kafka', 'Acheron'), false);
    expect(plan).toMatchObject({ added: [], removed: [], write: false });
  });

  it('refuses to write when a name would be dropped', () => {
    // Nothing tells "Fandom deleted this" apart from "that API call had a bad
    // day" except a human reading the diff.
    const plan = planWrite(set('Acheron', 'Kafka'), set('Acheron'), false);
    expect(plan).toMatchObject({ added: [], removed: ['Kafka'], write: false, refused: true });
  });

  it('accepts a removal under --force', () => {
    const plan = planWrite(set('Acheron', 'Kafka'), set('Acheron'), true);
    expect(plan).toMatchObject({ removed: ['Kafka'], write: true, refused: false });
  });

  it('writes the first run, when nothing is committed yet', () => {
    const plan = planWrite(null, set('Acheron'), false);
    expect(plan).toMatchObject({ added: ['Acheron'], removed: [], write: true });
  });

  it('reports both sides of a rename, sorted, so the diff is readable', () => {
    const plan = planWrite(set('B', 'A', 'Old'), set('B', 'A', 'New', 'Also'), false);
    expect(plan.added).toEqual(['Also', 'New']);
    expect(plan.removed).toEqual(['Old']);
  });
});

describe('renderManifest', () => {
  it('emits a sorted, quoted set under a per-game export name', () => {
    const source = renderManifest('hsr', ['Acheron', "It's Showtime", 'Dan Heng • Imbibitor Lunae']);
    expect(source).toContain('export const HSR_PORTRAIT_NAMES: ReadonlySet<string> = new Set([');
    expect(source).toContain("  'Acheron',");
    expect(source).toContain("  'Dan Heng • Imbibitor Lunae',");
    expect(source).toContain('do not edit by hand');
    expect(source.endsWith(']);\n')).toBe(true);
  });

  it('quotes a name containing an apostrophe without mangling it', () => {
    const source = renderManifest('hsr', ["It's Showtime"]);
    expect(source).toContain('  "It\'s Showtime",');
  });

  it('sorts, even if the caller did not', () => {
    const source = renderManifest('hsr', ['Kafka', 'Acheron']);
    expect(source.indexOf("'Acheron'")).toBeLessThan(source.indexOf("'Kafka'"));
  });
});
