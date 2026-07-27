/**
 * `EventSource`/`BannerSource` implementation that fetches straight from the
 * Fandom wikis. Detail fetches are limited to a small concurrency so a page
 * with many events/Banners doesn't fire dozens of simultaneous requests at
 * once.
 */
import { findBannerGroupByLabel } from '../wishes/banners.ts';
import type { BannerSource, EventSource } from '../source.ts';
import type { BannerCategorySection, BannerInfo, EventInfo, GameBanners, GameEvents, GameKey } from '../../types.ts';
import type { BannerListingCategory, BannerListingEntry } from './parser.ts';
import { listBanners, listEvents, showBanner, showEvent } from './fetch.ts';
import { getGame } from './games.ts';
import { normalizeGlobalRegionUnix } from './times.ts';

const CONCURRENCY = 4;

/** A slug derived from the wiki's own category label, used as a section key
 * when no `BannerGroup` maps to it (see ADR-0003). */
function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

export class WikiSource implements EventSource, BannerSource {
  async fetchEvents(game: GameKey): Promise<GameEvents> {
    const { current, upcoming } = await listEvents(game);

    // A single event's parse failure must not take down the whole game's
    // listing (same failure posture as the bot's poller).
    const fetchDetail = async (title: string): Promise<EventInfo | null> => {
      try {
        const ev = await showEvent(game, title);
        if (ev.globalTime) {
          ev.startUnix = normalizeGlobalRegionUnix(ev.startUnix);
          ev.endUnix = normalizeGlobalRegionUnix(ev.endUnix);
        }
        return ev;
      } catch (e) {
        console.warn(`gachagremlin-web: failed to fetch ${game} event ${JSON.stringify(title)}:`, e);
        return null;
      }
    };

    const [currentEvents, upcomingEvents] = await Promise.all([
      mapLimit(current, CONCURRENCY, fetchDetail),
      mapLimit(upcoming, CONCURRENCY, fetchDetail),
    ]);

    const isEvent = (e: EventInfo | null): e is EventInfo => e !== null;
    return {
      current: currentEvents.filter(isEvent),
      upcoming: upcomingEvents.filter(isEvent),
      fetchedAt: Date.now(),
    };
  }

  async fetchBanners(game: GameKey): Promise<GameBanners> {
    // "Not wired up" games have no bannerIndexPage; listBanners() already
    // short-circuits before any network call, but checking here too keeps
    // that contract explicit at this seam rather than implicit in fetch.ts.
    if (!getGame(game).bannerIndexPage) {
      return { current: [], upcoming: [], fetchedAt: Date.now() };
    }

    const { current, upcoming } = await listBanners(game);
    const [currentSections, upcomingSections] = await Promise.all([
      fetchBannerSections(game, current),
      fetchBannerSections(game, upcoming),
    ]);
    return { current: currentSections, upcoming: upcomingSections, fetchedAt: Date.now() };
  }
}

/**
 * Fetch every Banner's detail page across a listing's category rows, then
 * regroup into `BannerCategorySection`s carrying the wiki's own category
 * order (and each category's own Banner order). A category whose every
 * Banner failed to fetch is dropped — the wiki listed it, but there's
 * nothing left to show under it.
 */
async function fetchBannerSections(
  game: GameKey,
  categories: BannerListingCategory[],
): Promise<BannerCategorySection[]> {
  const entries: (BannerListingEntry & { categoryLabel: string })[] = categories.flatMap((cat) =>
    cat.banners.map((b) => ({ ...b, categoryLabel: cat.label })),
  );

  // A single Banner's parse failure must not take down its whole category
  // (same failure posture as fetchEvents' per-event handling).
  const fetchDetail = async (
    entry: BannerListingEntry & { categoryLabel: string },
  ): Promise<BannerInfo | null> => {
    try {
      const info = await showBanner(game, entry.title);
      // The detail page's own image resolution can fail; the listing's
      // already-resolved thumbnail is kept as a fallback rather than
      // leaving the card with no art at all.
      return info.imageUrl ? info : { ...info, imageUrl: entry.thumbUrl };
    } catch (e) {
      console.warn(`gachagremlin-web: failed to fetch ${game} banner ${JSON.stringify(entry.title)}:`, e);
      return null;
    }
  };

  const details = await mapLimit(entries, CONCURRENCY, fetchDetail);

  const sections: BannerCategorySection[] = [];
  const sectionByLabel = new Map<string, BannerCategorySection>();
  for (const cat of categories) {
    if (sectionByLabel.has(cat.label)) continue;
    const group = findBannerGroupByLabel(game, cat.label);
    const section: BannerCategorySection = {
      key: group?.key ?? slugify(cat.label),
      label: group?.label ?? cat.label,
      banners: [],
    };
    sectionByLabel.set(cat.label, section);
    sections.push(section);
  }
  entries.forEach((entry, i) => {
    const info = details[i];
    if (info) sectionByLabel.get(entry.categoryLabel)!.banners.push(info);
  });

  return sections.filter((s) => s.banners.length > 0);
}
