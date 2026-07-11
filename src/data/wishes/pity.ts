/**
 * Pure pity/guarantee math over an already-merged, sorted item list. No I/O
 * — the UI and tests both call these directly against plain arrays.
 */
import type { WishItem } from '../../types.ts';
import type { BannerGroup } from './banners.ts';
import { compareIds } from './store.ts';

export interface PityCounts {
  /** Pulls since (not including) the last 5★ on this banner group. */
  since5Star: number;
  /** Pulls since (not including) the last 4★ or 5★ on this banner group. */
  since4Star: number;
  total: number;
}

export interface GuaranteeState {
  /** True if the next 5★ on this banner group is guaranteed to be the limited item. */
  guaranteed: boolean;
}

function itemsForGroup(items: WishItem[], group: BannerGroup): WishItem[] {
  return items.filter((i) => group.bannerTypes.includes(i.bannerType)).sort((a, b) => compareIds(a.id, b.id));
}

export function pityCounts(items: WishItem[], group: BannerGroup): PityCounts {
  const groupItems = itemsForGroup(items, group);
  let since5Star = 0;
  let since4Star = 0;
  for (const item of groupItems) {
    since5Star = item.rank === '5' ? 0 : since5Star + 1;
    since4Star = item.rank === '4' || item.rank === '5' ? 0 : since4Star + 1;
  }
  return { since5Star, since4Star, total: groupItems.length };
}

/**
 * A 5★ pulled on a `has5050` banner either matches a name in
 * `standardPool5Star` (a "lost" 50/50 — the next 5★ is guaranteed limited)
 * or doesn't (a "won" 50/50, or the guarantee being consumed — either way
 * the next 5★ starts fresh at 50/50 again).
 */
export function guaranteeState(items: WishItem[], group: BannerGroup, standardPool5Star: string[]): GuaranteeState {
  if (!group.has5050) return { guaranteed: false };
  const groupItems = itemsForGroup(items, group);
  for (let i = groupItems.length - 1; i >= 0; i--) {
    const item = groupItems[i];
    if (item.rank === '5') {
      return { guaranteed: standardPool5Star.includes(item.name) };
    }
  }
  return { guaranteed: false }; // no 5★ pulled yet on this banner group
}

/**
 * Maps each 5★ item's id to the pity it took to land (pulls since the
 * previous 5★ on the same banner group, inclusive of itself) — used by the
 * history table's "pity" column.
 */
export function pityAtEach5Star(items: WishItem[], group: BannerGroup): Map<string, number> {
  const groupItems = itemsForGroup(items, group);
  const result = new Map<string, number>();
  let sinceLast = 0;
  for (const item of groupItems) {
    sinceLast++;
    if (item.rank === '5') {
      result.set(item.id, sinceLast);
      sinceLast = 0;
    }
  }
  return result;
}
