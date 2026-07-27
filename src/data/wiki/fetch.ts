/**
 * Fetch and assemble event details for one game, from its Fandom wiki.
 *
 * Ported from the bot's `src/gachagremlin/wiki/fetch.py` (GachaGremlin
 * repo).
 */
import type { BannerInfo, EventInfo, GameKey } from '../../types.ts';
import { api, resolveImageUrl, WikiError } from './client.ts';
import { getGame } from './games.ts';
import {
  clean,
  cleanEventName,
  getDescription,
  normalizeNewlines,
  parseBannerIndex,
  parseIndex,
  parseInfobox,
  parseItemPool,
  sectionBullets,
  type BannerIndexSections,
  type IndexSections,
} from './parser.ts';
import { findWalltimes, isGlobalTime, perServer, statusOf } from './times.ts';

// Wide enough for the event-grid's card width on a large monitor, without
// pulling the wiki's full-size (often 1000px+) original for a small tile.
const BANNER_WIDTH = 500;

/** Same card-width reasoning as BANNER_WIDTH above, kept as its own constant
 * since "Banner" here means the gacha Banner domain concept, not the
 * event-card splash-art convention BANNER_WIDTH is named after. */
const WISH_ART_WIDTH = 500;

function wikiPageUrl(host: string, title: string): string {
  return `https://${host}/wiki/${encodeURI(title.replace(/ /g, '_'))}`;
}

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

/**
 * List current/upcoming Banner-category rows from the game's Banner listing
 * page (e.g. Genshin's `Wish`). Returns empty sections without any network
 * request when the game has no configured `bannerIndexPage` — the same
 * "absence is the switch" contract `WikiSource.fetchBanners` relies on for
 * the unwired-game placeholder panel.
 */
export async function listBanners(gameKey: GameKey, userAgent?: string): Promise<BannerIndexSections> {
  const game = getGame(gameKey);
  if (!game.bannerIndexPage) return { current: [], upcoming: [] };
  const data = await api(game.host, { action: 'parse', page: game.bannerIndexPage, prop: 'text' }, userAgent);
  return parseBannerIndex(normalizeNewlines(data.parse.text));
}

/**
 * Fetch and assemble one Banner's detail page.
 *
 * Banner pages carry no reliable human-readable Duration section to prefer
 * over the infobox fields the way `showEvent` does for Events (see
 * ADR-0002's parsing notes) — `findWalltimes` is called with no duration
 * bullets so it reads `time_start`/`time_end` directly.
 */
export async function showBanner(gameKey: GameKey, title: string, userAgent?: string): Promise<BannerInfo> {
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
  const fields = parseInfobox(wikitext, ['Wish']);
  const pool = parseItemPool(wikitext);
  const [startWt, endWt] = findWalltimes(fields, []);
  const startUnix = perServer(startWt, game.servers);
  const endUnix = perServer(endWt, game.servers);
  const imageUrl = fields.image
    ? await resolveImageUrl(game.host, fields.image.trim(), WISH_ART_WIDTH, userAgent)
    : null;
  const pageTitle: string = data.parse.title ?? title;

  return {
    game: game.key,
    title: pageTitle,
    name: cleanEventName(fields.name ?? title, title),
    status: statusOf(startUnix, endUnix, Math.floor(Date.now() / 1000)),
    featured5Star: pool.featured5Star,
    featured4Star: pool.featured4Star,
    imageUrl,
    startUnix,
    endUnix,
    wikiUrl: wikiPageUrl(game.host, pageTitle),
  };
}
