/**
 * localStorage persistence for opt-in event reminders.
 *
 * One entry per game: `gachagremlin:reminders:<game>` holds a JSON array of
 * event keys the player has belled. Wiki events carry no stable id, so we
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

export function listReminders(game: GameKey): string[] {
  try {
    const raw = localStorage.getItem(remindersKey(game));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function writeReminders(game: GameKey, keys: string[]): void {
  try {
    localStorage.setItem(remindersKey(game), JSON.stringify(keys));
  } catch {
    // storage full or unavailable — the toggle still applies this session
  }
}

export function isReminded(game: GameKey, key: string): boolean {
  return listReminders(game).includes(key);
}

/** Toggles a reminder subscription and returns the new state (true = belled). */
export function toggleReminder(game: GameKey, key: string): boolean {
  const keys = listReminders(game);
  const idx = keys.indexOf(key);
  if (idx >= 0) {
    keys.splice(idx, 1);
    writeReminders(game, keys);
    return false;
  }
  keys.push(key);
  writeReminders(game, keys);
  return true;
}

/** Replaces the stored reminder set for a game (used by backup restore). */
export function setReminders(game: GameKey, keys: string[]): void {
  writeReminders(game, keys);
}
