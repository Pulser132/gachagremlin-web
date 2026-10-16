import { describe, expect, it, vi } from 'vitest';
import { createReminderApi, ReminderApiError, type FetchLike } from '../src/data/reminderApi.ts';
import dms from './fixtures/codes/code-dms.json';
import e422 from './fixtures/codes/code-dms-422.json';
import e401 from './fixtures/codes/code-dms-401.json';
import e429 from './fixtures/codes/code-dms-429.json';
import dmsHsrOn from './fixtures/codes/code-dms-hsr-on.json';

function res(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function setup(response: Response | Error, token: string | null = 'tok') {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  const onUnauthorized = vi.fn();
  const api = createReminderApi({ baseUrl: 'https://api.test', getToken: () => token, onUnauthorized, fetchImpl });
  return { api, calls, onUnauthorized };
}

describe('code DM client', () => {
  it('GETs the full per-game state with the bearer token', async () => {
    const { api, calls } = setup(res(dms));
    expect(await api.codeDms()).toEqual({ genshin: true, hsr: false, zzz: false });
    expect(calls[0].url).toBe('https://api.test/v1/me/code-dms');
    expect(calls[0].init?.method).toBe('GET');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('PUTs a partial map and returns the full state', async () => {
    const { api, calls } = setup(res(dmsHsrOn));
    expect(await api.setCodeDms({ hsr: true })).toEqual({ genshin: true, hsr: true, zzz: false });
    expect(calls[0].init?.method).toBe('PUT');
    expect(calls[0].init?.body).toBe('{"hsr":true}');
  });

  it('maps 422 dms_closed to its own kind', async () => {
    const { api } = setup(res(e422, 422));
    await expect(api.setCodeDms({ hsr: true })).rejects.toMatchObject({ kind: 'dms_closed', status: 422 });
  });

  it('maps 401 to unauthorized and signals the session is dead', async () => {
    const { api, onUnauthorized } = setup(res(e401, 401));
    await expect(api.codeDms()).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalled();
  });

  it('maps 429 to rate-limited', async () => {
    const { api } = setup(res(e429, 429));
    await expect(api.setCodeDms({ zzz: true })).rejects.toMatchObject({ kind: 'rate-limited' });
  });

  it('maps a network failure to network, and other statuses to other', async () => {
    await expect(setup(new TypeError('offline')).api.setCodeDms({ zzz: true })).rejects.toMatchObject({ kind: 'network' });
    await expect(setup(res({}, 500)).api.codeDms()).rejects.toBeInstanceOf(ReminderApiError);
  });

  it('rejects a body that is not the per-game map', async () => {
    await expect(setup(res({ nope: 1 })).api.codeDms()).rejects.toMatchObject({ kind: 'other' });
  });
});
