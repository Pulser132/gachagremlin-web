// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginSignIn,
  completeSignIn,
  DiscordAuthError,
  getSession,
  parseCallback,
  redirectUri,
  signOut,
} from '../src/data/discord/auth.ts';

const SESSION_KEY = 'gachagremlin:reminders:session';
const PENDING_KEY = 'gachagremlin:reminders:discord-pending';
const BASE = 'https://api.test';
const REDIRECT = 'https://pulser132.github.io/gachagremlin-web/';

function fakeFetch(respond: (url: string, body: unknown) => { status: number; body?: unknown } | 'throw') {
  const calls: { url: string; method?: string; headers?: HeadersInit; body: unknown }[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, method: init?.method, headers: init?.headers, body });
    const r = respond(url, body);
    if (r === 'throw') throw new Error('offline');
    return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status });
  };
  return { impl, calls };
}

const GOOD = {
  token: 'sess-token',
  expiresAt: Date.now() + 86_400_000,
  user: { id: '123456789012345678', username: 'gremlin', avatar: null },
};

async function startedFlow() {
  const url = new URL(beginSignIn('cid', REDIRECT));
  const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY)!) as { state: string };
  return { url, ...pending };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('redirectUri', () => {
  it('joins origin and base path for prod and dev', () => {
    expect(redirectUri('https://pulser132.github.io', '/gachagremlin-web/')).toBe(REDIRECT);
    expect(redirectUri('http://localhost:5173', '/gachagremlin-web/')).toBe('http://localhost:5173/gachagremlin-web/');
  });
});

describe('beginSignIn', () => {
  it('builds a code authorize URL and remembers state', async () => {
    const { url, state } = await startedFlow();
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    const q = url.searchParams;
    expect(q.get('client_id')).toBe('cid');
    expect(q.get('response_type')).toBe('code');
    expect(q.get('scope')).toBe('identify');
    expect(q.get('redirect_uri')).toBe(REDIRECT);
    expect(q.get('state')).toBe(state);
    expect(q.has('code_challenge')).toBe(false);
    expect(q.has('code_challenge_method')).toBe(false);
  });

  it('uses a fresh state each time', async () => {
    const a = await startedFlow();
    const b = await startedFlow();
    expect(a.state).not.toBe(b.state);
  });
});

describe('parseCallback', () => {
  it('ignores URLs that are not a callback', () => {
    expect(parseCallback('')).toEqual({ kind: 'none' });
    expect(parseCallback('?code=abc')).toEqual({ kind: 'none' });
    expect(parseCallback('?foo=1&state=s')).toEqual({ kind: 'none' });
  });
  it('reads code and state', () => {
    expect(parseCallback('?code=abc&state=xyz')).toEqual({ kind: 'code', code: 'abc', state: 'xyz' });
  });
  it('maps access_denied to a cancel message and other errors to detail', () => {
    expect(parseCallback('?error=access_denied&state=s')).toMatchObject({ kind: 'error', message: expect.stringContaining('cancelled') });
    expect(parseCallback('?error=server_error&error_description=boom&state=s')).toMatchObject({ kind: 'error', message: expect.stringContaining('boom') });
  });
});

describe('completeSignIn', () => {
  it('posts code and redirectUri, then stores the session', async () => {
    const { state } = await startedFlow();
    const f = fakeFetch(() => ({ status: 200, body: GOOD }));
    const session = await completeSignIn(`?code=abc&state=${state}`, { fetchImpl: f.impl, baseUrl: BASE, redirect: REDIRECT });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe(`${BASE}/v1/auth/discord`);
    expect(f.calls[0]!.method).toBe('POST');
    expect(f.calls[0]!.body).toEqual({ code: 'abc', redirectUri: REDIRECT });
    expect(session.user.id).toBe('123456789012345678');
    expect(getSession()).toEqual(GOOD);
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('rejects a mismatched state without calling the API', async () => {
    await startedFlow();
    const f = fakeFetch(() => ({ status: 200, body: GOOD }));
    await expect(completeSignIn('?code=abc&state=forged', { fetchImpl: f.impl, baseUrl: BASE })).rejects.toThrow(/state mismatch/);
    expect(f.calls).toHaveLength(0);
    expect(getSession()).toBeNull();
  });

  it('rejects when no sign-in was started, and a state cannot be replayed', async () => {
    const f = fakeFetch(() => ({ status: 200, body: GOOD }));
    await expect(completeSignIn('?code=abc&state=x', { fetchImpl: f.impl, baseUrl: BASE })).rejects.toThrow(DiscordAuthError);
    const { state } = await startedFlow();
    await completeSignIn(`?code=abc&state=${state}`, { fetchImpl: f.impl, baseUrl: BASE });
    await expect(completeSignIn(`?code=abc&state=${state}`, { fetchImpl: f.impl, baseUrl: BASE })).rejects.toThrow(/state mismatch/);
  });

  it('surfaces a Discord-side error param and clears pending state', async () => {
    await startedFlow();
    const f = fakeFetch(() => ({ status: 200, body: GOOD }));
    await expect(completeSignIn('?error=access_denied&state=s', { fetchImpl: f.impl, baseUrl: BASE })).rejects.toThrow(/cancelled/);
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it.each([
    [401, /rejected/],
    [429, /Too many/],
    [500, /\(500\)/],
  ])('maps HTTP %i to a message and stores nothing', async (status, msg) => {
    const { state } = await startedFlow();
    const f = fakeFetch(() => ({ status, body: { error: 'x' } }));
    await expect(completeSignIn(`?code=c&state=${state}`, { fetchImpl: f.impl, baseUrl: BASE })).rejects.toThrow(msg);
    expect(getSession()).toBeNull();
  });

  it('reports a network failure and a malformed response', async () => {
    let s = (await startedFlow()).state;
    await expect(completeSignIn(`?code=c&state=${s}`, { fetchImpl: fakeFetch(() => 'throw').impl, baseUrl: BASE })).rejects.toThrow(/Could not reach|Couldn.t reach/);
    s = (await startedFlow()).state;
    await expect(completeSignIn(`?code=c&state=${s}`, { fetchImpl: fakeFetch(() => ({ status: 200, body: { token: 't' } })).impl, baseUrl: BASE })).rejects.toThrow(/unreadable/);
  });
});

describe('session', () => {
  it('drops an expired session', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...GOOD, expiresAt: 1000 }));
    expect(getSession(2000)).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('treats corrupt storage as signed out', () => {
    localStorage.setItem(SESSION_KEY, '{nope');
    expect(getSession()).toBeNull();
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 't' }));
    expect(getSession()).toBeNull();
  });
});

describe('signOut', () => {
  it('calls logout with the bearer token and clears the session', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(GOOD));
    const f = fakeFetch(() => ({ status: 204 }));
    await signOut({ fetchImpl: f.impl, baseUrl: BASE });
    expect(f.calls[0]!.url).toBe(`${BASE}/v1/auth/logout`);
    expect(f.calls[0]!.method).toBe('POST');
    expect(f.calls[0]!.headers).toMatchObject({ Authorization: 'Bearer sess-token' });
    expect(getSession()).toBeNull();
  });

  it('still clears locally when logout fails or the bot is unreachable', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(GOOD));
    await signOut({ fetchImpl: fakeFetch(() => 'throw').impl, baseUrl: BASE });
    expect(getSession()).toBeNull();
    localStorage.setItem(SESSION_KEY, JSON.stringify(GOOD));
    await signOut({ fetchImpl: fakeFetch(() => ({ status: 401 })).impl, baseUrl: BASE });
    expect(getSession()).toBeNull();
  });

  it('makes no request when already signed out', async () => {
    const f = fakeFetch(() => ({ status: 204 }));
    await signOut({ fetchImpl: f.impl, baseUrl: BASE });
    expect(f.calls).toHaveLength(0);
  });
});
