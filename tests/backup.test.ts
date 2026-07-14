import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_SCHEMA_VERSION, exportAll, importBackup } from '../src/data/backup.ts';
import { listReminders, toggleReminder } from '../src/data/reminders.ts';
import { getActiveUid, importPayload, loadAccount, setNickname } from '../src/data/wishes/store.ts';
import type { WishItem, WishPayload } from '../src/types.ts';

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

function makePayload(overrides: Partial<WishPayload> = {}): WishPayload {
  return { game: 'genshin', uid: 'uid1', region: 'os_usa', exportedAt: 1000, items: [item('1'), item('2')], ...overrides };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

/** Populates two genshin accounts, an hsr account, a nickname, a reminder,
 * and a pref — a representative slice of app state. */
function seed(): void {
  importPayload(makePayload({ uid: 'main', items: [item('1'), item('2')] }));
  importPayload(makePayload({ uid: 'alt', items: [item('3')] }));
  importPayload(makePayload({ game: 'hsr', uid: 'hsr1', items: [item('9')] }));
  setNickname('genshin', 'main', 'Main');
  toggleReminder('genshin', 'genshin:character event wish:test banner');
  localStorage.setItem('gachagremlin:selectedGame', 'hsr');
}

describe('exportAll', () => {
  it('captures accounts, active uid, nickname, reminders, and prefs', () => {
    seed();
    const backup = exportAll(() => 42);

    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(backup.app).toBe('gachagremlin');
    expect(backup.exportedAt).toBe(42);
    expect(Object.keys(backup.games.genshin.accounts).sort()).toEqual(['alt', 'main']);
    expect(backup.games.genshin.accounts.main.nickname).toBe('Main');
    expect(backup.games.genshin.activeUid).toBe('alt'); // last imported for genshin
    expect(backup.games.genshin.reminders).toEqual(['genshin:character event wish:test banner']);
    expect(backup.prefs.selectedGame).toBe('hsr');
  });
});

describe('importBackup', () => {
  it('round-trips through a cleared cache', () => {
    seed();
    const backup = exportAll();

    localStorage.clear(); // simulate the user wiping browser storage

    const result = importBackup(backup);
    expect(result.accounts).toBe(3);
    expect(result.reminders).toBe(1);

    expect(loadAccount('genshin', 'main')?.items.map((i) => i.id)).toEqual(['1', '2']);
    expect(loadAccount('genshin', 'main')?.nickname).toBe('Main');
    expect(loadAccount('hsr', 'hsr1')?.items.map((i) => i.id)).toEqual(['9']);
    expect(getActiveUid('genshin')).toBe('alt');
    expect(listReminders('genshin')).toEqual(['genshin:character event wish:test banner']);
    expect(localStorage.getItem('gachagremlin:selectedGame')).toBe('hsr');
  });

  it('merges (never duplicates) when importing over existing data', () => {
    importPayload(makePayload({ uid: 'main', items: [item('1')] }));
    const backup = exportAll();
    // local gains a new pull after the backup was taken
    importPayload(makePayload({ uid: 'main', items: [item('5')] }));

    importBackup(backup);
    // union of {1} (backup) and {1,5} (local), no duplicate 1
    expect(loadAccount('genshin', 'main')?.items.map((i) => i.id)).toEqual(['1', '5']);
  });

  it('unions reminders rather than replacing them', () => {
    toggleReminder('genshin', 'a');
    const backup = exportAll();
    toggleReminder('genshin', 'a'); // removed locally
    toggleReminder('genshin', 'b'); // added locally

    importBackup(backup);
    expect(listReminders('genshin').sort()).toEqual(['a', 'b']);
  });

  it('rejects a non-GachaGremlin or wrong-version file', () => {
    expect(() => importBackup({ app: 'other', schemaVersion: 1, games: {} })).toThrow(/not a GachaGremlin backup/i);
    expect(() => importBackup({ app: 'gachagremlin', schemaVersion: 999, games: {} })).toThrow(/Unsupported backup version/i);
    expect(() => importBackup(null)).toThrow(/valid backup/i);
  });
});
