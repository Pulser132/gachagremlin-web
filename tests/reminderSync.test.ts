// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderApiError, type ApiReminder, type ReminderApi, type ReminderWrite } from '../src/data/reminderApi.ts';
import { getCursor, listQueue } from '../src/data/reminderQueue.ts';
import { createReminderSync } from '../src/data/reminderSync.ts';
import { listReminderRecords, listReminders, setReminders, toggleReminder } from '../src/data/reminders.ts';

const K1 = 'genshin:web event:one';
const K2 = 'genshin:web event:two';
const H1 = 'hsr:version:three';

/** In-memory stand-in for the bot: last-writer-wins, tombstone wins ties. */
function fakeServer() {
  const store = new Map<string, ApiReminder>();
  let clock = 1_000_000;
  let failWith: Error | null = null;
  const calls = { sync: [] as ReminderWrite[][], list: [] as { game?: string; since?: number }[] };

  function apply(w: ReminderWrite): ApiReminder {
    const cur = store.get(w.eventKey);
    const win =
      !cur || w.updatedAt > cur.updatedAt || (w.updatedAt === cur.updatedAt && w.deleted && !cur.deleted)
        ? { eventKey: w.eventKey, game: w.eventKey.split(':')[0] as ApiReminder['game'], offsets: [86400, 3600], updatedAt: w.updatedAt, deleted: w.deleted }
        : cur;
    store.set(w.eventKey, win);
    return win;
  }

  const api: ReminderApi = {
    async me() {
      return { id: 'u1', deliverable: true };
    },
    async logout() {},
    async put() {
      throw new Error('unused');
    },
    async remove() {
      throw new Error('unused');
    },
    async sync(items) {
      if (failWith) throw failWith;
      calls.sync.push(items);
      return { items: items.map(apply), serverTime: ++clock };
    },
    async list(opts = {}) {
      if (failWith) throw failWith;
      calls.list.push(opts);
      const items = [...store.values()].filter((r) => (!opts.game || r.game === opts.game));
      return { items, serverTime: ++clock };
    },
  };
  return {
    api,
    store,
    calls,
    fail: (e: Error | null) => (failWith = e),
    /** A change made from the Discord side. */
    botWrite: (w: ReminderWrite) => apply(w),
  };
}

let userId: string | null;
const detachers: (() => void)[] = [];
afterEach(() => {
  while (detachers.length) detachers.pop()!();
  vi.useRealTimers();
});
beforeEach(() => {
  localStorage.clear();
  userId = 'u1';
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});

function setup() {
  const server = fakeServer();
  const onMerged = vi.fn();
  const sync = createReminderSync({ getUserId: () => userId, api: server.api, onMerged, now: Date.now });
  detachers.push(sync.attach(window));
  return { server, sync, onMerged };
}

describe('signed out', () => {
  it('does nothing and queues nothing', async () => {
    userId = null;
    const { server, sync } = setup();
    toggleReminder('genshin', K1);
    await sync.request();
    expect(server.calls.sync).toHaveLength(0);
    expect(server.calls.list).toHaveLength(0);
    expect(listQueue()).toEqual([]);
    expect(sync.getState().status).toBe('signed-out');
    expect(listReminders('genshin')).toEqual([K1]);
  });
});

describe('first sign-in', () => {
  it('sends every live local reminder at now and adopts the server state', async () => {
    toggleReminder('genshin', K1);
    toggleReminder('genshin', K2);
    toggleReminder('genshin', K2); // local tombstone — must not be sent
    toggleReminder('hsr', H1);
    vi.setSystemTime(50_000);
    const { server, sync } = setup();
    server.botWrite({ eventKey: 'zzz:x:from bot', updatedAt: 5, deleted: false });

    await sync.request();

    const sent = server.calls.sync.flat();
    expect(sent.map((w) => w.eventKey).sort()).toEqual([H1, K1].sort());
    expect(sent.every((w) => w.updatedAt === 50_000 && !w.deleted)).toBe(true);
    expect(listReminders('genshin')).toEqual([K1]);
    expect(listReminders('zzz')).toEqual(['zzz:x:from bot']);
    expect(getCursor('genshin')).toBeDefined();
    expect(sync.getState()).toMatchObject({ status: 'synced', pending: 0 });
  });

  it('does not re-merge on later runs', async () => {
    toggleReminder('genshin', K1);
    const { server, sync } = setup();
    await sync.request();
    const firstCalls = server.calls.sync.length;
    await sync.request();
    expect(server.calls.sync.length).toBe(firstCalls); // empty queue → no /sync call
  });
});

describe('push and pull', () => {
  it('pushes a toggle made while signed in', async () => {
    const { server, sync } = setup();
    await sync.request();
    vi.setSystemTime(20_000);
    toggleReminder('genshin', K1);
    await sync.request();
    expect(server.store.get(K1)).toMatchObject({ updatedAt: 20_000, deleted: false });
  });

  it('pushes a backup restore as fresh bells', async () => {
    const { server, sync } = setup();
    await sync.request();
    vi.setSystemTime(30_000);
    setReminders('genshin', [K1, K2]);
    await sync.request();
    expect(server.store.get(K1)?.deleted).toBe(false);
    expect(server.store.get(K2)?.deleted).toBe(false);
  });

  it('shows a removal made by the bot, using the cursor, and reports a merge', async () => {
    toggleReminder('genshin', K1);
    const { server, sync, onMerged } = setup();
    await sync.request();
    onMerged.mockClear();
    server.botWrite({ eventKey: K1, updatedAt: 999_999_999, deleted: true });

    await sync.request();

    expect(listReminders('genshin')).toEqual([]);
    expect(listReminderRecords('genshin')[0]).toMatchObject({ deleted: true });
    expect(onMerged).toHaveBeenCalledTimes(1);
    expect(server.calls.list.at(-1)?.since).toBeDefined();
  });

  it('does not report a merge when nothing changed', async () => {
    const { sync, onMerged } = setup();
    await sync.request();
    onMerged.mockClear();
    await sync.request();
    expect(onMerged).not.toHaveBeenCalled();
  });

  it('syncs on window focus and coalesces a toggle that lands mid-run', async () => {
    const { server, sync } = setup();
    await sync.request();
    const before = server.calls.list.length;
    window.dispatchEvent(new Event('focus'));
    await sync.request();
    expect(server.calls.list.length).toBeGreaterThan(before);

    const p = sync.request();
    vi.setSystemTime(40_000);
    toggleReminder('genshin', K1); // enqueues + requests while running
    await p;
    expect(server.store.get(K1)).toMatchObject({ deleted: false });
  });
});

describe('status', () => {
  it('goes offline with pending writes, then recovers', async () => {
    const { server, sync } = setup();
    await sync.request();
    server.fail(new ReminderApiError('network', 'down'));
    vi.setSystemTime(20_000);
    toggleReminder('genshin', K1);
    await sync.request();
    expect(sync.getState()).toMatchObject({ status: 'offline', pending: 1 });
    expect(listReminders('genshin')).toEqual([K1]); // local state intact

    server.fail(null);
    window.dispatchEvent(new Event('online'));
    await sync.request();
    expect(sync.getState()).toMatchObject({ status: 'synced', pending: 0 });
    expect(server.store.get(K1)?.deleted).toBe(false);
  });

  it('drops to signed-out on a 401 and flushes offline-era changes, tombstones included, on re-login', async () => {
    const { server, sync } = setup();
    toggleReminder('genshin', K1);
    await sync.request();
    server.fail(new ReminderApiError('unauthorized', 'expired', 401));
    await sync.request();
    expect(sync.getState().status).toBe('signed-out');

    // Un-belled while signed out, and a bell removed on Discord meanwhile.
    vi.setSystemTime(60_000);
    toggleReminder('genshin', K1);
    expect(listQueue()).toHaveLength(1);
    server.fail(null);
    await sync.request();
    expect(server.store.get(K1)).toMatchObject({ deleted: true, updatedAt: 60_000 });
  });

  it('does not revive a bell removed elsewhere when the same user signs back in', async () => {
    const { server, sync } = setup();
    toggleReminder('genshin', K1);
    await sync.request();
    sync.handleSignedOut();
    server.botWrite({ eventKey: K1, updatedAt: 999_999_999, deleted: true });
    await sync.request();
    expect(server.store.get(K1)).toMatchObject({ deleted: true, updatedAt: 999_999_999 });
    expect(listReminders('genshin')).toEqual([]);
  });

  it('ignores a sync that finishes after sign-out', async () => {
    const { sync } = setup();
    const p = sync.request();
    userId = null;
    sync.handleSignedOut();
    await p;
    expect(sync.getState().status).toBe('signed-out');
  });

  it('shows other failures as an error with the message', async () => {
    const { server, sync } = setup();
    server.fail(new ReminderApiError('other', 'boom', 500));
    await sync.request();
    expect(sync.getState()).toMatchObject({ status: 'error', error: 'boom' });
  });

  it('reports reminders refused by the 500 cap', async () => {
    const { server, sync } = setup();
    await sync.request();
    const real = server.api.sync;
    server.api.sync = async (items) => {
      if (items.some((w) => !w.deleted)) throw new ReminderApiError('limit_exceeded', 'cap', 422, 'limit_exceeded');
      return real(items);
    };
    toggleReminder('genshin', K1);
    await sync.request();
    expect(sync.getState().status).toBe('error');
    expect(sync.getState().error).toMatch(/limit/);
    expect(listQueue()).toEqual([]);
  });

  it('wipes the previous user local bells when a different user signs in', async () => {
    const { server, sync } = setup();
    toggleReminder('genshin', K1);
    await sync.request();
    sync.handleSignedOut();

    userId = 'u2';
    server.store.clear();
    server.botWrite({ eventKey: K2, updatedAt: 5, deleted: false });
    await sync.request();
    expect(server.store.get(K1)).toBeUndefined(); // A's bell never reaches B
    expect(listReminders('genshin')).toEqual([K2]);
    expect(server.calls.list.at(-1)?.since).toBeUndefined();
  });
});
