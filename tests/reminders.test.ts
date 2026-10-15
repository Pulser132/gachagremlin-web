import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isReminded,
  listReminderRecords,
  listReminders,
  mergeReminderRecords,
  toggleReminder,
  type ReminderRecord,
} from '../src/data/reminders.ts';

const KEY = 'gachagremlin:reminders:genshin';
const rec = (updatedAt: number, deleted = false): ReminderRecord => ({ eventKey: 'k', updatedAt, deleted });

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  });
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('legacy migration', () => {
  it('turns a bare string[] into live records stamped with the migration time', () => {
    localStorage.setItem(KEY, JSON.stringify(['a', 'b', 'a']));
    expect(listReminderRecords('genshin')).toEqual([
      { eventKey: 'a', updatedAt: 1_000, deleted: false },
      { eventKey: 'b', updatedAt: 1_000, deleted: false },
    ]);
    expect(JSON.parse(localStorage.getItem(KEY)!)[0]).toEqual({ eventKey: 'a', updatedAt: 1_000, deleted: false });
    expect(listReminders('genshin')).toEqual(['a', 'b']);
  });

  it('keeps the migration stamp stable when the write fails', () => {
    const store = new Map<string, string>([['gachagremlin:reminders:hsr', JSON.stringify(['a'])]]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    const first = listReminderRecords('hsr');
    vi.setSystemTime(9_000);
    expect(listReminderRecords('hsr')).toEqual(first);
  });

  it('resolves a bare string and a record for the same key with the merge rule', () => {
    const tomb = { eventKey: 'a', updatedAt: 5_000, deleted: true };
    localStorage.setItem('gachagremlin:reminders:zzz', JSON.stringify([tomb, 'a']));
    expect(listReminderRecords('zzz')).toEqual([tomb]);
    expect(listReminders('zzz')).toEqual([]);
  });
});

describe('toggleReminder', () => {
  it('stamps updatedAt and leaves a tombstone when un-belled', () => {
    expect(toggleReminder('genshin', 'a')).toBe(true);
    vi.setSystemTime(2_000);
    expect(toggleReminder('genshin', 'a')).toBe(false);
    expect(listReminderRecords('genshin')).toEqual([{ eventKey: 'a', updatedAt: 2_000, deleted: true }]);
    expect(isReminded('genshin', 'a')).toBe(false);
    expect(listReminders('genshin')).toEqual([]);
  });

  it('re-belling revives the same entry', () => {
    toggleReminder('genshin', 'a');
    toggleReminder('genshin', 'a');
    vi.setSystemTime(3_000);
    expect(toggleReminder('genshin', 'a')).toBe(true);
    expect(listReminderRecords('genshin')).toEqual([{ eventKey: 'a', updatedAt: 3_000, deleted: false }]);
  });
});

describe('mergeReminderRecords', () => {
  it('greater updatedAt wins', () => {
    expect(mergeReminderRecords(rec(1, true), rec(2))).toEqual(rec(2));
    expect(mergeReminderRecords(rec(2), rec(1, true))).toEqual(rec(2));
  });
  it('tie goes to the tombstone', () => {
    expect(mergeReminderRecords(rec(5), rec(5, true)).deleted).toBe(true);
    expect(mergeReminderRecords(rec(5, true), rec(5)).deleted).toBe(true);
  });
});
