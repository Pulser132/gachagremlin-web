import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReminderApi, ReminderApiError, type FetchLike } from '../src/data/reminderApi.ts';
import { enqueueReminder, flushQueue, getCursor, listQueue, pullReminders } from '../src/data/reminderQueue.ts';
import { listReminderRecords } from '../src/data/reminders.ts';

function res(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

type Call = { url: string; init?: RequestInit };

function fakeFetch(responses: (Response | Error)[]): { impl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses[i++];
    if (next === undefined) throw new Error(`unexpected fetch call #${i}: ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return { impl, calls };
}

const BASE = 'https://api.test';
const KEY = 'genshin:web event:sunny summer';
const win = (over: Partial<{ eventKey: string; updatedAt: number; deleted: boolean }> = {}) => ({
  eventKey: KEY,
  game: 'genshin',
  offsets: [86400, 3600],
  updatedAt: 100,
  deleted: false,
  ...over,
});

function makeApi(responses: (Response | Error)[], token: string | null = 'tok') {
  const { impl, calls } = fakeFetch(responses);
  const onUnauthorized = vi.fn();
  const api = createReminderApi({ baseUrl: `${BASE}/`, getToken: () => token, onUnauthorized, fetchImpl: impl });
  return { api, calls, onUnauthorized };
}

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('reminder API client', () => {
  it('sends the bearer token and percent-encodes the key on PUT', async () => {
    const { api, calls } = makeApi([res(win())]);
    await api.put(KEY, { updatedAt: 100 });
    expect(calls[0].url).toBe(`${BASE}/v1/reminders/${encodeURIComponent(KEY)}`);
    expect(calls[0].init?.method).toBe('PUT');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    // offsets are never sent unless set
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ updatedAt: 100 });
  });

  it('DELETE sends only updatedAt; list builds the query', async () => {
    const { api, calls } = makeApi([res(win({ deleted: true })), res({ items: [], serverTime: 5 })]);
    await api.remove(KEY, 7);
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ updatedAt: 7 });
    await api.list({ game: 'hsr', since: 42 });
    expect(calls[1].url).toBe(`${BASE}/v1/reminders?game=hsr&since=42`);
    expect(calls[1].init?.body).toBeUndefined();
  });

  it('GET /me and POST logout', async () => {
    const { api, calls } = makeApi([res({ id: '1', deliverable: true }), res('', 204)]);
    expect(await api.me()).toEqual({ id: '1', deliverable: true });
    await api.logout();
    expect(calls[1].url).toBe(`${BASE}/v1/auth/logout`);
    expect(calls[1].init?.method).toBe('POST');
  });

  it('chunks sync into batches of 200', async () => {
    const items = Array.from({ length: 450 }, (_, i) => ({ eventKey: `genshin:t:n${i}`, updatedAt: i, deleted: false }));
    const { api, calls } = makeApi([
      res({ items: [win()], serverTime: 1 }),
      res({ items: [win()], serverTime: 2 }),
      res({ items: [win()], serverTime: 3 }),
    ]);
    const out = await api.sync(items);
    expect(calls.map((c) => JSON.parse(c.init?.body as string).items.length)).toEqual([200, 200, 50]);
    expect(out.items).toHaveLength(3);
    expect(out.serverTime).toBe(3);
  });

  it('drops to signed-out on 401', async () => {
    const { api, onUnauthorized } = makeApi([res({ error: 'unauthorized', message: 'expired' }, 401)]);
    await expect(api.me()).rejects.toMatchObject({ kind: 'unauthorized', status: 401, code: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does not fetch without a token', async () => {
    const { api, calls, onUnauthorized } = makeApi([], null);
    await expect(api.me()).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(calls).toHaveLength(0);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('maps error shapes to typed kinds', async () => {
    const { api } = makeApi([
      res({ error: 'resync_required', message: 'old' }, 409),
      res({ error: 'limit_exceeded', message: 'full' }, 422),
      res({ error: 'rate_limited', message: 'slow' }, 429),
      res('boom', 500),
      new TypeError('Failed to fetch'),
    ]);
    await expect(api.list()).rejects.toMatchObject({ kind: 'resync_required', code: 'resync_required' });
    await expect(api.me()).rejects.toMatchObject({ kind: 'limit_exceeded' });
    await expect(api.me()).rejects.toMatchObject({ kind: 'rate-limited' });
    await expect(api.me()).rejects.toMatchObject({ kind: 'other', status: 500 });
    const err = await api.me().catch((e) => e);
    expect(err).toBeInstanceOf(ReminderApiError);
    expect(err.kind).toBe('network');
  });
});

describe('pullReminders', () => {
  it('uses and advances the per-game cursor', async () => {
    const { api, calls } = makeApi([
      res({ items: [win({ updatedAt: 10 })], serverTime: 111 }),
      res({ items: [win({ updatedAt: 20, deleted: true })], serverTime: 222 }),
    ]);
    await pullReminders(api, 'genshin');
    expect(calls[0].url).toBe(`${BASE}/v1/reminders?game=genshin`);
    expect(getCursor('genshin')).toBe(111);
    expect(getCursor('hsr')).toBeUndefined();
    await pullReminders(api, 'genshin');
    expect(calls[1].url).toBe(`${BASE}/v1/reminders?game=genshin&since=111`);
    expect(listReminderRecords('genshin')).toEqual([{ eventKey: KEY, updatedAt: 20, deleted: true }]);
  });

  it('refetches without since on 409 resync_required', async () => {
    const { api, calls } = makeApi([
      res({ items: [], serverTime: 50 }),
      res({ error: 'resync_required', message: 'old' }, 409),
      res({ items: [win()], serverTime: 90 }),
    ]);
    await pullReminders(api, 'genshin');
    await pullReminders(api, 'genshin');
    expect(calls[1].url).toContain('since=50');
    expect(calls[2].url).toBe(`${BASE}/v1/reminders?game=genshin`);
    expect(getCursor('genshin')).toBe(90);
    expect(listReminderRecords('genshin')).toHaveLength(1);
  });

  it('keeps a newer local record over an older server one', async () => {
    localStorage.setItem('gachagremlin:reminders:genshin', JSON.stringify([{ eventKey: KEY, updatedAt: 500, deleted: true }]));
    const { api } = makeApi([res({ items: [win({ updatedAt: 100 })], serverTime: 1 })]);
    await pullReminders(api, 'genshin');
    expect(listReminderRecords('genshin')).toEqual([{ eventKey: KEY, updatedAt: 500, deleted: true }]);
  });
});

describe('offline queue', () => {
  it('keeps one entry per key, newest wins, tombstone wins ties', () => {
    enqueueReminder({ eventKey: KEY, updatedAt: 10, deleted: false });
    enqueueReminder({ eventKey: KEY, updatedAt: 5, deleted: true });
    expect(listQueue()).toEqual([{ eventKey: KEY, updatedAt: 10, deleted: false }]);
    enqueueReminder({ eventKey: KEY, updatedAt: 10, deleted: true });
    expect(listQueue()).toEqual([{ eventKey: KEY, updatedAt: 10, deleted: true }]);
    enqueueReminder({ eventKey: KEY, updatedAt: 11, deleted: false });
    expect(listQueue()).toEqual([{ eventKey: KEY, updatedAt: 11, deleted: false }]);
  });

  it('flush sends the queue, adopts the winner, and empties it', async () => {
    localStorage.setItem('gachagremlin:reminders:genshin', JSON.stringify([{ eventKey: KEY, updatedAt: 10, deleted: false }]));
    enqueueReminder({ eventKey: KEY, updatedAt: 10, deleted: false });
    // the server already had a newer tombstone: our write loses
    const { api, calls } = makeApi([res({ items: [win({ updatedAt: 99, deleted: true })], serverTime: 1 })]);
    expect(await flushQueue(api)).toEqual({ rejected: [] });
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ items: [{ eventKey: KEY, updatedAt: 10, deleted: false }] });
    expect(listQueue()).toEqual([]);
    expect(listReminderRecords('genshin')).toEqual([{ eventKey: KEY, updatedAt: 99, deleted: true }]);
  });

  it('keeps the queue when the flush fails', async () => {
    enqueueReminder({ eventKey: KEY, updatedAt: 10, deleted: false });
    const { api } = makeApi([new TypeError('offline')]);
    await expect(flushQueue(api)).rejects.toMatchObject({ kind: 'network' });
    expect(listQueue()).toHaveLength(1);
  });

  it('keeps a write queued during the flush that supersedes the sent one', async () => {
    enqueueReminder({ eventKey: KEY, updatedAt: 10, deleted: false });
    const { impl } = fakeFetch([]);
    const slow: FetchLike = async (url, init) => {
      enqueueReminder({ eventKey: KEY, updatedAt: 20, deleted: true });
      return impl(url, init).catch(() => res({ items: [win({ updatedAt: 10 })], serverTime: 1 }));
    };
    const api = createReminderApi({ baseUrl: BASE, getToken: () => 't', fetchImpl: slow });
    await flushQueue(api);
    expect(listQueue()).toEqual([{ eventKey: KEY, updatedAt: 20, deleted: true }]);
  });

  it('on limit_exceeded drops live writes and still sends tombstones', async () => {
    const other = 'genshin:web event:other';
    enqueueReminder({ eventKey: KEY, updatedAt: 10, deleted: false });
    enqueueReminder({ eventKey: other, updatedAt: 11, deleted: true });
    const { api, calls } = makeApi([
      res({ error: 'limit_exceeded', message: 'full' }, 422),
      res({ items: [win({ eventKey: other, updatedAt: 11, deleted: true })], serverTime: 1 }),
    ]);
    expect(await flushQueue(api)).toEqual({ rejected: [KEY] });
    expect(JSON.parse(calls[1].init?.body as string).items).toEqual([{ eventKey: other, updatedAt: 11, deleted: true }]);
    expect(listQueue()).toEqual([]);
  });
});
