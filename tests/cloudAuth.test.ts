// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GisTokenClientConfig, GisTokenResponse } from '../src/data/cloud/gis.d.ts';

vi.mock('../src/data/cloud/config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/cloud/config.ts')>()),
  GOOGLE_CLIENT_ID: 'test-client-id',
  isCloudConfigured: () => true,
}));

const { CloudError } = await import('../src/data/cloud/drive.ts');
const { connect, disconnect, getToken, isConnected, resetAuthForTests } = await import('../src/data/cloud/auth.ts');

/** Installs a fake GIS global. `respond` decides what each token request
 * returns, and receives the prompt GIS was called with ('' = silent). */
function fakeGis(respond: (prompt: string | undefined) => GisTokenResponse) {
  const revoke = vi.fn((_token: string, done?: () => void) => done?.());
  const requests: (string | undefined)[] = [];

  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: GisTokenClientConfig) => ({
          requestAccessToken: (overrides?: { prompt?: string }) => {
            requests.push(overrides?.prompt);
            config.callback(respond(overrides?.prompt));
          },
        }),
        revoke,
      },
    },
  };
  return { revoke, requests };
}

beforeEach(() => {
  localStorage.clear();
  resetAuthForTests();
});

afterEach(() => {
  delete window.google;
  document.querySelectorAll('script').forEach((s) => s.remove());
});

describe('connect', () => {
  it('requests a token interactively and records the opt-in', async () => {
    const { requests } = fakeGis(() => ({ access_token: 'tok-1', expires_in: 3600 }));
    expect(isConnected()).toBe(false);

    await connect();

    expect(isConnected()).toBe(true);
    expect(requests).toEqual([undefined]); // interactive: no prompt:'' override
  });

  it('surfaces a typed error when the user dismisses consent', async () => {
    fakeGis(() => ({ error: 'access_denied', error_description: 'User denied' }));
    await expect(connect()).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(isConnected()).toBe(false); // a refused consent must not look connected
  });
});

describe('getToken', () => {
  it('caches the token and reuses it without hitting Google again', async () => {
    const { requests } = fakeGis(() => ({ access_token: 'tok-1', expires_in: 3600 }));

    expect(await getToken({}, () => 0)).toBe('tok-1');
    expect(await getToken({}, () => 0)).toBe('tok-1');
    expect(requests).toHaveLength(1);
  });

  it('silently re-requests once the cached token nears expiry', async () => {
    let n = 0;
    const { requests } = fakeGis(() => ({ access_token: `tok-${++n}`, expires_in: 3600 }));

    expect(await getToken({}, () => 0)).toBe('tok-1');
    // 3600s later, past the expiry skew.
    expect(await getToken({}, () => 3_600_000)).toBe('tok-2');
    expect(requests).toEqual(['', '']); // both silent — no consent popup
  });

  it('bypasses the cache when forceRefresh is set (the 401 retry path)', async () => {
    let n = 0;
    const { requests } = fakeGis(() => ({ access_token: `tok-${++n}`, expires_in: 3600 }));

    expect(await getToken({}, () => 0)).toBe('tok-1');
    expect(await getToken({ forceRefresh: true }, () => 0)).toBe('tok-2');
    expect(requests).toHaveLength(2);
  });

  it('collapses concurrent requests into one round-trip', async () => {
    const { requests } = fakeGis(() => ({ access_token: 'tok-1', expires_in: 3600 }));

    const [a, b, c] = await Promise.all([getToken({}, () => 0), getToken({}, () => 0), getToken({}, () => 0)]);
    expect([a, b, c]).toEqual(['tok-1', 'tok-1', 'tok-1']);
    expect(requests).toHaveLength(1);
  });

  it('raises unauthorized when Google will not issue a token without UI', async () => {
    fakeGis(() => ({ error: 'interaction_required' }));
    const error = await getToken({}, () => 0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudError);
    expect((error as InstanceType<typeof CloudError>).kind).toBe('unauthorized');
  });
});

describe('script loading', () => {
  it('is lazy: nothing is injected until a token is actually needed', () => {
    expect(document.querySelector('script[src*="gsi/client"]')).toBeNull();
  });

  it('rejects rather than hanging when the script cannot load', async () => {
    // No window.google, and the injected script errors (offline/blocked).
    const promise = getToken({}, () => 0);
    const script = document.querySelector('script[src*="gsi/client"]');
    expect(script).not.toBeNull();
    script!.dispatchEvent(new Event('error'));

    await expect(promise).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('disconnect', () => {
  it('revokes the token and clears the opt-in', async () => {
    const { revoke } = fakeGis(() => ({ access_token: 'tok-1', expires_in: 3600 }));
    await connect();
    expect(isConnected()).toBe(true);

    await disconnect();

    expect(revoke).toHaveBeenCalledWith('tok-1', expect.any(Function));
    expect(isConnected()).toBe(false);
  });

  it('still clears the opt-in when there is no token to revoke', async () => {
    localStorage.setItem('gachagremlin:cloud:connected', 'true');
    await disconnect();
    expect(isConnected()).toBe(false);
  });
});

describe('token persistence', () => {
  it('never writes the access token to storage', async () => {
    fakeGis(() => ({ access_token: 'super-secret-token', expires_in: 3600 }));
    await connect();
    await getToken({}, () => 0);

    const dump = JSON.stringify(
      Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])),
    );
    expect(dump).not.toContain('super-secret-token');
    expect(JSON.stringify(sessionStorage)).not.toContain('super-secret-token');
    // Only the opt-in flag is persisted.
    expect(localStorage.getItem('gachagremlin:cloud:connected')).toBe('true');
  });
});
