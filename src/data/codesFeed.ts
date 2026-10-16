/**
 * Refresh policy for the Codes tab: fetch on tab open and window focus, at most
 * once per `CODES_MIN_INTERVAL_MS` per game, never on a timer, and revalidate
 * with `If-None-Match`. Clock and fetch are injected so the policy is testable.
 */
import type { GameKey } from '../types.ts';
import { fetchCodesConditional, parseCodeItem, type CodesApiOptions, type CodesResult } from './codesApi.ts';

export const CODES_MIN_INTERVAL_MS = 5 * 60_000;

/**
 * A bot `lastCheckedAt` older than this is shown with a stale warning. The bot
 * is only up while the host PC is awake, so a few hours of silence is normal
 * overnight; 6 h flags a list that has likely missed a day's new Codes.
 */
export const CODES_STALE_AFTER_MS = 6 * 3600_000;

export function isCodesStale(lastCheckedAt: number | null, now: number): boolean {
  return lastCheckedAt === null || now - lastCheckedAt > CODES_STALE_AFTER_MS;
}

type CodesStorage = Pick<Storage, 'getItem' | 'setItem'>;
const storageKey = (game: GameKey) => `gachagremlin.codes.v1.${game}`;

function defaultStorage(): CodesStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

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

function loadEntry(storage: CodesStorage | null, game: GameKey): Entry | null {
  try {
    const raw = storage?.getItem(storageKey(game));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || typeof v.checkedAt !== 'number' || typeof v.data !== 'object' || v.data === null || !Array.isArray(v.data.items)) return null;
    return {
      data: {
        items: v.data.items.map(parseCodeItem),
        lastCheckedAt: typeof v.data.lastCheckedAt === 'number' ? v.data.lastCheckedAt : null,
      },
      checkedAt: v.checkedAt,
      etag: typeof v.etag === 'string' ? v.etag : null,
    };
  } catch {
    return null;
  }
}

function saveEntry(storage: CodesStorage | null, game: GameKey, e: Entry): void {
  try {
    storage?.setItem(storageKey(game), JSON.stringify(e));
  } catch {
    /* quota or blocked storage: the in-memory copy still works */
  }
}

export function createCodesFeed(
  opts: CodesApiOptions & { now?: () => number; minIntervalMs?: number; storage?: CodesStorage | null } = {},
): CodesFeed {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const now = opts.now ?? Date.now;
  const minInterval = opts.minIntervalMs ?? CODES_MIN_INTERVAL_MS;
  const entries = new Map<GameKey, Entry>();
  const entryFor = (game: GameKey): Entry | undefined => {
    let e = entries.get(game);
    if (!e) {
      e = loadEntry(storage, game) ?? undefined;
      if (e) entries.set(game, e);
    }
    return e;
  };
  const inflight = new Map<GameKey, Promise<CodesRefresh>>();

  const view = (e: Entry | undefined, changed: boolean): CodesRefresh => ({
    data: e?.data ?? null,
    checkedAt: e?.checkedAt ?? null,
    changed,
  });

  async function run(game: GameKey): Promise<CodesRefresh> {
    const prev = entryFor(game);
    const out = await fetchCodesConditional(game, prev?.etag ?? null, opts);
    if ('notModified' in out && prev) {
      const next = { ...prev, checkedAt: now() };
      entries.set(game, next);
      saveEntry(storage, game, next);
      return view(next, false);
    }
    if ('notModified' in out) throw new Error('304 without a cached list');
    const next: Entry = { data: { items: out.items, lastCheckedAt: out.lastCheckedAt }, checkedAt: now(), etag: out.etag };
    entries.set(game, next);
    saveEntry(storage, game, next);
    return view(next, true);
  }

  return {
    refresh(game) {
      const prev = entryFor(game);
      if (prev && now() - prev.checkedAt < minInterval) return Promise.resolve(view(prev, false));
      let p = inflight.get(game);
      if (!p) {
        p = run(game).finally(() => inflight.delete(game));
        inflight.set(game, p);
      }
      return p;
    },
    cached: (game) => entryFor(game) ?? null,
  };
}
