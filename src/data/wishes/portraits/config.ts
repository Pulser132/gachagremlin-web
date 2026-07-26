/**
 * Per-game portrait configuration: where a game's item icons live on Fandom's
 * CDN, which item categories it has icons for, and how a name becomes a URL.
 *
 * Portraits are a pull-tracker concern, not a wiki-fetch or pity-math one, so
 * this deliberately extends neither `src/data/wiki/games.ts` (event fetching)
 * nor `src/data/wishes/banners.ts` (pity rules).
 *
 * Adding a game is two steps: add its entry here, then run
 * `npm run gen:portraits`. Nothing else is per-game. A game with no entry at
 * all renders exactly as it does today — that's the shipping state for Genshin
 * and ZZZ, and `Partial<Record<…>>` is what makes it a type-level fact rather
 * than a convention.
 */
import type { GameKey } from '../../../types.ts';
import type { IconKey } from '../../../ui/itemIcons.ts';
import { md5 } from './md5.ts';

export interface PortraitConfig {
  /** CDN path segment on static.wikia.nocookie.net — *not* the wiki host. HSR's
   *  is `houkai-star-rail` while its wiki is `honkai-star-rail.fandom.com`. */
  cdnHost: string;
  /** File-title prefix per category this game has icons for. Drives both the
   *  generator's enumeration sweeps and `urlForName`. Categories absent here
   *  never attempt a portrait. */
  filePrefixes: Partial<Record<IconKey, string>>;
  /** Full URL for one name in one category. A whole per-game function, not a
   *  shared template with a host slotted in: the host itself varies between
   *  games, and a future game could need an entirely different derivation. */
  urlForName(name: string, kind: IconKey): string;
}

/**
 * `encodeURIComponent` plus the six characters it leaves alone but MediaWiki
 * emits percent-encoded in its own URLs (`Woof! Walk Time!` → `Woof%21…`).
 */
export function encodeFilename(filename: string): string {
  return encodeURIComponent(filename).replace(
    /[!'()*~]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** The bookend every square item icon's file title ends with. */
export const ICON_SUFFIX = ' Icon.png';

/**
 * The filename the icon for `name` is actually **stored** under — the exact
 * string whose MD5 addresses it on the CDN.
 *
 * Colons and question marks are dropped from the stored upload (the punctuated
 * in-game title exists only as an editor-created redirect), so hashing them in
 * gives the wrong directory: `Ninja Record: Sound Hunt` hashes to `2/23` with
 * the colon and `8/88` without, and `8/88` is the real one. Affects ~3 HSR
 * items and is a no-op for the other ~250.
 *
 * The generator derives the same string to decide whether a file redirect
 * points at a real upload, so this rule lives in exactly one place.
 */
export function storedFilename(prefix: string, name: string): string {
  return `${prefix} ${name}${ICON_SUFFIX}`.replace(/[:?]/g, '').replace(/ /g, '_');
}

const HSR_CDN_HOST = 'houkai-star-rail';

const HSR_FILE_PREFIXES: Partial<Record<IconKey, string>> = {
  character: 'Character',
  lightcone: 'Light Cone',
};

function hsrUrlForName(name: string, kind: IconKey): string {
  const prefix = HSR_FILE_PREFIXES[kind];
  if (!prefix) {
    throw new Error(`hsr has no portrait file prefix for category ${kind}`);
  }
  const filename = storedFilename(prefix, name);

  // Fandom addresses every file by the MD5 of that stored filename: first hex
  // digit, then the first two. No API call, no network — the whole point.
  const hash = md5(filename);

  // Width 64 serves both surfaces from one cache entry: sharp at 2× DPR in the
  // 32px history slot and correct for the 40px Recent 5★ slot.
  // `scale-to-width-down` clamps at native size, so it never upscales.
  return (
    `https://static.wikia.nocookie.net/${HSR_CDN_HOST}/images/${hash[0]}/${hash.slice(0, 2)}/` +
    `${encodeFilename(filename)}/revision/latest/scale-to-width-down/64`
  );
}

export const PORTRAIT_CONFIGS: Partial<Record<GameKey, PortraitConfig>> = {
  hsr: {
    cdnHost: HSR_CDN_HOST,
    filePrefixes: HSR_FILE_PREFIXES,
    urlForName: hsrUrlForName,
  },
};
