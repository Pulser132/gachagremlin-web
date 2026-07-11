/**
 * Fetch and assemble event details for one game, from its Fandom wiki.
 *
 * Ported from the bot's `src/gachagremlin/wiki/fetch.py` (GachaGremlin
 * repo).
 */
import type { EventInfo, GameKey } from '../../types.ts';
import { api, resolveImageUrl, WikiError } from './client.ts';
import { getGame } from './games.ts';
import {
  clean,
  cleanEventName,
  getDescription,
  normalizeNewlines,
  parseIndex,
  parseInfobox,
  sectionBullets,
  type IndexSections,
} from './parser.ts';
import { findWalltimes, isGlobalTime, perServer, statusOf } from './times.ts';

// Wide enough for the event-grid's card width on a large monitor, without
// pulling the wiki's full-size (often 1000px+) original for a small tile.
const BANNER_WIDTH = 500;

function formatWalltime(w: readonly [number, number, number, number, number] | null): string | null {
  if (!w) return null;
  const [y, mo, d, h, mi] = w;
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}`;
}

export async function listEvents(gameKey: GameKey, userAgent?: string): Promise<IndexSections> {
  const game = getGame(gameKey);
  const data = await api(game.host, { action: 'parse', page: game.indexPage, prop: 'text' }, userAgent);
  return parseIndex(normalizeNewlines(data.parse.text));
}

export async function showEvent(gameKey: GameKey, title: string, userAgent?: string): Promise<EventInfo> {
  const game = getGame(gameKey);
  const data = await api(
    game.host,
    { action: 'parse', page: title, prop: 'wikitext', redirects: 1 },
    userAgent,
  );
  if (data.error) {
    const info = data.error.info ?? JSON.stringify(data.error);
    throw new WikiError(`${game.host}: ${info} (title "${title}")`);
  }
  const wikitext: string = normalizeNewlines(data.parse.wikitext);
  const fields = parseInfobox(wikitext);
  const durationText = sectionBullets(wikitext, 'Duration');
  const requirements = sectionBullets(wikitext, 'Requirements');
  const [startWt, endWt] = findWalltimes(fields, durationText);
  const startUnix = perServer(startWt, game.servers);
  const endUnix = perServer(endWt, game.servers);
  const imageUrl = fields.image
    ? await resolveImageUrl(game.host, fields.image.trim(), BANNER_WIDTH, userAgent)
    : null;

  return {
    game: game.key,
    title: data.parse.title ?? title,
    name: cleanEventName(fields.name ?? title, title),
    type: fields.type ?? '',
    group: fields.group ?? '',
    status: statusOf(startUnix, endUnix, Math.floor(Date.now() / 1000)),
    globalTime: isGlobalTime(fields.type ?? ''),
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
    imageUrl,
    startWalltime: formatWalltime(startWt),
    endWalltime: formatWalltime(endWt),
    startUnix,
    endUnix,
  };
}
