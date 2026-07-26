/**
 * The single decision point for "does this pull get a portrait" — one
 * implementation shared by every game, so both render surfaces
 * (`src/ui/wishesView.ts`) stay dumb about rarity, category, and manifest
 * membership.
 *
 * Gates run in a fixed order, cheapest and most-decisive first: rarity, then
 * category (via the existing `classifyItem` classifier — there is no second
 * `itemType` parser), then whether the game even has portrait config, then
 * exact set membership. Any gate failing is an ordinary miss (`null`), not an
 * error — a miss is what makes the never-regress guarantee (spec §1.3) hold.
 */
import type { GameKey, WishItem } from '../../../types.ts';
import { classifyItem, type IconKey } from '../../../ui/itemIcons.ts';
import { PORTRAIT_CONFIGS } from './config.ts';
import { HSR_PORTRAIT_NAMES } from './hsr.ts';

/** Per-game name manifest, keyed alongside `PORTRAIT_CONFIGS`. A game with no
 *  entry here never reaches set membership — it fails the config gate first. */
const PORTRAIT_MANIFESTS: Partial<Record<GameKey, ReadonlySet<string>>> = {
  hsr: HSR_PORTRAIT_NAMES,
};

export function portraitUrl(item: WishItem, game: GameKey): string | null {
  if (item.rank !== '4' && item.rank !== '5') return null;

  // A blank itemType is deliberately never a candidate here, even though
  // `classifyItem` itself falls back to 'character' for non-Genshin games so
  // the glyph always draws *something*. That fallback is fine for a category
  // badge; it is not fine for claiming a specific portrait off an unknown
  // category.
  const kind: IconKey = item.itemType.trim() ? classifyItem(item.itemType, game) : 'unknown';
  if (kind !== 'character' && kind !== 'lightcone') return null;

  const config = PORTRAIT_CONFIGS[game];
  if (!config || !config.filePrefixes[kind]) return null;

  const manifest = PORTRAIT_MANIFESTS[game];
  if (!manifest) return null;

  // Trim + NFC only. No case-folding, no punctuation stripping: a real U+2022
  // bullet or U+0027 apostrophe must survive untouched, or a correct match
  // becomes a miss.
  const name = item.name.trim().normalize('NFC');
  if (!manifest.has(name)) return null;

  return config.urlForName(name, kind);
}
