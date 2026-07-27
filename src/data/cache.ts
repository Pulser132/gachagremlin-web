/**
 * localStorage TTL cache wrapping any single-argument async fetcher.
 *
 * Generic over its payload type, with the storage-key prefix passed in by
 * the caller — so Events and Banners (and any future per-game payload) each
 * get the fresh-hit / expired-refetch / stale-on-failure / forceRefresh
 * semantics below without a second copy of this logic, while caching under
 * their own key namespace so clearing or corrupting one never affects
 * another.
 *
 * Fresh within the TTL -> served straight from cache (no network). Expired
 * -> refetch; on refetch failure, serve the stale cache flagged so the UI
 * can show a "showing cached data" notice instead of a blank error page.
 */
import type { GameKey } from '../types.ts';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

/** The minimal shape a cacheable payload must have: a fetch timestamp, and
 * an optional stale flag this wrapper sets on a degraded read. */
interface Staleable {
  fetchedAt: number;
  stale?: boolean;
}

export interface CachedSource<T> {
  fetch(game: GameKey): Promise<T>;
  /** Bypass the cache and refetch immediately, updating the cache on success. */
  forceRefresh(game: GameKey): Promise<T>;
}

function storageKey(prefix: string, game: GameKey): string {
  return `${prefix}${game}`;
}

function readCache<T>(prefix: string, game: GameKey): T | null {
  try {
    const raw = localStorage.getItem(storageKey(prefix, game));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null; // corrupt entry or storage unavailable — treat as a cache miss
  }
}

function writeCache<T>(prefix: string, game: GameKey, data: T): void {
  try {
    localStorage.setItem(storageKey(prefix, game), JSON.stringify(data));
  } catch {
    // localStorage full or unavailable (e.g. private browsing) — degrade
    // to network-only silently, the site still works without the cache.
  }
}

/**
 * @param fetchInner the underlying fetch, e.g. `(game) => wikiSource.fetchEvents(game)`.
 * @param storagePrefix namespaces this cache's localStorage keys, e.g. `'gachagremlin:events:'`.
 * @param clock injectable for tests; defaults to the real wall clock.
 */
export function cachedSource<T extends Staleable>(
  fetchInner: (game: GameKey) => Promise<T>,
  storagePrefix: string,
  ttlMs = DEFAULT_TTL_MS,
  clock: () => number = Date.now,
): CachedSource<T> {
  async function fetchFresh(game: GameKey): Promise<T> {
    const data = await fetchInner(game);
    writeCache(storagePrefix, game, data);
    return data;
  }

  // Shared by both entry points below, so an explicit Refresh click degrades
  // to stale cached data exactly like an expiry-triggered refetch does —
  // a failed refresh must never blank out a still-good cached list.
  async function fetchFreshOrStale(game: GameKey, cached: T | null): Promise<T> {
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
    fetch(game: GameKey): Promise<T> {
      const cached = readCache<T>(storagePrefix, game);
      if (cached && clock() - cached.fetchedAt < ttlMs) {
        return Promise.resolve(cached);
      }
      return fetchFreshOrStale(game, cached);
    },

    forceRefresh(game: GameKey): Promise<T> {
      return fetchFreshOrStale(game, readCache<T>(storagePrefix, game));
    },
  };
}
