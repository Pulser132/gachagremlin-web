import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compareIds,
  deleteAccount,
  getActiveAccount,
  getActiveUid,
  importPayload,
  importPayloads,
  listAccounts,
  loadAccount,
  mergeItems,
  restoreAccount,
  setActiveUid,
  setNickname,
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
    expect(getActiveUid('genshin')).toBe('uidA');
  });
});

describe('listAccounts', () => {
  it('lists every stored uid for a game, ignoring the activeUid pointer and other games', () => {
    importPayload(makePayload({ uid: 'uidB' }));
    importPayload(makePayload({ uid: 'uidA' }));
    importPayload(makePayload({ game: 'hsr', uid: 'other', items: [item('9')] }));

    expect(listAccounts('genshin').map((a) => a.uid)).toEqual(['uidA', 'uidB']); // sorted by uid
    expect(listAccounts('hsr').map((a) => a.uid)).toEqual(['other']);
    expect(listAccounts('zzz')).toEqual([]);
  });

  it('includes the nickname when one is set', () => {
    importPayload(makePayload({ uid: 'uidA' }));
    setNickname('genshin', 'uidA', 'Main');
    expect(listAccounts('genshin')).toEqual([{ uid: 'uidA', nickname: 'Main' }]);
  });
});

describe('setNickname', () => {
  it('sets and clears a nickname, preserving it across re-import', () => {
    importPayload(makePayload({ uid: 'uidA', items: [item('1')] }));
    setNickname('genshin', 'uidA', '  Alt  ');
    expect(loadAccount('genshin', 'uidA')?.nickname).toBe('Alt'); // trimmed

    // re-import must not wipe the label
    importPayload(makePayload({ uid: 'uidA', items: [item('2')] }));
    expect(loadAccount('genshin', 'uidA')?.nickname).toBe('Alt');

    setNickname('genshin', 'uidA', '');
    expect(loadAccount('genshin', 'uidA')?.nickname).toBeUndefined();
  });

  it('is a no-op for an unknown uid', () => {
    setNickname('genshin', 'ghost', 'X');
    expect(loadAccount('genshin', 'ghost')).toBeNull();
  });

  it('stamps nicknameUpdatedAt but leaves updatedAt alone', () => {
    importPayload(makePayload({ uid: 'uidA', items: [item('1')] }), () => 1000);
    expect(loadAccount('genshin', 'uidA')?.updatedAt).toBe(1000);

    setNickname('genshin', 'uidA', 'Main', () => 5000);
    const account = loadAccount('genshin', 'uidA');
    expect(account?.nicknameUpdatedAt).toBe(5000);
    // updatedAt means "last imported pulls" and is shown as "imported <date>":
    // a rename must not make the UI claim an import that never happened.
    expect(account?.updatedAt).toBe(1000);
  });
});

describe('deleteAccount', () => {
  it('removes only the given account', () => {
    importPayload(makePayload({ uid: 'uidA', items: [item('1')] }));
    importPayload(makePayload({ uid: 'uidB', items: [item('2')] }));

    deleteAccount('genshin', 'uidA');
    expect(loadAccount('genshin', 'uidA')).toBeNull();
    expect(loadAccount('genshin', 'uidB')?.items.map((i) => i.id)).toEqual(['2']);
  });

  it('repoints the active pointer to a remaining account when the active one is deleted', () => {
    importPayload(makePayload({ uid: 'uidA' }));
    importPayload(makePayload({ uid: 'uidB', items: [item('9')] }));
    expect(getActiveUid('genshin')).toBe('uidB'); // last import active

    deleteAccount('genshin', 'uidB');
    expect(getActiveUid('genshin')).toBe('uidA');
  });

  it('clears the active pointer when the last account is deleted', () => {
    importPayload(makePayload({ uid: 'uidA' }));
    deleteAccount('genshin', 'uidA');
    expect(getActiveUid('genshin')).toBeNull();
    expect(getActiveAccount('genshin')).toBeNull();
  });
});

describe('restoreAccount', () => {
  it('merges pulls into an existing account without moving the active pointer', () => {
    importPayload(makePayload({ uid: 'uidA', items: [item('1')] }));
    importPayload(makePayload({ uid: 'uidB', items: [item('9')] }));
    expect(getActiveUid('genshin')).toBe('uidB');

    restoreAccount('genshin', { uid: 'uidA', region: 'os_usa', items: [item('2')], updatedAt: 5 });
    expect(loadAccount('genshin', 'uidA')?.items.map((i) => i.id)).toEqual(['1', '2']);
    expect(getActiveUid('genshin')).toBe('uidB'); // unchanged
  });

  it('creates a brand-new account and never duplicates pulls on re-restore', () => {
    const account = { uid: 'uidC', region: 'os_usa', items: [item('1'), item('2')], updatedAt: 5 };
    restoreAccount('genshin', account);
    restoreAccount('genshin', account);
    expect(loadAccount('genshin', 'uidC')?.items.map((i) => i.id)).toEqual(['1', '2']);
  });

  it('keeps a locally-set nickname over an un-timestamped backup copy', () => {
    importPayload(makePayload({ uid: 'uidA', items: [item('1')] }));
    setNickname('genshin', 'uidA', 'Local');
    restoreAccount('genshin', { uid: 'uidA', region: 'os_usa', items: [item('2')], updatedAt: 5, nickname: 'Backup' });
    expect(loadAccount('genshin', 'uidA')?.nickname).toBe('Local');
  });

  // Under cloud sync this runs on every pull, so a rename made on another
  // device has to be able to win — otherwise renames never propagate.
  it('adopts a newer rename from the incoming copy', () => {
    importPayload(makePayload({ uid: 'uidA', items: [item('1')] }));
    setNickname('genshin', 'uidA', 'Local', () => 100);

    restoreAccount('genshin', {
      uid: 'uidA',
      region: 'os_usa',
      items: [item('2')],
      updatedAt: 5,
      nickname: 'Renamed elsewhere',
      nicknameUpdatedAt: 200,
    });
    expect(loadAccount('genshin', 'uidA')?.nickname).toBe('Renamed elsewhere');
    expect(loadAccount('genshin', 'uidA')?.nicknameUpdatedAt).toBe(200);
  });

  it('keeps the local rename when it is the newer one', () => {
    importPayload(makePayload({ uid: 'uidA', items: [item('1')] }));
    setNickname('genshin', 'uidA', 'Local', () => 300);

    restoreAccount('genshin', {
      uid: 'uidA',
      region: 'os_usa',
      items: [item('2')],
      updatedAt: 5,
      nickname: 'Older',
      nicknameUpdatedAt: 200,
    });
    expect(loadAccount('genshin', 'uidA')?.nickname).toBe('Local');
    expect(loadAccount('genshin', 'uidA')?.nicknameUpdatedAt).toBe(300);
  });

  it('propagates a rename that cleared the label', () => {
    importPayload(makePayload({ uid: 'uidA', items: [item('1')] }));
    setNickname('genshin', 'uidA', 'Local', () => 100);

    // Another device cleared the nickname; that is still a newer rename.
    restoreAccount('genshin', {
      uid: 'uidA',
      region: 'os_usa',
      items: [item('2')],
      updatedAt: 5,
      nickname: undefined,
      nicknameUpdatedAt: 200,
    });
    expect(loadAccount('genshin', 'uidA')?.nickname).toBeUndefined();
  });

  it('adopts the incoming nickname when the local account has none', () => {
    importPayload(makePayload({ uid: 'uidA', items: [item('1')] }));
    restoreAccount('genshin', { uid: 'uidA', region: 'os_usa', items: [item('2')], updatedAt: 5, nickname: 'FromCloud' });
    expect(loadAccount('genshin', 'uidA')?.nickname).toBe('FromCloud');
  });
});
