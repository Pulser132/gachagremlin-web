import { describe, expect, it } from 'vitest';
import { CodesApiError, fetchCodes, liveCodes } from '../src/data/codesApi.ts';
import type { FetchLike } from '../src/data/cloud/drive.ts';
import genshinFixture from './fixtures/codes/genshin.json';
import emptyFixture from './fixtures/codes/empty.json';

function res(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function stub(response: Response | Error): { impl: FetchLike; urls: string[]; inits: (RequestInit | undefined)[] } {
  const urls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  const impl: FetchLike = async (url, init) => {
    urls.push(url);
    inits.push(init);
    if (response instanceof Error) throw response;
    return response;
  };
  return { impl, urls, inits };
}

const BASE = 'https://api.test';

describe('fetchCodes', () => {
  it('GETs /v1/codes?game= with no credentials or token', async () => {
    const { impl, urls, inits } = stub(res(genshinFixture));
    await fetchCodes('genshin', { baseUrl: `${BASE}/`, fetchImpl: impl });
    expect(urls).toEqual([`${BASE}/v1/codes?game=genshin`]);
    expect(inits[0]?.headers).toBeUndefined();
    expect(inits[0]?.credentials).toBeUndefined();
  });

  it('keeps contract fields and drops unknown ones', async () => {
    const { impl } = stub(res(genshinFixture));
    const out = await fetchCodes('genshin', { baseUrl: BASE, fetchImpl: impl });
    expect(out.lastCheckedAt).toBe(1786400100000);
    expect(out.items).toHaveLength(3);
    expect(out.items[1]).toEqual({
      game: 'genshin',
      code: 'ABC123XYZ',
      status: 'active',
      rewards: [{ item: 'Primogem', qty: 60 }, { item: 'Mora', qty: 10000 }],
      premium: true,
      claimUrl: 'https://genshin.hoyoverse.com/gift?code=ABC123XYZ',
      firstSeenAt: 1786400000000,
      expiredAt: null,
    });
    expect(out).not.toHaveProperty('newTopLevelField');
    expect(out.items[0]).not.toHaveProperty('futureField');
  });

  it('accepts an empty set with a null lastCheckedAt', async () => {
    const { impl } = stub(res(emptyFixture));
    expect(await fetchCodes('hsr', { baseUrl: BASE, fetchImpl: impl })).toEqual({ items: [], lastCheckedAt: null });
  });

  it('maps a network failure to a typed error', async () => {
    const { impl } = stub(new TypeError('offline'));
    await expect(fetchCodes('zzz', { baseUrl: BASE, fetchImpl: impl })).rejects.toMatchObject({ name: 'CodesApiError', kind: 'network' });
  });

  it('maps 429 to rate-limited and other statuses to other', async () => {
    await expect(fetchCodes('zzz', { baseUrl: BASE, fetchImpl: stub(res({}, 429)).impl })).rejects.toMatchObject({ kind: 'rate-limited', status: 429 });
    await expect(fetchCodes('zzz', { baseUrl: BASE, fetchImpl: stub(res({ error: 'bad_request' }, 400)).impl })).rejects.toBeInstanceOf(CodesApiError);
  });

  it('rejects a body that does not match the contract', async () => {
    await expect(fetchCodes('zzz', { baseUrl: BASE, fetchImpl: stub(res({ nope: 1 })).impl })).rejects.toMatchObject({ kind: 'other' });
  });
});

describe('liveCodes', () => {
  it('drops expired items and sorts newest firstSeenAt first', async () => {
    const { impl } = stub(res(genshinFixture));
    const { items } = await fetchCodes('genshin', { baseUrl: BASE, fetchImpl: impl });
    expect(liveCodes(items).map((c) => c.code)).toEqual(['ABC123XYZ', 'OLDER123']);
  });
});
