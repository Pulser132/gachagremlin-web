/**
 * Small inline SVG glyphs for the pull-history table's Item column.
 *
 * There's no real per-character/per-weapon art available to a static site
 * with no asset pipeline or CDN — 300+ items across three games, no
 * licensed source. So these are drawn per *category* instead (the only
 * granularity the data actually carries — see WishItem.itemType), one
 * consistent thin-stroke glyph family, each grounded in what that category
 * literally looks like in its own game's fiction rather than a generic
 * icon-pack stand-in: Light Cone gets a clipped-corner data-card (echoing
 * HSR's own clipped-corner identity from the reactive-skin redesign),
 * W-Engine a hex bolt (ZZZ's mechanical "Hollow" motif), Bangboo an actual
 * boxy-robot-with-antenna silhouette.
 *
 * Rendered with stroke="currentColor" so they inherit the row's color —
 * callers set that via CSS, letting the icon pick up the active game's
 * --accent for free, same as every other reactive-skin element.
 */
import type { GameKey } from '../types.ts';

type IconKey = 'character' | 'weapon' | 'lightcone' | 'wengine' | 'bangboo' | 'unknown';

const ICON_PATHS: Record<IconKey, string> = {
  // Head + shoulders — Character (Genshin/HSR) and Agent (ZZZ) share one
  // glyph; both are "a person" in the data.
  character: '<circle cx="10" cy="6.6" r="3.1"/><path d="M4.2 16.8c0-3.5 2.7-5.9 5.8-5.9s5.8 2.4 5.8 5.9"/>',
  // A blade on the diagonal, small crossguard flare near the grip, pommel
  // dot — Genshin's only weapon category in this data (no sub-type).
  weapon: '<path d="M4.6 16.4 15 6"/><path d="M11.6 5.2 15.8 9.4"/><circle cx="4.6" cy="16.4" r="1" fill="currentColor" stroke="none"/>',
  // A data-card with one clipped corner, echoing HSR's own card geometry.
  lightcone:
    '<path d="M5 4.5h6.5l3 3v8a1 1 0 0 1-1 1H5.6a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z"/><path d="M11.5 4.5v3h3"/><line x1="6.8" y1="12" x2="12.2" y2="12"/>',
  // A hex bolt with a center pin — ZZZ's mechanical W-Engine.
  wengine: '<path d="M10 2.6 16 6.1v7L10 16.6 4 13.1v-7z"/><circle cx="10" cy="9.6" r="2.3"/>',
  // A boxy robot head, two dot eyes, short antenna — Bangboo's actual design.
  bangboo:
    '<rect x="4.8" y="6.2" width="10.4" height="8.8" rx="3"/><circle cx="8" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="10.5" r="1" fill="currentColor" stroke="none"/><line x1="10" y1="6.2" x2="10" y2="3.6"/><circle cx="10" cy="3.1" r="0.9" fill="currentColor" stroke="none"/>',
  // Diamond — fallback for any itemType this table doesn't recognize.
  unknown: '<path d="M10 3 16.5 10 10 17 3.5 10z"/>',
};

const LABELS: Record<IconKey, string> = {
  character: 'Character',
  weapon: 'Weapon',
  lightcone: 'Light Cone',
  wengine: 'W-Engine',
  bangboo: 'Bangboo',
  unknown: 'Item',
};

function normalize(itemType: string, game: GameKey): IconKey {
  const t = itemType.trim().toLowerCase();
  if (t === 'character' || t === 'agent') return 'character';
  if (t === 'weapon') return 'weapon';
  if (t === 'light cone' || t === 'lightcone') return 'lightcone';
  if (t === 'w-engine' || t === 'w-engines' || t === 'wengine') return 'wengine';
  if (t === 'bangboo') return 'bangboo';
  // Defensive fallback for a blank/unexpected itemType: at least route ZZZ
  // agents/HSR characters through the person glyph even if the exact
  // string didn't match, since that's the most common category.
  if (!t && game !== 'genshin') return 'character';
  return 'unknown';
}

/** Builds a `.item-icon` + visually-hidden category label pair. The label
 * is real content, not decoration — itemType isn't shown as text anywhere
 * else in the history table. */
export function createItemIcon(itemType: string, game: GameKey): DocumentFragment {
  const key = normalize(itemType, game);
  const fragment = document.createDocumentFragment();

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'item-icon');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICON_PATHS[key];
  fragment.appendChild(svg);

  const label = document.createElement('span');
  label.className = 'sr-only';
  label.textContent = `${LABELS[key]}: `;
  fragment.appendChild(label);

  return fragment;
}
