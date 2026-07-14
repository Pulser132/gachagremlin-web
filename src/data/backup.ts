/**
 * Whole-app backup / restore over a single JSON file.
 *
 * This is the manual guard against a cleared browser cache, and it defines the
 * exact payload shape a future Google Drive sync — and the Discord reminder
 * bot — will read. The schema is structured (not a raw localStorage key dump)
 * and versioned so those consumers have a stable contract:
 *
 *   { schemaVersion, app, exportedAt,
 *     games: { <game>: { activeUid, accounts: { <uid>: WishAccount }, reminders: string[] } },
 *     prefs: { selectedGame?, selectedRegion?, selectedView? } }
 *
 * Restore MERGES rather than overwrites (unioning pulls via the same dedupe as
 * import), so pulling in an older backup can never drop pulls made since.
 * The re-fetchable wiki events cache (`gachagremlin:events:*`) is excluded.
 */
import type { GameKey, WishAccount } from '../types.ts';
import { GAME_KEYS } from './wiki/games.ts';
import { listReminders, setReminders } from './reminders.ts';
import { getActiveUid, listAccounts, loadAccount, restoreAccount, setActiveUid } from './wishes/store.ts';

export const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_APP = 'gachagremlin';

interface GameBackup {
  activeUid: string | null;
  accounts: Record<string, WishAccount>;
  reminders: string[];
}

export interface BackupFile {
  schemaVersion: number;
  app: 'gachagremlin';
  exportedAt: number;
  games: Record<GameKey, GameBackup>;
  prefs: { selectedGame?: string; selectedRegion?: string; selectedView?: string };
}

const PREF_KEYS = {
  selectedGame: 'gachagremlin:selectedGame',
  selectedRegion: 'gachagremlin:selectedRegion',
  selectedView: 'gachagremlin:selectedView',
} as const;

function readPref(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Collects every persisted account, active pointer, reminder, and pref into
 * one serializable object. */
export function exportAll(now: () => number = Date.now): BackupFile {
  const games = {} as Record<GameKey, GameBackup>;
  for (const game of GAME_KEYS) {
    const accounts: Record<string, WishAccount> = {};
    for (const { uid } of listAccounts(game)) {
      const account = loadAccount(game, uid);
      if (account) accounts[uid] = account;
    }
    games[game] = { activeUid: getActiveUid(game), accounts, reminders: listReminders(game) };
  }

  const prefs: BackupFile['prefs'] = {};
  const selectedGame = readPref(PREF_KEYS.selectedGame);
  const selectedRegion = readPref(PREF_KEYS.selectedRegion);
  const selectedView = readPref(PREF_KEYS.selectedView);
  if (selectedGame) prefs.selectedGame = selectedGame;
  if (selectedRegion) prefs.selectedRegion = selectedRegion;
  if (selectedView) prefs.selectedView = selectedView;

  return { schemaVersion: BACKUP_SCHEMA_VERSION, app: BACKUP_APP, exportedAt: now(), games, prefs };
}

function isGameKey(key: string): key is GameKey {
  return (GAME_KEYS as string[]).includes(key);
}

export interface RestoreResult {
  accounts: number;
  reminders: number;
}

/**
 * Merges a backup file back into local storage. Throws on a shape it doesn't
 * recognize so the caller can surface a clear error. Returns how many accounts
 * and reminder subscriptions were brought in.
 */
export function importBackup(data: unknown): RestoreResult {
  if (!data || typeof data !== 'object') throw new Error('Not a valid backup file.');
  const file = data as Partial<BackupFile>;
  if (file.app !== BACKUP_APP) throw new Error('This file is not a GachaGremlin backup.');
  if (file.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`Unsupported backup version ${String(file.schemaVersion)}; expected ${BACKUP_SCHEMA_VERSION}.`);
  }
  if (!file.games || typeof file.games !== 'object') throw new Error('Backup file has no game data.');

  let accountCount = 0;
  let reminderCount = 0;

  for (const [game, backup] of Object.entries(file.games)) {
    if (!isGameKey(game) || !backup || typeof backup !== 'object') continue;
    const gameBackup = backup as Partial<GameBackup>;

    for (const account of Object.values(gameBackup.accounts ?? {})) {
      if (account && typeof account.uid === 'string' && Array.isArray(account.items)) {
        restoreAccount(game, account);
        accountCount++;
      }
    }

    // Union reminders so a restore adds subscriptions without dropping any
    // made locally since the backup.
    const incoming = Array.isArray(gameBackup.reminders) ? gameBackup.reminders.filter((k) => typeof k === 'string') : [];
    if (incoming.length > 0) {
      const merged = [...new Set([...listReminders(game), ...incoming])];
      reminderCount += incoming.length;
      setReminders(game, merged);
    }

    // Only adopt the backup's active pointer if that account now exists.
    if (typeof gameBackup.activeUid === 'string' && loadAccount(game, gameBackup.activeUid)) {
      setActiveUid(game, gameBackup.activeUid);
    }
  }

  if (file.prefs && typeof file.prefs === 'object') {
    for (const [name, key] of Object.entries(PREF_KEYS)) {
      const value = (file.prefs as Record<string, unknown>)[name];
      if (typeof value === 'string') {
        try {
          localStorage.setItem(key, value);
        } catch {
          // storage unavailable — prefs just won't persist
        }
      }
    }
  }

  return { accounts: accountCount, reminders: reminderCount };
}
