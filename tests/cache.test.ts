import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedSource } from '../src/data/cache.ts';
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

const EVENTS_PREFIX = 'gachagremlin:events:';

function makeEvents(fetchedAt: number, tag: string): GameEvents {
  return { current: [{ name: tag } as never], upcoming: [], fetchedAt };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('cachedSource', () => {
  it('serves from cache on a fresh hit without calling the inner fetch', async () => {
    const now = 1_000_000;
    const inner = vi.fn().mockResolvedValue(makeEvents(now, 'fresh'));
    const source = cachedSource(inner, EVENTS_PREFIX, 30 * 60_000, () => now);

    const first = await source.fetch('genshin');
    const second = await source.fetch('genshin');

    expect(first.current[0]).toMatchObject({ name: 'fresh' });
    expect(second).toEqual(first);
    expect(inner).toHaveBeenCalledTimes(1); // second call was a cache hit
  });

  it('refetches once the TTL has expired', async () => {
    let now = 1_000_000;
    const inner = vi.fn().mockImplementation(async () => makeEvents(now, `t${now}`));
    const ttl = 30 * 60_000;
    const source = cachedSource(inner, EVENTS_PREFIX, ttl, () => now);

    await source.fetch('genshin');
    now += ttl + 1; // past expiry
    const second = await source.fetch('genshin');

    expect(second.current[0]).toMatchObject({ name: `t${now}` });
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it('serves stale cache flagged when a refetch fails', async () => {
    let now = 1_000_000;
    const inner = vi
      .fn()
      .mockResolvedValueOnce(makeEvents(now, 'ok'))
      .mockRejectedValueOnce(new Error('wiki down'));
    const ttl = 30 * 60_000;
    const source = cachedSource(inner, EVENTS_PREFIX, ttl, () => now);

    await source.fetch('genshin');
    now += ttl + 1;
    const second = await source.fetch('genshin');

    expect(second.stale).toBe(true);
    expect(second.current[0]).toMatchObject({ name: 'ok' });
  });

  it('forceRefresh falls back to stale cache instead of throwing when one exists', async () => {
    const now = 1_000_000;
    const inner = vi
      .fn()
      .mockResolvedValueOnce(makeEvents(now, 'ok'))
      .mockRejectedValueOnce(new Error('offline'));
    const source = cachedSource(inner, EVENTS_PREFIX, 30 * 60_000, () => now);

    await source.fetch('genshin'); // populate cache
    const refreshed = await source.forceRefresh('genshin'); // network fails this time

    expect(refreshed.stale).toBe(true);
    expect(refreshed.current[0]).toMatchObject({ name: 'ok' });
  });

  it('forceRefresh still throws when there is no cache to fall back to', async () => {
    const inner = vi.fn().mockRejectedValue(new Error('offline'));
    const source = cachedSource(inner, EVENTS_PREFIX, 30 * 60_000, () => 1_000_000);

    await expect(source.forceRefresh('genshin')).rejects.toThrow('offline');
  });

  it('throws when there is no cache and the fetch fails', async () => {
    const inner = vi.fn().mockRejectedValue(new Error('down'));
    const source = cachedSource(inner, EVENTS_PREFIX, 30 * 60_000, () => 1_000_000);

    await expect(source.fetch('genshin')).rejects.toThrow('down');
  });

  it('forceRefresh bypasses the cache and updates it', async () => {
    let now = 1_000_000;
    const inner = vi.fn().mockImplementation(async () => makeEvents(now, `t${now}`));
    const source = cachedSource(inner, EVENTS_PREFIX, 30 * 60_000, () => now);

    await source.fetch('genshin'); // populates cache, still fresh
    const refreshed = await source.forceRefresh('genshin');
    expect(inner).toHaveBeenCalledTimes(2);

    // The forced refresh's result is now the cached value.
    const third = await source.fetch('genshin');
    expect(third).toEqual(refreshed);
  });

  it('keeps separate cache entries per game', async () => {
    const now = 1_000_000;
    const inner = vi.fn().mockImplementation(async (game: string) => makeEvents(now, game));
    const source = cachedSource(inner, EVENTS_PREFIX, 30 * 60_000, () => now);

    const genshin = await source.fetch('genshin');
    const hsr = await source.fetch('hsr');

    expect(genshin.current[0]).toMatchObject({ name: 'genshin' });
    expect(hsr.current[0]).toMatchObject({ name: 'hsr' });
  });

  // Generalization coverage: a second, structurally different payload type
  // (mirroring GameBanners) cached under its own storage prefix, proving the
  // wrapper isn't secretly still Events-shaped.
  describe('with a second payload type and storage prefix (Banners)', () => {
    interface FakeBanners {
      sections: string[];
      fetchedAt: number;
      stale?: boolean;
    }
    const BANNERS_PREFIX = 'gachagremlin:banners:';

    function makeBanners(fetchedAt: number, tag: string): FakeBanners {
      return { sections: [tag], fetchedAt };
    }

    it('caches independently of an Events cache under a different prefix', async () => {
      const now = 1_000_000;
      const eventsInner = vi.fn().mockResolvedValue(makeEvents(now, 'events-tag'));
      const bannersInner = vi.fn().mockResolvedValue(makeBanners(now, 'banners-tag'));
      const events = cachedSource(eventsInner, EVENTS_PREFIX, 30 * 60_000, () => now);
      const banners = cachedSource(bannersInner, BANNERS_PREFIX, 30 * 60_000, () => now);

      await events.fetch('genshin');
      const bannerResult = await banners.fetch('genshin');

      expect(bannerResult.sections).toEqual(['banners-tag']);
      // Corrupting/clearing the events entry must not touch the banners entry.
      localStorage.removeItem(`${EVENTS_PREFIX}genshin`);
      const bannerAgain = await banners.fetch('genshin');
      expect(bannersInner).toHaveBeenCalledTimes(1); // still a cache hit
      expect(bannerAgain).toEqual(bannerResult);
    });

    it('holds fresh-hit, expiry-refetch, stale-on-failure, and forceRefresh for the Banners shape', async () => {
      let now = 1_000_000;
      const ttl = 30 * 60_000;
      const inner = vi
        .fn()
        .mockResolvedValueOnce(makeBanners(now, 'ok'))
        .mockRejectedValueOnce(new Error('wiki down'))
        .mockRejectedValueOnce(new Error('still down'));
      const source = cachedSource(inner, BANNERS_PREFIX, ttl, () => now);

      const first = await source.fetch('genshin');
      expect(await source.fetch('genshin')).toEqual(first); // fresh hit, no refetch
      expect(inner).toHaveBeenCalledTimes(1);

      now += ttl + 1;
      const stale = await source.fetch('genshin'); // expired -> refetch -> fails -> stale
      expect(stale.stale).toBe(true);
      expect(stale.sections).toEqual(['ok']);

      const forced = await source.forceRefresh('genshin');
      expect(forced.stale).toBe(true); // refetch fails again -> falls back to stale cache
    });
  });
});
