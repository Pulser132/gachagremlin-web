/**
 * Collapses duplicate pulls that arise when the same account is imported
 * from two different sources — e.g. a paimon.moe local-data backup (which
 * has no real pull ids, so paimonMoe.ts synthesizes them) and the
 * PowerShell script (which carries HoYoverse's real API ids). The same
 * physical pull then exists under two different ids, and store.ts's
 * merge-by-id keeps both.
 *
 * Straight content-based dedupe would be wrong: a single 10-pull can
 * legitimately contain the same item twice at the same second (two
 * Favonius Swords, say), and those copies are real. The trick is that
 * duplicates-from-mixed-sources always pair items whose ids come from
 * DIFFERENT id schemes, while legitimate same-second copies share one
 * scheme. So: group items by content, partition each group by id scheme,
 * and where more than one scheme describes the same content, keep only the
 * most trustworthy scheme's copies — they are the same physical pulls
 * reported twice.
 */
import { toEpochSeconds } from './paimonMoe.ts';
import type { WishItem } from '../../types.ts';

/**
 * Ordered most-trustworthy first: real HoYoverse ids beat synthetic ones,
 * and the current deterministic synthetic scheme beats the legacy
 * counter-based one (see paimonMoe.ts's id comment).
 */
const SCHEME_PRIORITY = ['real', 'synthetic', 'synthetic-legacy'] as const;
type IdScheme = (typeof SCHEME_PRIORITY)[number];

/**
 * Synthetic ids (paimonMoe.ts) embed the pull's exact epoch second in
 * their first 10 digits. Real HoYoverse ids embed a day-boundary epoch
 * instead, so they only collide with this check for a pull landing at
 * exactly second :00 of the embedded day — and a misclassification only
 * matters at all if that pull ALSO shares banner/time/name/rank with a
 * differently-classified copy, which compounds to negligible.
 *
 * Within synthetic ids, digit 10 separates the schemes: the current scheme
 * puts the 3-digit banner code there (first digit 1-5, never 0), the
 * legacy counter scheme zero-padded a small counter (first digit always 0).
 */
function classifyIdScheme(item: WishItem): IdScheme {
  if (item.id.length !== 19) return 'real';
  if (item.id.slice(0, 10) !== String(toEpochSeconds(item.time)).padStart(10, '0')) return 'real';
  return item.id.charAt(10) === '0' ? 'synthetic-legacy' : 'synthetic';
}

/**
 * Returns `items` with cross-scheme duplicates removed (original order
 * preserved), or the same array untouched if there were none.
 */
export function dedupeCrossSource(items: WishItem[]): WishItem[] {
  const groups = new Map<string, WishItem[]>();
  for (const item of items) {
    const key = `${item.bannerType}|${item.time}|${item.name}|${item.rank}`;
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  const drop = new Set<WishItem>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const bySchemes = new Map<IdScheme, WishItem[]>();
    for (const item of group) {
      const scheme = classifyIdScheme(item);
      const members = bySchemes.get(scheme);
      if (members) {
        members.push(item);
      } else {
        bySchemes.set(scheme, [item]);
      }
    }
    if (bySchemes.size < 2) continue; // one scheme = one source = legitimate same-second copies

    // Multiple schemes describing identical content are the same physical
    // pulls reported by different imports. In the sources' overlap window
    // every scheme reports the full set, so the largest partition is the
    // complete truth; on equal counts prefer the more trustworthy scheme.
    const [keep] = [...bySchemes.entries()].sort(
      (a, b) => b[1].length - a[1].length || SCHEME_PRIORITY.indexOf(a[0]) - SCHEME_PRIORITY.indexOf(b[0]),
    );
    for (const [scheme, members] of bySchemes) {
      if (scheme === keep[0]) continue;
      for (const member of members) drop.add(member);
    }
  }

  if (drop.size === 0) return items;
  return items.filter((item) => !drop.has(item));
}
