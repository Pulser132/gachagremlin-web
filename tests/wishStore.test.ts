import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compareIds,
  getActiveAccount,
  importPayload,
  importPayloads,
  loadAccount,
  mergeItems,
  setActiveUid,
} from '../src/data/wishes/store.ts';
import type { WishItem, WishPayload } from '../src/types.ts';

// Same in-memory Storage stand-in used by tests/cache.test.ts — Vitest's
// default Node environment has no localStorage.
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

function item(id: string, overrides: Partial<WishItem> = {}): WishItem {
  return { id, bannerType: '301', name: 'Test', itemType: 'Character', rank: '4', time: '2026-01-01 00:00:00', ...overrides };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('compareIds', () => {
  it('orders shorter strings before longer ones regardless of lexicographic value', () => {
    expect(compareIds('9', '10')).toBeLessThan(0);
  });

  it('orders equal-length strings lexicographically', () => {
    expect(compareIds('100', '099')).toBeGreaterThan(0);
    expect(compareIds('100', '100')).toBe(0);
  });
});

describe('mergeItems', () => {
  it('unions two lists, sorted ascending by id', () => {
    const merged = mergeItems([item('2'), item('1')], [item('3')]);
    expect(merged.map((i) => i.id)).toEqual(['1', '2', '3']);
  });

  it('dedupes by id, preferring the incoming copy', () => {
    const merged = mergeItems([item('1', { name: 'Old' })], [item('1', { name: 'New' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('New');
  });

  it('never drops an id present only in the existing list (aged-out pulls)', () => {
    const merged = mergeItems([item('1'), item('2')], [item('3')]);
    expect(merged.map((i) => i.id)).toEqual(['1', '2', '3']);
  });
});

function makePayload(overrides: Partial<WishPayload> = {}): WishPayload {
  return { game: 'genshin', uid: 'uid1', region: 'os_usa', exportedAt: 1000, items: [item('1'), item('2')], ...overrides };
}

describe('importPayload', () => {
  it('stores a new account and marks it active', () => {
    const account = importPayload(makePayload(), () => 5000);
    expect(account.uid).toBe('uid1');
    expect(account.items).toHaveLength(2);
    expect(account.updatedAt).toBe(5000);
    expect(getActiveAccount('genshin')).toEqual(account);
  });

  it('merges into an existing account for the same uid instead of replacing it', () => {
    importPayload(makePayload({ items: [item('1'), item('2')] }), () => 1000);
    const second = importPayload(makePayload({ items: [item('2'), item('3')] }), () => 2000);

    expect(second.items.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(second.updatedAt).toBe(2000);
  });

  it('keeps separate accounts per uid within the same game', () => {
    importPayload(makePayload({ uid: 'uidA', items: [item('1')] }));
    importPayload(makePayload({ uid: 'uidB', items: [item('2')] }));

    expect(loadAccount('genshin', 'uidA')?.items.map((i) => i.id)).toEqual(['1']);
    expect(loadAccount('genshin', 'uidB')?.items.map((i) => i.id)).toEqual(['2']);
  });

  it('keeps separate accounts per game for the same uid', () => {
    importPayload(makePayload({ game: 'genshin', uid: 'shared', items: [item('1')] }));
    importPayload(makePayload({ game: 'hsr', uid: 'shared', items: [item('9')] }));

    expect(loadAccount('genshin', 'shared')?.items.map((i) => i.id)).toEqual(['1']);
    expect(loadAccount('hsr', 'shared')?.items.map((i) => i.id)).toEqual(['9']);
  });

  it('re-importing the same payload leaves item count unchanged', () => {
    const payload = makePayload();
    importPayload(payload, () => 1000);
    const second = importPayload(payload, () => 2000);
    expect(second.items).toHaveLength(2);
  });
});

describe('importPayloads', () => {
  it('imports every payload (e.g. every account in a multi-uid UIGF file) and stores each separately', () => {
    const results = importPayloads(
      [makePayload({ uid: 'uidA', items: [item('1')] }), makePayload({ uid: 'uidB', items: [item('9')] })],
      () => 5000,
    );

    expect(results.map((a) => a.uid)).toEqual(['uidA', 'uidB']);
    expect(loadAccount('genshin', 'uidA')?.items.map((i) => i.id)).toEqual(['1']);
    expect(loadAccount('genshin', 'uidB')?.items.map((i) => i.id)).toEqual(['9']);
  });

  it('leaves the last payload’s uid active, matching importPayload’s single-payload behavior', () => {
    importPayloads([makePayload({ uid: 'uidA' }), makePayload({ uid: 'uidB', items: [item('9')] })]);
    expect(getActiveAccount('genshin')?.uid).toBe('uidB');
  });
});

describe('getActiveAccount / setActiveUid', () => {
  it('returns null when nothing has been imported yet', () => {
    expect(getActiveAccount('genshin')).toBeNull();
  });

  it('switches the active account without touching stored data', () => {
    importPayload(makePayload({ uid: 'uidA' }));
    importPayload(makePayload({ uid: 'uidB', items: [item('9')] }));
    expect(getActiveAccount('genshin')?.uid).toBe('uidB'); // most recent import wins

    setActiveUid('genshin', 'uidA');
    expect(getActiveAccount('genshin')?.uid).toBe('uidA');
  });
});
