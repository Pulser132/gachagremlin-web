import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventKey, isReminded, listReminders, setReminders, toggleReminder } from '../src/data/reminders.ts';
import type { EventInfo } from '../src/types.ts';

// Same in-memory Storage stand-in used by tests/wishStore.test.ts.
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

function ev(overrides: Partial<EventInfo> = {}): Pick<EventInfo, 'game' | 'type' | 'name'> {
  return { game: 'genshin', type: 'Character Event Wish', name: 'Test Banner', ...overrides };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('eventKey', () => {
  it('is stable across whitespace/case differences in the same event', () => {
    expect(eventKey(ev({ name: 'Test  Banner' }))).toBe(eventKey(ev({ name: 'test banner' })));
  });

  it('differs by game, type, and name', () => {
    expect(eventKey(ev())).not.toBe(eventKey(ev({ game: 'hsr' })));
    expect(eventKey(ev())).not.toBe(eventKey(ev({ type: 'Weapon Event Wish' })));
    expect(eventKey(ev())).not.toBe(eventKey(ev({ name: 'Other' })));
  });
});

describe('toggleReminder / isReminded / listReminders', () => {
  it('adds then removes a subscription and reports the new state', () => {
    const key = eventKey(ev());
    expect(isReminded('genshin', key)).toBe(false);

    expect(toggleReminder('genshin', key)).toBe(true);
    expect(isReminded('genshin', key)).toBe(true);
    expect(listReminders('genshin')).toEqual([key]);

    expect(toggleReminder('genshin', key)).toBe(false);
    expect(isReminded('genshin', key)).toBe(false);
    expect(listReminders('genshin')).toEqual([]);
  });

  it('keeps reminders separate per game', () => {
    toggleReminder('genshin', 'k1');
    expect(listReminders('hsr')).toEqual([]);
  });
});

describe('setReminders', () => {
  it('replaces the stored set wholesale', () => {
    toggleReminder('genshin', 'old');
    setReminders('genshin', ['a', 'b']);
    expect(listReminders('genshin')).toEqual(['a', 'b']);
  });
});
