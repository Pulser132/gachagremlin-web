import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_SCHEMA_VERSION, exportAll, importBackup, UnsupportedBackupVersionError } from '../src/data/backup.ts';
import { hideEvent, listHiddenCategories, listHiddenNames, setCategoryHidden, unhideEvent } from '../src/data/eventPrefs.ts';
import { listReminders, toggleReminder } from '../src/data/reminders.ts';
import { getActiveUid, importPayload, loadAccount, setActiveUid, setNickname } from '../src/data/wishes/store.ts';
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

  // fullImportedAt rides the v1 schema additively: exportAll serializes whole
  // WishAccount objects, so no version bump — and both directions must hold.
  it('round-trips fullImportedAt through export → clear → import', () => {
    importPayload(makePayload({ uid: 'main', fullImport: true }), () => 777);
    const backup = exportAll();
    localStorage.clear();
    importBackup(backup);
    expect(loadAccount('genshin', 'main')?.fullImportedAt).toBe(777);
  });

  it('imports a v1 backup written before fullImportedAt existed (field absent everywhere)', () => {
    importPayload(makePayload({ uid: 'main', fullImport: true }), () => 777);
    const backup = exportAll();
    // Strip the field, as a backup from an older build genuinely lacks it.
    delete backup.games.genshin.accounts.main.fullImportedAt;
    localStorage.clear();
    const result = importBackup(backup);
    expect(result.accounts).toBe(1);
    // Absent correctly reads as "this account still needs a full import".
    expect(loadAccount('genshin', 'main')?.fullImportedAt).toBeUndefined();
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

  // Cloud sync must be able to tell "this file came from a newer build" apart
  // from every other rejection, because that case has to abort the sync rather
  // than push this build's older-shaped payload over the newer one.
  it('throws a typed UnsupportedBackupVersionError, distinguishable from other rejections', () => {
    expect(() => importBackup({ app: 'gachagremlin', schemaVersion: 2, games: {} })).toThrow(UnsupportedBackupVersionError);
    try {
      importBackup({ app: 'gachagremlin', schemaVersion: 2, games: {} });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedBackupVersionError);
      expect((e as UnsupportedBackupVersionError).found).toBe(2);
      expect((e as UnsupportedBackupVersionError).expected).toBe(BACKUP_SCHEMA_VERSION);
    }
    // The other rejection paths must NOT masquerade as a version problem.
    expect(() => importBackup({ app: 'other', schemaVersion: 1, games: {} })).not.toThrow(UnsupportedBackupVersionError);
    expect(() => importBackup(null)).not.toThrow(UnsupportedBackupVersionError);
  });
});

describe('event prefs in backups', () => {
  it('exportAll captures hide rules, hidden categories, and the sort pref', () => {
    hideEvent('genshin', 'Heated Battle Mode: Automatic Chess');
    setCategoryHidden('genshin', 'web', true);
    localStorage.setItem('gachagremlin:eventSort', 'time');

    const backup = exportAll();
    expect(backup.games.genshin.eventPrefs).toEqual({
      hiddenNames: ['heated battle mode'],
      hiddenCategories: ['web'],
    });
    expect(backup.games.hsr.eventPrefs).toEqual({ hiddenNames: [], hiddenCategories: [] });
    expect(backup.prefs.eventSort).toBe('time');
  });

  it('imports by union, re-canonicalizing names and filtering categories', () => {
    hideEvent('genshin', 'Local Rule');
    setCategoryHidden('genshin', 'other', true);

    const backup = exportAll();
    backup.games.genshin.eventPrefs = {
      // Raw variants a foreign/legacy file might carry — must canonicalize.
      hiddenNames: ['Heated Battle Mode: Prevailing Winds', 'LOCAL rule', 42 as never],
      hiddenCategories: ['web', 'bogus' as never],
    };

    importBackup(backup);
    expect(listHiddenNames('genshin').sort()).toEqual(['heated battle mode', 'local rule']);
    expect(listHiddenCategories('genshin').sort()).toEqual(['other', 'web']);
  });

  it('never removes a local rule — un-hiding is push-only for exactly this reason', () => {
    const key = hideEvent('genshin', 'Heated Battle Mode');
    const backup = exportAll();
    unhideEvent('genshin', key); // player un-hides after the backup was taken

    importBackup(backup);
    // The union resurrects it — which is why the un-hide path must sync
    // push-only instead of merging (verified at the sync layer, not here).
    expect(listHiddenNames('genshin')).toEqual(['heated battle mode']);
  });

  it('imports a legacy v1 file without eventPrefs cleanly', () => {
    seed();
    const backup = exportAll();
    for (const game of Object.values(backup.games)) delete game.eventPrefs;
    localStorage.clear();

    const result = importBackup(backup);
    expect(result.accounts).toBe(3);
    expect(listHiddenNames('genshin')).toEqual([]);
    expect(listHiddenCategories('genshin')).toEqual([]);
  });

  it('eventSort follows viewState: fill-if-absent preserves local, overwrite replaces', () => {
    localStorage.setItem('gachagremlin:eventSort', 'time');
    const backup = exportAll();

    localStorage.setItem('gachagremlin:eventSort', 'name'); // picked on this device
    importBackup(backup, { viewState: 'fill-if-absent' });
    expect(localStorage.getItem('gachagremlin:eventSort')).toBe('name');

    importBackup(backup); // manual restore: overwrite
    expect(localStorage.getItem('gachagremlin:eventSort')).toBe('time');

    localStorage.removeItem('gachagremlin:eventSort');
    importBackup(backup, { viewState: 'fill-if-absent' });
    expect(localStorage.getItem('gachagremlin:eventSort')).toBe('time');
  });
});

describe('importBackup viewState', () => {
  it("defaults to overwrite, so a manual restore's prefs and activeUid still win", () => {
    seed();
    const backup = exportAll();

    // Diverge locally from what the backup holds.
    localStorage.setItem('gachagremlin:selectedGame', 'zzz');
    setActiveUid('genshin', 'main');

    importBackup(backup); // no options — must behave exactly as before
    expect(localStorage.getItem('gachagremlin:selectedGame')).toBe('hsr');
    expect(getActiveUid('genshin')).toBe('alt');
  });

  it('fill-if-absent leaves prefs and activeUid that are already set alone', () => {
    seed();
    const backup = exportAll();

    localStorage.setItem('gachagremlin:selectedGame', 'zzz');
    setActiveUid('genshin', 'main');

    importBackup(backup, { viewState: 'fill-if-absent' });
    // The device's own choices survive an unattended sync.
    expect(localStorage.getItem('gachagremlin:selectedGame')).toBe('zzz');
    expect(getActiveUid('genshin')).toBe('main');
  });

  it('fill-if-absent still populates prefs and activeUid that are missing', () => {
    seed();
    const backup = exportAll();

    localStorage.clear(); // the case this whole feature exists for: cleared cache

    importBackup(backup, { viewState: 'fill-if-absent' });
    expect(localStorage.getItem('gachagremlin:selectedGame')).toBe('hsr');
    // Without this, the accounts come back but the Wishes tab renders empty.
    expect(getActiveUid('genshin')).toBe('alt');
    expect(loadAccount('genshin', 'main')?.items.map((i) => i.id)).toEqual(['1', '2']);
  });

  it('fill-if-absent never affects pulls or reminders — only view state', () => {
    toggleReminder('genshin', 'a');
    importPayload(makePayload({ uid: 'main', items: [item('1')] }));
    const backup = exportAll();
    toggleReminder('genshin', 'b');
    importPayload(makePayload({ uid: 'main', items: [item('5')] }));

    importBackup(backup, { viewState: 'fill-if-absent' });
    expect(loadAccount('genshin', 'main')?.items.map((i) => i.id)).toEqual(['1', '5']);
    expect(listReminders('genshin').sort()).toEqual(['a', 'b']);
  });
});
