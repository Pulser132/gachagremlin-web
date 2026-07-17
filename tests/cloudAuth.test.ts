// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GisCodeClientConfig, GisCodeResponse } from '../src/data/cloud/gis.d.ts';

vi.mock('../src/data/cloud/config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/cloud/config.ts')>()),
  GOOGLE_CLIENT_ID: 'test-client-id',
  OAUTH_WORKER_URL: 'https://worker.test',
  isCloudConfigured: () => true,
}));

const { CloudError } = await import('../src/data/cloud/drive.ts');
const { connect, disconnect, getToken, isConnected, resetAuthForTests } = await import('../src/data/cloud/auth.ts');

const TOKENS_KEY = 'gachagremlin:cloud:tokens';
const CONNECTED_KEY = 'gachagremlin:cloud:connected';

interface StoredTokens {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
}

function storedTokens(): StoredTokens | null {
  const raw = localStorage.getItem(TOKENS_KEY);
  return raw ? (JSON.parse(raw) as StoredTokens) : null;
}

function seedTokens(tokens: StoredTokens): void {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

/** Installs a fake GIS global whose code client immediately answers
 * `requestCode()` with whatever `respond` returns. */
function fakeGis(respond: () => GisCodeResponse) {
  const codeRequests: GisCodeClientConfig[] = [];
  window.google = {
    accounts: {
      oauth2: {
        initCodeClient: (config: GisCodeClientConfig) => ({
          requestCode: () => {
            codeRequests.push(config);
            config.callback(respond());
          },
        }),
      },
    },
  };
  return { codeRequests };
}

type RouteResult = { status: number; body?: unknown } | 'throw';

/** FetchLike stub routed on URL substring; records every call. JSON bodies are
 * parsed, non-JSON (the form-encoded revoke) kept as the raw string. */
function fakeFetch(routes: Record<string, (body: unknown) => RouteResult>) {
  const calls: { url: string; body: unknown }[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const raw = typeof init?.body === 'string' ? init.body : null;
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      // form-encoded — keep the raw string
    }
    calls.push({ url, body });
    const route = Object.entries(routes).find(([key]) => url.includes(key));
    if (!route) throw new Error(`fakeFetch: no route for ${url}`);
    const result = route[1](body);
    if (result === 'throw') throw new TypeError('network down');
    return new Response(JSON.stringify(result.body ?? {}), { status: result.status });
  };
  return { impl, calls };
}

const grant = { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 };

beforeEach(() => {
  localStorage.clear();
  resetAuthForTests();
});

afterEach(() => {
  delete window.google;
  document.querySelectorAll('script').forEach((s) => s.remove());
});

describe('connect', () => {
  it('exchanges the code at the worker and persists the grant', async () => {
    fakeGis(() => ({ code: 'code-1' }));
    const f = fakeFetch({ '/token': () => ({ status: 200, body: grant }) });

    await connect(() => 0, f.impl);

    expect(isConnected()).toBe(true);
    expect(f.calls).toEqual([{ url: 'https://worker.test/token', body: { code: 'code-1' } }]);
    // Persistence IS the contract now: the refresh token is what lets every
    // later token be fetched silently instead of via a popup.
    expect(storedTokens()).toEqual({ refreshToken: 'rt-1', accessToken: 'at-1', expiresAt: 3_600_000 - 60_000 });
  });

  it('surfaces a typed error when the user dismisses consent', async () => {
    fakeGis(() => ({ error: 'access_denied', error_description: 'User denied' }));
    const f = fakeFetch({});

    await expect(connect(() => 0, f.impl)).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(isConnected()).toBe(false); // a refused consent must not look connected
    expect(f.calls).toHaveLength(0);
  });

  it('rejects when the worker refuses the code', async () => {
    fakeGis(() => ({ code: 'code-1' }));
    const f = fakeFetch({ '/token': () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'Malformed code.' } }) });

    await expect(connect(() => 0, f.impl)).rejects.toMatchObject({ kind: 'unauthorized', message: 'Malformed code.' });
    expect(isConnected()).toBe(false);
    expect(storedTokens()).toBeNull();
  });

  it('never stores a half-grant when the exchange returns no refresh token', async () => {
    fakeGis(() => ({ code: 'code-1' }));
    const f = fakeFetch({ '/token': () => ({ status: 200, body: { access_token: 'at-1', expires_in: 3600 } }) });

    await expect(connect(() => 0, f.impl)).rejects.toMatchObject({ kind: 'other' });
    expect(isConnected()).toBe(false);
    expect(storedTokens()).toBeNull();
  });
});

describe('getToken', () => {
  it('throws unauthorized without any network or GIS when there is no grant (migration case)', async () => {
    localStorage.setItem(CONNECTED_KEY, 'true'); // implicit-flow user, pre-upgrade
    const f = fakeFetch({});

    const error = await getToken({}, () => 0, f.impl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudError);
    expect((error as InstanceType<typeof CloudError>).kind).toBe('unauthorized');
    expect(f.calls).toHaveLength(0);
    expect(document.querySelector('script[src*="gsi/client"]')).toBeNull();
    expect(isConnected()).toBe(true); // still opted in → footer offers Reconnect
  });

  it('returns the persisted access token with no round-trip while it is fresh', async () => {
    seedTokens({ refreshToken: 'rt-1', accessToken: 'at-1', expiresAt: 100 });
    const f = fakeFetch({});

    expect(await getToken({}, () => 0, f.impl)).toBe('at-1');
    expect(f.calls).toHaveLength(0);
  });

  it('survives a reload: a token persisted by connect is used after module state resets', async () => {
    fakeGis(() => ({ code: 'code-1' }));
    const f = fakeFetch({ '/token': () => ({ status: 200, body: grant }) });
    await connect(() => 0, f.impl);

    resetAuthForTests(); // the reload

    expect(await getToken({}, () => 0, f.impl)).toBe('at-1');
    expect(f.calls).toHaveLength(1); // only connect's exchange — no new request
  });

  it('refreshes in the background once the cached token nears expiry', async () => {
    seedTokens({ refreshToken: 'rt-1', accessToken: 'at-1', expiresAt: 1000 });
    const f = fakeFetch({ '/refresh': () => ({ status: 200, body: { access_token: 'at-2', expires_in: 3600 } }) });

    expect(await getToken({}, () => 5000, f.impl)).toBe('at-2');
    expect(f.calls).toEqual([{ url: 'https://worker.test/refresh', body: { refresh_token: 'rt-1' } }]);
    // The new token is persisted for the next reload; the refresh token is kept.
    expect(storedTokens()).toEqual({ refreshToken: 'rt-1', accessToken: 'at-2', expiresAt: 5000 + 3_600_000 - 60_000 });
  });

  it('bypasses the cached token when forceRefresh is set (the 401 retry path)', async () => {
    seedTokens({ refreshToken: 'rt-1', accessToken: 'at-1', expiresAt: 9_999_999 });
    const f = fakeFetch({ '/refresh': () => ({ status: 200, body: { access_token: 'at-2', expires_in: 3600 } }) });

    expect(await getToken({ forceRefresh: true }, () => 0, f.impl)).toBe('at-2');
    expect(storedTokens()?.refreshToken).toBe('rt-1');
  });

  it('collapses concurrent refreshes into one round-trip', async () => {
    seedTokens({ refreshToken: 'rt-1', expiresAt: 0 });
    const f = fakeFetch({ '/refresh': () => ({ status: 200, body: { access_token: 'at-2', expires_in: 3600 } }) });

    const [a, b, c] = await Promise.all([
      getToken({}, () => 1, f.impl),
      getToken({}, () => 1, f.impl),
      getToken({}, () => 1, f.impl),
    ]);
    expect([a, b, c]).toEqual(['at-2', 'at-2', 'at-2']);
    expect(f.calls).toHaveLength(1);
  });

  it('clears the dead grant but keeps the opt-in when the refresh token was revoked', async () => {
    localStorage.setItem(CONNECTED_KEY, 'true');
    seedTokens({ refreshToken: 'rt-dead', expiresAt: 0 });
    const f = fakeFetch({ '/refresh': () => ({ status: 401, body: { error: 'invalid_grant' } }) });

    await expect(getToken({}, () => 1, f.impl)).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(storedTokens()).toBeNull(); // dead token gone
    expect(isConnected()).toBe(true); // → Reconnect, not Connect
  });

  it('keeps the grant through a transient network failure', async () => {
    seedTokens({ refreshToken: 'rt-1', expiresAt: 0 });
    const f = fakeFetch({ '/refresh': () => 'throw' as const });

    await expect(getToken({}, () => 1, f.impl)).rejects.toMatchObject({ kind: 'network' });
    expect(storedTokens()?.refreshToken).toBe('rt-1'); // offline must not force re-consent
  });

  it('treats a corrupt stored blob as no grant rather than crashing', async () => {
    localStorage.setItem(TOKENS_KEY, '{not json');
    await expect(getToken({}, () => 0, fakeFetch({}).impl)).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});

describe('script loading', () => {
  it('is lazy: nothing is injected until an interactive connect', () => {
    expect(document.querySelector('script[src*="gsi/client"]')).toBeNull();
  });

  it('rejects rather than hanging when the script cannot load', async () => {
    // No window.google, and the injected script errors (offline/blocked).
    const promise = connect(() => 0, fakeFetch({}).impl);
    const script = document.querySelector('script[src*="gsi/client"]');
    expect(script).not.toBeNull();
    script!.dispatchEvent(new Event('error'));

    await expect(promise).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('disconnect', () => {
  it('revokes the refresh token (killing the whole grant) and clears both keys', async () => {
    localStorage.setItem(CONNECTED_KEY, 'true');
    seedTokens({ refreshToken: 'rt-1', accessToken: 'at-1', expiresAt: 100 });
    const f = fakeFetch({ 'oauth2.googleapis.com/revoke': () => ({ status: 200 }) });

    await disconnect(f.impl);

    expect(f.calls).toEqual([{ url: 'https://oauth2.googleapis.com/revoke', body: 'token=rt-1' }]);
    expect(storedTokens()).toBeNull();
    expect(isConnected()).toBe(false);
  });

  it('still clears local state when the revoke call fails', async () => {
    seedTokens({ refreshToken: 'rt-1' });
    localStorage.setItem(CONNECTED_KEY, 'true');
    const f = fakeFetch({ 'oauth2.googleapis.com/revoke': () => 'throw' as const });

    await disconnect(f.impl);

    expect(storedTokens()).toBeNull();
    expect(isConnected()).toBe(false);
  });

  it('makes no network call when there is nothing to revoke', async () => {
    localStorage.setItem(CONNECTED_KEY, 'true');
    const f = fakeFetch({});

    await disconnect(f.impl);

    expect(f.calls).toHaveLength(0);
    expect(isConnected()).toBe(false);
  });
});
