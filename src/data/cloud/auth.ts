/**
 * Google sign-in for cloud sync, via the OAuth authorization-code flow.
 *
 * Three properties drive the whole design:
 *
 * 1. **The GIS script loads lazily — and only for interactive connect.** The
 *    popup code client is the sole GIS surface we use, so
 *    `accounts.google.com/gsi/client` is injected only when the user clicks
 *    Connect/Reconnect. Background token refresh is a plain fetch to our
 *    OAuth Worker; someone who never connects makes zero requests to Google.
 * 2. **The refresh token is persisted in localStorage.** This is the accepted
 *    tradeoff that kills the popup-every-few-minutes problem: the code
 *    exchange (via the secret-holding Worker, see workers/oauth/) yields a
 *    long-lived refresh token, so the user consents once and every later
 *    access token is fetched silently in the background. The credential's
 *    blast radius is one scope — the app's own hidden appDataFolder.
 * 3. **Auth failure never opens UI.** When the refresh token is missing or
 *    revoked, `getToken` throws `CloudError('unauthorized')` and the footer
 *    offers a Reconnect button; consent only ever appears on a user click.
 */
import { DRIVE_APPDATA_SCOPE, GOOGLE_CLIENT_ID, OAUTH_WORKER_URL } from './config.ts';
import { CloudError, type FetchLike } from './drive.ts';
import type { GisCodeResponse } from './gis.d.ts';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CONNECTED_KEY = 'gachagremlin:cloud:connected';
const TOKENS_KEY = 'gachagremlin:cloud:tokens';
/** Refresh a little early so a token can't expire mid-request. */
const EXPIRY_SKEW_MS = 60_000;

let scriptPromise: Promise<void> | null = null;
/** Serializes concurrent refreshes — overlapping calls share one round-trip. */
let pending: Promise<string> | null = null;

interface StoredTokens {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
}

export function isConnected(): boolean {
  try {
    return localStorage.getItem(CONNECTED_KEY) === 'true';
  } catch {
    return false;
  }
}

function setConnected(value: boolean): void {
  try {
    if (value) localStorage.setItem(CONNECTED_KEY, 'true');
    else localStorage.removeItem(CONNECTED_KEY);
  } catch {
    // storage unavailable — cloud sync just won't persist across reloads
  }
}

/** A corrupt or legacy value reads as "no tokens" (→ Reconnect), never throws. */
function readTokens(): StoredTokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTokens> | null;
    if (typeof parsed?.refreshToken !== 'string' || !parsed.refreshToken) return null;
    return parsed as StoredTokens;
  } catch {
    return null;
  }
}

function writeTokens(tokens: StoredTokens): void {
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    // storage unavailable — auth still works for this page's lifetime
  }
}

function clearTokens(): void {
  try {
    localStorage.removeItem(TOKENS_KEY);
  } catch {
    // nothing to clear
  }
}

function expiryFrom(expiresIn: unknown, now: number): number {
  const seconds = Number(expiresIn ?? 3600);
  return now + (Number.isFinite(seconds) ? seconds : 3600) * 1000 - EXPIRY_SKEW_MS;
}

/** Injects the GIS script once. Rejects (rather than hanging) when it can't
 * load — offline, blocked by an extension, or a restrictive network — so the
 * caller can show an error instead of a spinner that never resolves. */
function loadGis(): Promise<void> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const script = existing ?? document.createElement('script');
    const onLoad = () => (window.google?.accounts?.oauth2 ? resolve() : reject(new CloudError('other', 'Google sign-in loaded but is unavailable.')));

    script.addEventListener('load', onLoad);
    script.addEventListener('error', () => reject(new CloudError('network', "Couldn't load Google sign-in. Check your connection.")));

    if (!existing) {
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((e) => {
    scriptPromise = null; // let a later attempt retry rather than cache the failure
    throw e;
  });

  return scriptPromise;
}

/** One consent popup → authorization code. A fresh client per call so this
 * call's callback is the live one. */
function requestCode(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    void loadGis().then(() => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2) return reject(new CloudError('other', 'Google sign-in is unavailable.'));

      const client = oauth2.initCodeClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_APPDATA_SCOPE,
        ux_mode: 'popup',
        callback: (response: GisCodeResponse) => {
          if (response.error || !response.code) {
            return reject(new CloudError('unauthorized', response.error_description ?? response.error ?? 'Google sign-in failed.'));
          }
          resolve(response.code);
        },
        error_callback: (err) => reject(new CloudError('unauthorized', err?.message ?? 'Google sign-in was dismissed.')),
      });
      client.requestCode();
    }, reject);
  });
}

/** POSTs JSON to the OAuth Worker; a thrown fetch becomes a typed `network`
 * error so transient outages never read as "reconnect required". */
async function workerPost(
  path: string,
  body: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetchImpl(`${OAUTH_WORKER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new CloudError('network', `Couldn't reach the sign-in service: ${(e as Error).message}`);
  }
  const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

/**
 * Interactive connect: one consent popup → code → Worker exchange → tokens
 * persisted. The only place any Google UI can ever appear.
 * @param now injectable for tests; defaults to the real wall clock.
 * @param fetchImpl injectable for tests; defaults to the real fetch.
 */
export async function connect(now: () => number = Date.now, fetchImpl: FetchLike = fetch): Promise<void> {
  const code = await requestCode();
  const { status, body } = await workerPost('/token', { code }, fetchImpl);

  const accessToken = typeof body.access_token === 'string' ? body.access_token : null;
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : null;
  if (status !== 200 || !accessToken) {
    const detail = typeof body.error_description === 'string' ? body.error_description : `Google sign-in failed (${status}).`;
    throw new CloudError('unauthorized', detail);
  }
  if (!refreshToken) {
    // Shouldn't happen — the popup code flow re-consents every time, and
    // consent always yields a refresh token — but never store a half-grant.
    throw new CloudError('other', 'Google did not grant offline access. Remove GachaGremlin at myaccount.google.com/connections, then connect again.');
  }

  writeTokens({ refreshToken, accessToken, expiresAt: expiryFrom(body.expires_in, now()) });
  setConnected(true);
}

/** One background round-trip to the Worker's /refresh. */
async function refreshAccessToken(refreshToken: string, now: () => number, fetchImpl: FetchLike): Promise<string> {
  const { status, body } = await workerPost('/refresh', { refresh_token: refreshToken }, fetchImpl);

  if (status === 401) {
    // invalid_grant: the user revoked access (or the grant lapsed). The dead
    // refresh token goes; the connected flag stays so the footer offers
    // Reconnect rather than presenting cloud sync as switched off.
    clearTokens();
    throw new CloudError('unauthorized', 'Google access expired or was revoked. Reconnect to keep syncing.');
  }
  const accessToken = typeof body.access_token === 'string' ? body.access_token : null;
  if (status !== 200 || !accessToken) {
    throw new CloudError(status >= 500 ? 'network' : 'other', `Token refresh failed (${status}).`);
  }

  writeTokens({ refreshToken, accessToken, expiresAt: expiryFrom(body.expires_in, now()) });
  return accessToken;
}

/**
 * Returns a usable access token: the persisted one while it's fresh, otherwise
 * a silent background refresh via the Worker. Never opens any UI — when the
 * grant is missing or dead it throws `CloudError('unauthorized')` and the
 * caller surfaces a Reconnect prompt.
 * @param opts.forceRefresh bypasses the cached access token (used after a 401
 *   mid-request); the refresh token itself is always reused.
 * @param now injectable for tests.
 * @param fetchImpl injectable for tests.
 */
export async function getToken(
  opts: { forceRefresh?: boolean } = {},
  now: () => number = Date.now,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const stored = readTokens();
  if (!stored) {
    throw new CloudError('unauthorized', 'Reconnect Google Drive to keep syncing.');
  }
  if (!opts.forceRefresh && stored.accessToken && (stored.expiresAt ?? 0) > now()) {
    return stored.accessToken;
  }
  if (pending) return pending;

  pending = refreshAccessToken(stored.refreshToken, now, fetchImpl).finally(() => {
    pending = null;
  });
  return pending;
}

/** Revokes the whole grant (refresh token included) and clears the opt-in.
 * The cloud copy is left alone — disconnecting stops syncing, it doesn't
 * destroy the user's backup. */
export async function disconnect(fetchImpl: FetchLike = fetch): Promise<void> {
  const stored = readTokens();
  clearTokens();
  setConnected(false);

  const token = stored?.refreshToken ?? stored?.accessToken;
  if (!token) return;
  try {
    // Direct call, not via GIS — works even when the Google script never
    // loaded this session. Revoking the refresh token kills the whole grant.
    await fetchImpl(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // Best effort: local state is already cleared, and the user can always
    // revoke at myaccount.google.com/connections.
  }
}

/** Test seam: drops all module state between cases. Deliberately leaves
 * localStorage alone — persisted tokens surviving this is the reload story. */
export function resetAuthForTests(): void {
  scriptPromise = null;
  pending = null;
}
