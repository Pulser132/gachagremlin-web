/**
 * localStorage TTL cache wrapping any EventSource.
 *
 * Fresh within the TTL -> served straight from cache (no network). Expired
 * -> refetch; on refetch failure, serve the stale cache flagged so the UI
 * can show a "showing cached data" notice instead of a blank error page.
 */
import type { EventSource } from './source.ts';
import type { GameEvents, GameKey } from '../types.ts';

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const STORAGE_PREFIX = 'gachagremlin:events:';

export interface CachedSource extends EventSource {
  /** Bypass the cache and refetch immediately, updating the cache on success. */
  forceRefresh(game: GameKey): Promise<GameEvents>;
}

function storageKey(game: GameKey): string {
  return `${STORAGE_PREFIX}${game}`;
}

function readCache(game: GameKey): GameEvents | null {
  try {
    const raw = localStorage.getItem(storageKey(game));
    if (!raw) return null;
    return JSON.parse(raw) as GameEvents;
  } catch {
    return null; // corrupt entry or storage unavailable — treat as a cache miss
  }
}

function writeCache(game: GameKey, data: GameEvents): void {
  try {
    localStorage.setItem(storageKey(game), JSON.stringify(data));
  } catch {
    // localStorage full or unavailable (e.g. private browsing) — degrade
    // to network-only silently, the site still works without the cache.
  }
}

/**
 * @param clock injectable for tests; defaults to the real wall clock.
 */
export function cachedSource(
  inner: EventSource,
  ttlMs = DEFAULT_TTL_MS,
  clock: () => number = Date.now,
): CachedSource {
  async function fetchFresh(game: GameKey): Promise<GameEvents> {
    const data = await inner.fetchEvents(game);
    writeCache(game, data);
    return data;
  }

  // Shared by both entry points below, so an explicit Refresh click degrades
  // to stale cached data exactly like an expiry-triggered refetch does —
  // a failed refresh must never blank out a still-good cached list.
  async function fetchFreshOrStale(game: GameKey, cached: GameEvents | null): Promise<GameEvents> {
    try {
      return await fetchFresh(game);
    } catch (e) {
      if (cached) {
        return { ...cached, stale: true };
      }
      throw e;
    }
  }

  return {
    fetchEvents(game: GameKey): Promise<GameEvents> {
      const cached = readCache(game);
      if (cached && clock() - cached.fetchedAt < ttlMs) {
        return Promise.resolve(cached);
      }
      return fetchFreshOrStale(game, cached);
    },

    forceRefresh(game: GameKey): Promise<GameEvents> {
      return fetchFreshOrStale(game, readCache(game));
    },
  };
}
