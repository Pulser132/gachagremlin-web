/**
 * Pure assembly of an `EventInfo` from one event page's wikitext — everything
 * `showEvent` does after the network fetch, minus image resolution. Split out
 * so the events-parity golden fixtures (scripts/parityGolden.ts) run the exact
 * code path the site does, with a caller-supplied `now`.
 */
import type { EventInfo, GameKey } from '../../types.ts';
import { getGame } from './games.ts';
import { clean, cleanEventName, getDescription, parseInfobox, sectionBullets } from './parser.ts';
import { findWalltimes, isGlobalTime, normalizeGlobalRegionUnix, perServer, statusOf } from './times.ts';

export function formatWalltime(w: readonly [number, number, number, number, number] | null): string | null {
  if (!w) return null;
  const [y, mo, d, h, mi] = w;
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}`;
}

/**
 * `imageField` is the raw infobox `image` value (to be resolved over the
 * network by the caller); the returned event has `imageUrl: null`.
 * `nowSeconds` is Unix seconds. Status is derived from the per-region times
 * before the global-time correction, as it always was.
 */
export function parseEventPage(
  gameKey: GameKey,
  title: string,
  pageTitle: string,
  wikitext: string,
  nowSeconds: number,
): { event: EventInfo; imageField: string | null } {
  const game = getGame(gameKey);
  const fields = parseInfobox(wikitext);
  const durationText = sectionBullets(wikitext, 'Duration');
  const requirements = sectionBullets(wikitext, 'Requirements');
  const [startWt, endWt] = findWalltimes(fields, durationText);
  const startUnix = perServer(startWt, game.servers);
  const endUnix = perServer(endWt, game.servers);
  const globalTime = isGlobalTime(fields.type ?? '');

  const event: EventInfo = {
    game: game.key,
    title: pageTitle,
    name: cleanEventName(fields.name ?? title, title),
    type: fields.type ?? '',
    group: fields.group ?? '',
    status: statusOf(startUnix, endUnix, nowSeconds),
    globalTime,
    reward: clean(fields.reward ?? ''),
    rewardType: fields.rewardType ?? '',
    characters: (fields.characters ?? '')
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean),
    description: getDescription(wikitext, fields),
    hoyolabLinks: (['link', 'link2', 'link3'] as const)
      .map((k) => fields[k])
      .filter((v): v is string => !!v && v.startsWith('http')),
    durationText,
    requirements,
    imageUrl: null,
    startWalltime: formatWalltime(startWt),
    endWalltime: formatWalltime(endWt),
    startUnix: globalTime ? normalizeGlobalRegionUnix(startUnix) : startUnix,
    endUnix: globalTime ? normalizeGlobalRegionUnix(endUnix) : endUnix,
  };
  return { event, imageField: fields.image ? fields.image.trim() : null };
}
