/**
 * localStorage persistence for opt-in event reminders.
 *
 * One entry per game: `gachagremlin:reminders:<game>` holds a JSON array of
 * `ReminderRecord`s (`{eventKey, updatedAt, deleted}`). Un-belling writes a
 * tombstone rather than removing the entry so a future sync can propagate the
 * deletion. A legacy bare `string[]` is migrated on first read. Wiki events carry no stable id, so we
 * derive one from game+type+name (see `eventKey`) — the same key a future
 * Discord bot would match on to deliver background reminders. All reads/writes
 * are wrapped in try/catch so private-browsing / quota failures degrade
 * silently, matching src/data/wishes/store.ts.
 */
import type { EventInfo, GameKey } from '../types.ts';

const STORAGE_PREFIX = 'gachagremlin:reminders:';

function remindersKey(game: GameKey): string {
  return `${STORAGE_PREFIX}${game}`;
}

/**
 * A best-effort stable identity for a wiki event, since `EventInfo` has no id.
 * Built from game + type + name (lower-cased, whitespace-collapsed). Stable
 * across the 30-minute refetch cycle; a wiki rename of the event would drop
 * the subscription, which is acceptable for opt-in reminders. This is the key
 * shared with the Discord bot / backup schema.
 */
export function eventKey(ev: Pick<EventInfo, 'game' | 'type' | 'name'>): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${ev.game}:${norm(ev.type)}:${norm(ev.name)}`;
}

/** One reminder subscription. `deleted: true` is a tombstone (un-belled). */
export interface ReminderRecord {
  eventKey: string;
  /** Unix milliseconds of the last change. */
  updatedAt: number;
  deleted: boolean;
}

/**
 * Merge rule shared with the reminder sync API: the greater `updatedAt` wins,
 * and on a tie the tombstone wins.
 */
export function mergeReminderRecords(a: ReminderRecord, b: ReminderRecord): ReminderRecord {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (a.deleted !== b.deleted) return a.deleted ? a : b;
  return a;
}

function isRecord(v: unknown): v is ReminderRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.eventKey === 'string' && typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) && typeof r.deleted === 'boolean';
}

/** Every stored record for a game, tombstones included. Migrates the legacy
 * `string[]` shape (treated as live, stamped with the migration time). */
export function listReminderRecords(game: GameKey): ReminderRecord[] {
  try {
    const raw = localStorage.getItem(remindersKey(game));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    if (parsed.some((v) => typeof v === 'string')) {
      const now = Date.now();
      const seen = new Set<string>();
      const migrated: ReminderRecord[] = [];
      for (const v of parsed) {
        if (typeof v === 'string' && !seen.has(v)) {
          seen.add(v);
          migrated.push({ eventKey: v, updatedAt: now, deleted: false });
        } else if (isRecord(v) && !seen.has(v.eventKey)) {
          seen.add(v.eventKey);
          migrated.push(v);
        }
      }
      writeRecords(game, migrated);
      return migrated;
    }
    const byKey = new Map<string, ReminderRecord>();
    for (const v of parsed) {
      if (!isRecord(v)) continue;
      const prev = byKey.get(v.eventKey);
      byKey.set(v.eventKey, prev ? mergeReminderRecords(prev, v) : v);
    }
    return [...byKey.values()];
  } catch {
    return [];
  }
}

function writeRecords(game: GameKey, records: ReminderRecord[]): void {
  try {
    localStorage.setItem(remindersKey(game), JSON.stringify(records));
  } catch {
    // storage full or unavailable — the toggle still applies this session
  }
}

/** Replaces the stored records for a game (used by sync). */
export function setReminderRecords(game: GameKey, records: ReminderRecord[]): void {
  writeRecords(game, records);
}

/** Keys of live (non-tombstoned) reminders. */
export function listReminders(game: GameKey): string[] {
  return listReminderRecords(game)
    .filter((r) => !r.deleted)
    .map((r) => r.eventKey);
}

export function isReminded(game: GameKey, key: string): boolean {
  return listReminders(game).includes(key);
}

/** Toggles a reminder subscription and returns the new state (true = belled).
 * Un-belling leaves a tombstone. */
export function toggleReminder(game: GameKey, key: string): boolean {
  const records = listReminderRecords(game);
  const existing = records.find((r) => r.eventKey === key);
  const belled = !(existing && !existing.deleted);
  // Strictly newer than the existing record even if the local clock is behind.
  const updatedAt = existing ? Math.max(Date.now(), existing.updatedAt + 1) : Date.now();
  const next: ReminderRecord = { eventKey: key, updatedAt, deleted: !belled };
  if (existing) Object.assign(existing, next);
  else records.push(next);
  writeRecords(game, records);
  return belled;
}

/** Backup restore: every key counts as a freshly added bell, unioned with
 * whatever is already stored. */
export function setReminders(game: GameKey, keys: string[]): void {
  const records = listReminderRecords(game);
  const now = Date.now();
  for (const key of keys) {
    const existing = records.find((r) => r.eventKey === key);
    // Strictly newer than any local change, so a restore revives a tombstone.
    const updatedAt = existing ? Math.max(now, existing.updatedAt + 1) : now;
    if (existing) Object.assign(existing, { updatedAt, deleted: false });
    else records.push({ eventKey: key, updatedAt, deleted: false });
  }
  writeRecords(game, records);
}
