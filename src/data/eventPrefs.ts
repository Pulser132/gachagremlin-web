/**
 * localStorage persistence for the Events tab's hide preferences.
 *
 * One JSON blob per game at `gachagremlin:eventPrefs:<game>`:
 *   { hiddenNames: string[], hiddenCategories: EventCategory[] }
 * Per-game because hiding the Web section for Genshin must not hide it for
 * HSR, mirroring the reminders/backup structure.
 *
 * Hide rules are canonical name keys (see `eventHideKey`), NOT the
 * `eventKey()` from reminders.ts: "hide this forever" must survive `type` and
 * subtitles changing between reruns, while reminders key on the specific
 * event instance. Two different keys for two different lifetimes — do not
 * unify them.
 *
 * All reads/writes are wrapped in try/catch so private-browsing / quota
 * failures degrade silently, matching src/data/reminders.ts.
 */
import type { GameKey } from '../types.ts';
import { isEventCategory, type EventCategory } from './eventCategories.ts';

const STORAGE_PREFIX = 'gachagremlin:eventPrefs:';

interface EventPrefs {
  hiddenNames: string[];
  hiddenCategories: EventCategory[];
}

// Same pattern as DATE_SUFFIX_RE in src/data/wiki/parser.ts — hide rules can
// be created from backup entries that never went through cleanEventName.
const DATE_SUFFIX_RE = /[ /]\d{4}-\d{1,2}-\d{1,2}$/;

/**
 * Canonical hide key for an event name. Recurring events change their
 * subtitle every rerun ("Heated Battle Mode: Automatic Chess" → "Heated
 * Battle Mode: Prevailing Winds") and sometimes grow a suffix ("… Update"),
 * so a rule stores the lowercased, whitespace-collapsed base name: rerun
 * date stripped, cut at the first subtitle separator, trailing "(event)" and
 * "update" dropped. Applied identically when creating rules and when testing
 * candidates, so matching is plain set-equality on keys.
 *
 * Accepted over-match: a base name that legitimately contains a separator
 * ("Nod-Krai: Where Roads Are Pledged to Cross" → `nod-krai`) hides every
 * future "Nod-Krai: …" event. The Hidden section shows the stored rule text,
 * so the breadth of a rule is always visible.
 */
export function eventHideKey(name: string): string {
  let key = name.toLowerCase().replace(/\s+/g, ' ').trim();
  key = key.replace(DATE_SUFFIX_RE, '');
  // First subtitle separator wins. Spaced dash only — a bare `-` would split
  // hyphenated base names like "nod-krai".
  const cut = key.search(/ - |[:/]/);
  if (cut !== -1) key = key.slice(0, cut);
  key = key.replace(/\s*\(event\)$/, '');
  key = key.replace(/\s+update$/, '');
  return key.trim();
}

function prefsKey(game: GameKey): string {
  return `${STORAGE_PREFIX}${game}`;
}

function readPrefs(game: GameKey): EventPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(game));
    if (!raw) return { hiddenNames: [], hiddenCategories: [] };
    const parsed = JSON.parse(raw) as Partial<EventPrefs> | null;
    return {
      hiddenNames: Array.isArray(parsed?.hiddenNames)
        ? parsed.hiddenNames.filter((n): n is string => typeof n === 'string')
        : [],
      hiddenCategories: Array.isArray(parsed?.hiddenCategories)
        ? parsed.hiddenCategories.filter(isEventCategory)
        : [],
    };
  } catch {
    return { hiddenNames: [], hiddenCategories: [] };
  }
}

function writePrefs(game: GameKey, prefs: EventPrefs): void {
  try {
    localStorage.setItem(prefsKey(game), JSON.stringify(prefs));
  } catch {
    // storage full or unavailable — the change still applies this session
  }
}

export function listHiddenNames(game: GameKey): string[] {
  return readPrefs(game).hiddenNames;
}

export function isEventHidden(game: GameKey, name: string): boolean {
  return listHiddenNames(game).includes(eventHideKey(name));
}

/** Stores a hide rule for the event's canonical name and returns the stored key. */
export function hideEvent(game: GameKey, name: string): string {
  const key = eventHideKey(name);
  if (key === '') return key;
  const prefs = readPrefs(game);
  if (!prefs.hiddenNames.includes(key)) {
    prefs.hiddenNames.push(key);
    writePrefs(game, prefs);
  }
  return key;
}

export function unhideEvent(game: GameKey, key: string): void {
  const prefs = readPrefs(game);
  const next = prefs.hiddenNames.filter((k) => k !== key);
  if (next.length !== prefs.hiddenNames.length) {
    writePrefs(game, { ...prefs, hiddenNames: next });
  }
}

/** Replaces the stored rule set (backup restore) — re-canonicalizes every entry. */
export function setHiddenNames(game: GameKey, names: string[]): void {
  const keys = [...new Set(names.map(eventHideKey).filter((k) => k !== ''))];
  writePrefs(game, { ...readPrefs(game), hiddenNames: keys });
}

export function listHiddenCategories(game: GameKey): EventCategory[] {
  return readPrefs(game).hiddenCategories;
}

export function isCategoryHidden(game: GameKey, category: EventCategory): boolean {
  return listHiddenCategories(game).includes(category);
}

export function setCategoryHidden(game: GameKey, category: EventCategory, hidden: boolean): void {
  const prefs = readPrefs(game);
  const has = prefs.hiddenCategories.includes(category);
  if (hidden === has) return;
  const next = hidden
    ? [...prefs.hiddenCategories, category]
    : prefs.hiddenCategories.filter((c) => c !== category);
  writePrefs(game, { ...prefs, hiddenCategories: next });
}

/** Replaces the stored hidden-category set (backup restore). */
export function setHiddenCategories(game: GameKey, categories: EventCategory[]): void {
  const valid = [...new Set(categories.filter(isEventCategory))];
  writePrefs(game, { ...readPrefs(game), hiddenCategories: valid });
}
