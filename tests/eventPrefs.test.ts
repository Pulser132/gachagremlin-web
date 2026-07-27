import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventHideKey,
  hideEvent,
  isCategoryHidden,
  isEventHidden,
  listHiddenCategories,
  listHiddenNames,
  setCategoryHidden,
  setHiddenCategories,
  setHiddenNames,
  unhideEvent,
} from '../src/data/eventPrefs.ts';

// Same in-memory Storage stand-in used by tests/reminders.test.ts.
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

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('eventHideKey', () => {
  // Subtitle variants of recurring events are NOT in the wiki fixtures —
  // they are literal observed rerun names.
  it('equates subtitle variants of a recurring event with the base name', () => {
    const base = eventHideKey('Heated Battle Mode');
    expect(eventHideKey('Heated Battle Mode: Automatic Chess')).toBe(base);
    expect(eventHideKey('Heated Battle Mode: Prevailing Winds')).toBe(base);
    expect(base).toBe('heated battle mode');
  });

  it('strips a trailing Update suffix', () => {
    expect(eventHideKey('Repertoire of Myriad Melodies Update')).toBe(
      eventHideKey('Repertoire of Myriad Melodies'),
    );
  });

  it('strips rerun date suffixes', () => {
    const base = eventHideKey("The Forge Realm's Temper");
    expect(eventHideKey("The Forge Realm's Temper/2026-07-01")).toBe(base);
    expect(eventHideKey("The Forge Realm's Temper 2026-7-1")).toBe(base);
  });

  it('strips a trailing (Event) qualifier', () => {
    expect(eventHideKey('Sunny Summer Fontinalia (Event)')).toBe('sunny summer fontinalia');
  });

  it('cuts at the first separator — the documented over-match', () => {
    expect(eventHideKey('Nod-Krai: Where Roads Are Pledged to Cross')).toBe('nod-krai');
  });

  it('does not split hyphenated names on a bare dash', () => {
    expect(eventHideKey('Nod-Krai')).toBe('nod-krai');
  });

  it('cuts at a spaced dash separator', () => {
    expect(eventHideKey('Ley Line Overflow - Rerun')).toBe('ley line overflow');
  });

  it('is stable across case and whitespace differences', () => {
    expect(eventHideKey('  Heated   Battle  Mode ')).toBe(eventHideKey('HEATED BATTLE MODE'));
  });

  it('is idempotent on its own output', () => {
    const key = eventHideKey('Heated Battle Mode: Automatic Chess');
    expect(eventHideKey(key)).toBe(key);
  });
});

describe('hide rules', () => {
  it('hide/unhide round-trips and reports state through the canonical key', () => {
    expect(isEventHidden('genshin', 'Heated Battle Mode: Automatic Chess')).toBe(false);

    const key = hideEvent('genshin', 'Heated Battle Mode: Automatic Chess');
    expect(key).toBe('heated battle mode');
    expect(listHiddenNames('genshin')).toEqual([key]);
    // A different subtitle variant matches the same rule.
    expect(isEventHidden('genshin', 'Heated Battle Mode: Prevailing Winds')).toBe(true);

    unhideEvent('genshin', key);
    expect(isEventHidden('genshin', 'Heated Battle Mode: Automatic Chess')).toBe(false);
    expect(listHiddenNames('genshin')).toEqual([]);
  });

  it('does not duplicate a rule hidden twice', () => {
    hideEvent('genshin', 'Ley Line Overflow');
    hideEvent('genshin', 'Ley Line Overflow/2026-08-01');
    expect(listHiddenNames('genshin')).toEqual(['ley line overflow']);
  });

  it('keeps rules separate per game', () => {
    hideEvent('genshin', 'Heated Battle Mode');
    expect(listHiddenNames('hsr')).toEqual([]);
    expect(isEventHidden('hsr', 'Heated Battle Mode')).toBe(false);
  });

  it('setHiddenNames re-canonicalizes and dedupes every entry', () => {
    setHiddenNames('genshin', [
      'Heated Battle Mode: Automatic Chess',
      'HEATED battle mode',
      'Repertoire of Myriad Melodies Update',
      '',
    ]);
    expect(listHiddenNames('genshin')).toEqual(['heated battle mode', 'repertoire of myriad melodies']);
  });
});

describe('hidden categories', () => {
  it('toggles per game', () => {
    expect(isCategoryHidden('genshin', 'web')).toBe(false);
    setCategoryHidden('genshin', 'web', true);
    expect(isCategoryHidden('genshin', 'web')).toBe(true);
    expect(isCategoryHidden('hsr', 'web')).toBe(false);
    setCategoryHidden('genshin', 'web', false);
    expect(listHiddenCategories('genshin')).toEqual([]);
  });

  it('setHiddenCategories filters invalid values and dedupes', () => {
    setHiddenCategories('genshin', ['web', 'web', 'bogus', 'other'] as never);
    expect(listHiddenCategories('genshin')).toEqual(['web', 'other']);
  });

  it('leaves hidden names untouched when categories change', () => {
    hideEvent('genshin', 'Heated Battle Mode');
    setCategoryHidden('genshin', 'web', true);
    expect(listHiddenNames('genshin')).toEqual(['heated battle mode']);
  });
});

describe('degradation', () => {
  it('treats corrupt JSON as empty defaults', () => {
    localStorage.setItem('gachagremlin:eventPrefs:genshin', '{not json');
    expect(listHiddenNames('genshin')).toEqual([]);
    expect(listHiddenCategories('genshin')).toEqual([]);
  });

  it('filters malformed shapes on read', () => {
    localStorage.setItem(
      'gachagremlin:eventPrefs:genshin',
      JSON.stringify({ hiddenNames: ['ok', 42], hiddenCategories: ['web', 'bogus'] }),
    );
    expect(listHiddenNames('genshin')).toEqual(['ok']);
    expect(listHiddenCategories('genshin')).toEqual(['web']);
  });

  it('degrades to session-only when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('unavailable');
      },
      setItem() {
        throw new Error('unavailable');
      },
    });
    expect(listHiddenNames('genshin')).toEqual([]);
    expect(() => hideEvent('genshin', 'Heated Battle Mode')).not.toThrow();
    expect(() => setCategoryHidden('genshin', 'web', true)).not.toThrow();
  });
});
