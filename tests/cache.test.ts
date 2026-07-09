import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedSource } from '../src/data/cache.ts';
import type { EventSource } from '../src/data/source.ts';
import type { GameEvents } from '../src/types.ts';

// Vitest's default environment is Node, which has no localStorage. A tiny
// in-memory Storage stand-in is enough for cache.ts's get/set/JSON usage —
// no need to pull in jsdom for one module.
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function makeEvents(fetchedAt: number, tag: string): GameEvents {
  return { current: [{ name: tag } as never], upcoming: [], fetchedAt };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('cachedSource', () => {
  it('serves from cache on a fresh hit without calling the inner source', async () => {
    const now = 1_000_000;
    const inner: EventSource = { fetchEvents: vi.fn().mockResolvedValue(makeEvents(now, 'fresh')) };
    const source = cachedSource(inner, 30 * 60_000, () => now);

    const first = await source.fetchEvents('genshin');
    const second = await source.fetchEvents('genshin');

    expect(first.current[0]).toMatchObject({ name: 'fresh' });
    expect(second).toEqual(first);
    expect(inner.fetchEvents).toHaveBeenCalledTimes(1); // second call was a cache hit
  });

  it('refetches once the TTL has expired', async () => {
    let now = 1_000_000;
    const inner: EventSource = {
      fetchEvents: vi.fn().mockImplementation(async () => makeEvents(now, `t${now}`)),
    };
    const ttl = 30 * 60_000;
    const source = cachedSource(inner, ttl, () => now);

    await source.fetchEvents('genshin');
    now += ttl + 1; // past expiry
    const second = await source.fetchEvents('genshin');

    expect(second.current[0]).toMatchObject({ name: `t${now}` });
    expect(inner.fetchEvents).toHaveBeenCalledTimes(2);
  });

  it('serves stale cache flagged when a refetch fails', async () => {
    let now = 1_000_000;
    const inner: EventSource = {
      fetchEvents: vi
        .fn()
        .mockResolvedValueOnce(makeEvents(now, 'ok'))
        .mockRejectedValueOnce(new Error('wiki down')),
    };
    const ttl = 30 * 60_000;
    const source = cachedSource(inner, ttl, () => now);

    await source.fetchEvents('genshin');
    now += ttl + 1;
    const second = await source.fetchEvents('genshin');

    expect(second.stale).toBe(true);
    expect(second.current[0]).toMatchObject({ name: 'ok' });
  });

  it('throws when there is no cache and the fetch fails', async () => {
    const inner: EventSource = { fetchEvents: vi.fn().mockRejectedValue(new Error('down')) };
    const source = cachedSource(inner, 30 * 60_000, () => 1_000_000);

    await expect(source.fetchEvents('genshin')).rejects.toThrow('down');
  });

  it('forceRefresh bypasses the cache and updates it', async () => {
    let now = 1_000_000;
    const inner: EventSource = {
      fetchEvents: vi.fn().mockImplementation(async () => makeEvents(now, `t${now}`)),
    };
    const source = cachedSource(inner, 30 * 60_000, () => now);

    await source.fetchEvents('genshin'); // populates cache, still fresh
    const refreshed = await source.forceRefresh('genshin');
    expect(inner.fetchEvents).toHaveBeenCalledTimes(2);

    // The forced refresh's result is now the cached value.
    const third = await source.fetchEvents('genshin');
    expect(third).toEqual(refreshed);
  });

  it('keeps separate cache entries per game', async () => {
    const now = 1_000_000;
    const inner: EventSource = {
      fetchEvents: vi.fn().mockImplementation(async (game) => makeEvents(now, game)),
    };
    const source = cachedSource(inner, 30 * 60_000, () => now);

    const genshin = await source.fetchEvents('genshin');
    const hsr = await source.fetchEvents('hsr');

    expect(genshin.current[0]).toMatchObject({ name: 'genshin' });
    expect(hsr.current[0]).toMatchObject({ name: 'hsr' });
  });
});
