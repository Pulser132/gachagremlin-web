/**
 * Event category classification for the Events tab's three top-level sections.
 *
 * The wiki infobox `type` is free text and frequently empty, so this is an
 * ordered keyword classifier (the GLOBAL_TYPE_HINTS approach from
 * src/data/wiki/times.ts, extended) rather than an exhaustive enum: every
 * observed value maps somewhere sensible, anything new degrades to a sane
 * default, and a misclassification is cosmetic — the event still renders,
 * just in a different section, and the player can hide it either way.
 */
import type { EventInfo } from '../types.ts';

export type EventCategory = 'ingame' | 'web' | 'other';

/** The three sections in render order. */
export const EVENT_CATEGORIES: { key: EventCategory; label: string }[] = [
  { key: 'ingame', label: 'In Game' },
  { key: 'web', label: 'Web' },
  { key: 'other', label: 'Other' },
];

export function isEventCategory(value: unknown): value is EventCategory {
  return EVENT_CATEGORIES.some((c) => c.key === value);
}

export function categorizeEvent(ev: Pick<EventInfo, 'type'>): EventCategory {
  const t = ev.type.toLowerCase().trim();
  // Order matters: `web` before `in-game` so "Web Event" can never trip an
  // in-game substring accident. Never match a bare `game` substring.
  if (t.includes('web') || t.includes('login')) return 'web';
  if (t.includes('in-game') || t.includes('ingame') || t.includes('test run')) return 'ingame';
  if (t.includes('community') || t.includes('in-person') || t.includes('collab') || t.includes('special')) {
    return 'other';
  }
  // Pages missing the infobox type are overwhelmingly playable events; a
  // misfile here is cosmetic and hideable.
  if (t === '') return 'ingame';
  return 'other';
}
