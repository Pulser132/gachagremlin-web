import { describe, expect, it } from 'vitest';
import { createCodesFeed, CODES_MIN_INTERVAL_MS } from '../src/data/codesFeed.ts';
import type { FetchLike } from '../src/data/cloud/drive.ts';
import genshinFixture from './fixtures/codes/genshin.json';

function res(body: unknown, status = 200, etag?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => (n.toLowerCase() === 'etag' ? (etag ?? null) : null) },
    json: async () => body,
  } as unknown as Response;
}

function setup(responses: Response[]) {
  let t = 1_000_000;
  const calls: { url: string; init?: RequestInit }[] = [];
  const queue = [...responses];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return queue.shift() ?? res({}, 500);
  };
  const feed = createCodesFeed({ baseUrl: 'https://api.test', fetchImpl, now: () => t });
  return { feed, calls, advance: (ms: number) => { t += ms; }, clock: () => t };
}

describe('createCodesFeed', () => {
  it('fetches on first refresh and returns the list', async () => {
    const { feed, calls } = setup([res(genshinFixture, 200, '"v1"')]);
    const out = await feed.refresh('genshin');
    expect(calls).toHaveLength(1);
    expect(out.changed).toBe(true);
    expect(out.data?.items).toHaveLength(3);
  });

  it('does not refetch within 5 minutes, but does after', async () => {
    const { feed, calls, advance } = setup([res(genshinFixture, 200, '"v1"'), res(genshinFixture, 200, '"v2"')]);
    await feed.refresh('genshin');
    advance(CODES_MIN_INTERVAL_MS - 1);
    const early = await feed.refresh('genshin');
    expect(calls).toHaveLength(1);
    expect(early.changed).toBe(false);
    expect(early.data?.items).toHaveLength(3);
    advance(1);
    await feed.refresh('genshin');
    expect(calls).toHaveLength(2);
  });

  it('throttles per game', async () => {
    const { feed, calls } = setup([res(genshinFixture, 200, '"a"'), res(genshinFixture, 200, '"b"')]);
    await feed.refresh('genshin');
    await feed.refresh('hsr');
    expect(calls).toHaveLength(2);
  });

  it('sends the last ETag as If-None-Match', async () => {
    const { feed, calls, advance } = setup([res(genshinFixture, 200, '"v1"'), res(null, 304)]);
    await feed.refresh('genshin');
    expect(calls[0].init?.headers).toBeUndefined();
    advance(CODES_MIN_INTERVAL_MS);
    await feed.refresh('genshin');
    expect(calls[1].init?.headers).toEqual({ 'If-None-Match': '"v1"' });
  });

  it('keeps the list on 304 and updates the last-checked time', async () => {
    const { feed, advance, clock } = setup([res(genshinFixture, 200, '"v1"'), res(null, 304)]);
    const first = await feed.refresh('genshin');
    advance(CODES_MIN_INTERVAL_MS);
    const second = await feed.refresh('genshin');
    expect(second.changed).toBe(false);
    expect(second.data?.items).toEqual(first.data?.items);
    expect(second.checkedAt).toBe(clock());
    expect(second.checkedAt).toBeGreaterThan(first.checkedAt!);
  });

  it('retries immediately after a failure (throttle counts only successful checks)', async () => {
    const { feed, calls } = setup([res({}, 500), res(genshinFixture, 200)]);
    await expect(feed.refresh('genshin')).rejects.toMatchObject({ name: 'CodesApiError' });
    const out = await feed.refresh('genshin');
    expect(calls).toHaveLength(2);
    expect(out.data?.items).toHaveLength(3);
  });

  it('shares one in-flight request between concurrent refreshes', async () => {
    const { feed, calls } = setup([res(genshinFixture, 200)]);
    await Promise.all([feed.refresh('genshin'), feed.refresh('genshin')]);
    expect(calls).toHaveLength(1);
  });

  it('exposes the cached list for stale display after a later failure', async () => {
    const { feed, advance } = setup([res(genshinFixture, 200), res({}, 500)]);
    await feed.refresh('genshin');
    advance(CODES_MIN_INTERVAL_MS);
    await expect(feed.refresh('genshin')).rejects.toBeDefined();
    expect(feed.cached('genshin')?.data.items).toHaveLength(3);
  });
});
