/**
 * `EventSource` implementation that fetches events straight from the Fandom
 * wikis. Detail fetches are limited to a small concurrency so a page with
 * many events doesn't fire dozens of simultaneous requests at once.
 */
import type { EventSource } from '../source.ts';
import type { EventInfo, GameEvents, GameKey } from '../../types.ts';
import { listEvents, showEvent } from './fetch.ts';
import { normalizeGlobalRegionUnix } from './times.ts';

const CONCURRENCY = 4;

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

export class WikiSource implements EventSource {
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
}
