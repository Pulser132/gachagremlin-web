/**
 * Watermark derivation for incremental import.
 *
 * The import dialog hands the PowerShell scripts a "newest pull I already
 * have" watermark per API query type, and the scripts stop paging a channel
 * once they reach it. This module computes those watermarks; the scripts stay
 * dumb and just apply the `queryType:id` pairs they're given.
 */
import { classifyIdScheme } from './dedupe.ts';
import { compareIds } from './store.ts';
import type { GameKey, WishItem } from '../../types.ts';

/**
 * API query type → the stored bannerTypes that query can return.
 *
 * Genshin's `301` is the only non-1:1 case: querying `gacha_type=301` returns
 * entries whose stored gacha_type is 301 OR 400 (the second concurrent
 * character banner), so 301's watermark must be the max real id across both —
 * a watermark from 301 alone could sit below unfetched 400 pulls and stop the
 * script too early. Verified live 2026-07-15 (581 + 13 = 594 through one
 * query). HSR and ZZZ map 1:1, verified the same day.
 *
 * Deliberately NOT derived from GAME_BANNER_CONFIGS.groups: those are *pity*
 * groups, which fold HSR 21+22 together even though the script queries them
 * separately. Different concern, different table.
 */
export const IMPORT_QUERY_TYPES: Record<GameKey, Record<string, string[]>> = {
  genshin: { '100': ['100'], '200': ['200'], '301': ['301', '400'], '302': ['302'], '500': ['500'] },
  hsr: { '1': ['1'], '2': ['2'], '11': ['11'], '12': ['12'], '21': ['21'], '22': ['22'] },
  zzz: { '1': ['1'], '2': ['2'], '3': ['3'], '5': ['5'] },
};

/**
 * Builds the scripts' third positional argument: `"301:170...,302:169..."`,
 * one entry per query type that has at least one REAL stored id. An empty
 * string means "no watermarks" and the caller must omit the argument entirely
 * (absence is what tells the script to do a full download).
 *
 * Real HoYoverse ids only: synthetic ids (paimonMoe.ts fabricates them for
 * backup imports) embed the pull's exact epoch second and can sort ABOVE the
 * real id of the same physical pull — a synthetic watermark would stop paging
 * early and silently skip real pulls. Max is picked with compareIds; plain
 * string or Number ordering both mis-sort 19-digit ids.
 */
export function buildSinceArg(game: GameKey, items: WishItem[]): string {
  const maxRealByBanner = new Map<string, string>();
  for (const item of items) {
    if (classifyIdScheme(item) !== 'real') continue;
    const current = maxRealByBanner.get(item.bannerType);
    if (current === undefined || compareIds(item.id, current) > 0) {
      maxRealByBanner.set(item.bannerType, item.id);
    }
  }

  const parts: string[] = [];
  for (const [queryType, bannerTypes] of Object.entries(IMPORT_QUERY_TYPES[game])) {
    let max: string | undefined;
    for (const bannerType of bannerTypes) {
      const candidate = maxRealByBanner.get(bannerType);
      if (candidate !== undefined && (max === undefined || compareIds(candidate, max) > 0)) {
        max = candidate;
      }
    }
    if (max !== undefined) parts.push(`${queryType}:${max}`);
  }
  return parts.join(',');
}
