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
  cleanEventName,
  normalizeNewlines,
  parseBannerIndex,
  parseChannelPage,
  parseIndex,
  parseInfobox,
  parseItemPool,
  type BannerIndexSections,
  type IndexSections,
} from './parser.ts';
import { parseEventPage } from './eventPage.ts';
import { findWalltimes, perServer, statusOf } from './times.ts';

// Wide enough for the event-grid's card width on a large monitor, without
// pulling the wiki's full-size (often 1000px+) original for a small tile.
const BANNER_WIDTH = 500;

/** Same card-width reasoning as BANNER_WIDTH above, kept as its own constant
 * since "Banner" here means the gacha Banner domain concept, not the
 * event-card splash-art convention BANNER_WIDTH is named after. */
const WISH_ART_WIDTH = 500;

export function wikiPageUrl(host: string, title: string): string {
  return `https://${host}/wiki/${encodeURI(title.replace(/ /g, '_'))}`;
}

/** Shared by `showEvent` and `showBanner`: fetch a page's wikitext and
 * resolve its canonical title (following redirects), or throw a `WikiError`
 * carrying the wiki's own error info. */
async function fetchWikitextPage(
  host: string,
  title: string,
  userAgent?: string,
): Promise<{ wikitext: string; pageTitle: string }> {
  const data = await api(host, { action: 'parse', page: title, prop: 'wikitext', redirects: 1 }, userAgent);
  if (data.error) {
    const info = data.error.info ?? JSON.stringify(data.error);
    throw new WikiError(`${host}: ${info} (title "${title}")`);
  }
  return { wikitext: normalizeNewlines(data.parse.wikitext), pageTitle: data.parse.title ?? title };
}

export async function listEvents(gameKey: GameKey, userAgent?: string): Promise<IndexSections> {
  const game = getGame(gameKey);
  const data = await api(game.host, { action: 'parse', page: game.indexPage, prop: 'text' }, userAgent);
  return parseIndex(normalizeNewlines(data.parse.text));
}

export async function showEvent(gameKey: GameKey, title: string, userAgent?: string): Promise<EventInfo> {
  const game = getGame(gameKey);
  const { wikitext, pageTitle } = await fetchWikitextPage(game.host, title, userAgent);
  const { event, imageField } = parseEventPage(gameKey, title, pageTitle, wikitext, Math.floor(Date.now() / 1000));
  if (imageField) event.imageUrl = await resolveImageUrl(game.host, imageField, BANNER_WIDTH, userAgent);
  return event;
}

/**
 * List current/upcoming Banner-category rows from the game's Banner listing
 * page (e.g. Genshin's `Wish`). Returns empty sections without any network
 * request when the game has no configured `bannerIndexPages` — the same
 * "absence is the switch" contract `WikiSource.fetchBanners` relies on for
 * the unwired-game placeholder panel.
 */
export async function listBanners(gameKey: GameKey, userAgent?: string, now: Date = new Date()): Promise<BannerIndexSections> {
  const game = getGame(gameKey);
  if (game.bannerIndexPages.length === 0) return { current: [], upcoming: [] };
  // One API call per listing page, merged in config order. A page that fails
  // to fetch contributes nothing when there are several (ZZZ's channels), so
  // one bad page never blanks the others; a lone page keeps throwing so the
  // caller surfaces the error as before.
  const several = game.bannerIndexPages.length > 1;
  const pages = await Promise.all(
    game.bannerIndexPages.map(async (page): Promise<BannerIndexSections> => {
      try {
        const data = await api(game.host, { action: 'parse', page, prop: 'text' }, userAgent);
        const html = normalizeNewlines(data.parse.text);
        return game.bannerIndexShape === 'channelPages'
          ? parseChannelPage(html, page)
          : parseBannerIndex(html, game.dropEndedCurrentBanners ? now : undefined);
      } catch (e) {
        if (!several) throw e;
        console.warn(`gachagremlin-web: failed to fetch ${gameKey} listing page ${JSON.stringify(page)}:`, e);
        return { current: [], upcoming: [] };
      }
    }),
  );
  return {
    current: pages.flatMap((p) => p.current),
    upcoming: pages.flatMap((p) => p.upcoming),
  };
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
  const { wikitext, pageTitle } = await fetchWikitextPage(game.host, title, userAgent);
  const fields = parseInfobox(wikitext, [game.bannerInfoboxTemplate]);
  const pool = parseItemPool(wikitext, game.itemPool);
  const [startWt, endWt] = findWalltimes(fields, []);
  const startUnix = perServer(startWt, game.servers);
  const endUnix = perServer(endWt, game.servers);
  const imageUrl = fields.image
    ? await resolveImageUrl(game.host, fields.image.trim(), WISH_ART_WIDTH, userAgent)
    : null;

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
