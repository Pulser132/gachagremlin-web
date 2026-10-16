/**
 * Refresh policy for the Codes tab: fetch on tab open and window focus, at most
 * once per `CODES_MIN_INTERVAL_MS` per game, never on a timer, and revalidate
 * with `If-None-Match`. Clock and fetch are injected so the policy is testable.
 */
import type { GameKey } from '../types.ts';
import { fetchCodesConditional, type CodesApiOptions, type CodesResult } from './codesApi.ts';

export const CODES_MIN_INTERVAL_MS = 5 * 60_000;

export interface CodesSnapshot {
  data: CodesResult;
  /** Client clock (ms) of the last successful check, a 304 included. */
  checkedAt: number;
}

export interface CodesRefresh {
  data: CodesResult | null;
  checkedAt: number | null;
  /** True when this call fetched a new list rather than reusing the cached one. */
  changed: boolean;
}

export interface CodesFeed {
  /** Throttled: reuses the cache inside the minimum interval. Rejects on fetch failure. */
  refresh(game: GameKey): Promise<CodesRefresh>;
  cached(game: GameKey): CodesSnapshot | null;
}

interface Entry extends CodesSnapshot {
  etag: string | null;
}

export function createCodesFeed(opts: CodesApiOptions & { now?: () => number; minIntervalMs?: number } = {}): CodesFeed {
  const now = opts.now ?? Date.now;
  const minInterval = opts.minIntervalMs ?? CODES_MIN_INTERVAL_MS;
  const entries = new Map<GameKey, Entry>();
  const inflight = new Map<GameKey, Promise<CodesRefresh>>();

  const view = (e: Entry | undefined, changed: boolean): CodesRefresh => ({
    data: e?.data ?? null,
    checkedAt: e?.checkedAt ?? null,
    changed,
  });

  async function run(game: GameKey): Promise<CodesRefresh> {
    const prev = entries.get(game);
    const out = await fetchCodesConditional(game, prev?.etag ?? null, opts);
    if ('notModified' in out && prev) {
      const next = { ...prev, checkedAt: now() };
      entries.set(game, next);
      return view(next, false);
    }
    if ('notModified' in out) throw new Error('304 without a cached list');
    const next: Entry = { data: { items: out.items, lastCheckedAt: out.lastCheckedAt }, checkedAt: now(), etag: out.etag };
    entries.set(game, next);
    return view(next, true);
  }

  return {
    refresh(game) {
      const prev = entries.get(game);
      if (prev && now() - prev.checkedAt < minInterval) return Promise.resolve(view(prev, false));
      let p = inflight.get(game);
      if (!p) {
        p = run(game).finally(() => inflight.delete(game));
        inflight.set(game, p);
      }
      return p;
    },
    cached: (game) => entries.get(game) ?? null,
  };
}
