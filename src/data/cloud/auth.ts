/**
 * Google sign-in for cloud sync, via the GIS token client.
 *
 * Two properties drive the whole design:
 *
 * 1. **The script loads lazily.** `accounts.google.com/gsi/client` is only
 *    injected when the user actually engages cloud sync — never on a normal
 *    page load. Someone who never connects makes zero requests to Google and
 *    the site works fully offline.
 * 2. **The token is never persisted.** A pure client-side flow gets no refresh
 *    token, so the access token (~1h) lives in module memory only and is
 *    silently re-requested (`prompt: ''`) against the live Google session when
 *    it lapses. What *is* persisted is a boolean: "the user opted in". Writing
 *    the token to storage would leave a Drive-capable credential sitting in a
 *    place XSS or a shared machine can read it, for no benefit.
 */
import { DRIVE_APPDATA_SCOPE, GOOGLE_CLIENT_ID } from './config.ts';
import { CloudError } from './drive.ts';
import type { GisTokenClient, GisTokenResponse } from './gis.d.ts';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const CONNECTED_KEY = 'gachagremlin:cloud:connected';
/** Refresh a little early so a token can't expire mid-request. */
const EXPIRY_SKEW_MS = 60_000;

let scriptPromise: Promise<void> | null = null;
let tokenClient: GisTokenClient | null = null;
let cached: { token: string; expiresAt: number } | null = null;
/** Serializes concurrent token requests — GIS holds one callback per client,
 * so overlapping requestAccessToken calls would clobber each other. */
let pending: Promise<string> | null = null;

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

async function getClient(): Promise<GisTokenClient> {
  await loadGis();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new CloudError('other', 'Google sign-in is unavailable.');
  if (!tokenClient) {
    tokenClient = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_APPDATA_SCOPE,
      // Replaced per-request below; GIS requires one at construction.
      callback: () => {},
    });
  }
  return tokenClient;
}

function expiryFrom(response: GisTokenResponse, now: number): number {
  const seconds = Number(response.expires_in ?? 3600);
  return now + (Number.isFinite(seconds) ? seconds : 3600) * 1000 - EXPIRY_SKEW_MS;
}

/** One token round-trip. `interactive` decides whether Google may show UI. */
function requestToken(interactive: boolean, now: () => number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    void getClient().then(
      (client) => {
        const oauth2 = window.google?.accounts?.oauth2;
        if (!oauth2) return reject(new CloudError('other', 'Google sign-in is unavailable.'));

        // Re-init per request so this call's callback is the live one.
        tokenClient = oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: DRIVE_APPDATA_SCOPE,
          callback: (response: GisTokenResponse) => {
            if (response.error || !response.access_token) {
              return reject(new CloudError('unauthorized', response.error_description ?? response.error ?? 'Google sign-in failed.'));
            }
            cached = { token: response.access_token, expiresAt: expiryFrom(response, now()) };
            resolve(response.access_token);
          },
          error_callback: (err) => reject(new CloudError('unauthorized', err?.message ?? 'Google sign-in was dismissed.')),
        });
        client = tokenClient;
        client.requestAccessToken(interactive ? {} : { prompt: '' });
      },
      (e) => reject(e),
    );
  });
}

/**
 * Interactive connect: shows Google's consent popup and marks the user opted-in.
 * @param now injectable for tests; defaults to the real wall clock.
 */
export async function connect(now: () => number = Date.now): Promise<void> {
  await requestToken(true, now);
  setConnected(true);
}

/**
 * Returns a usable access token, silently re-requesting when the cached one is
 * missing or near expiry. Throws `CloudError('unauthorized')` when Google
 * won't issue one without UI — the caller surfaces a Reconnect prompt rather
 * than popping consent uninvited.
 * @param opts.forceRefresh bypasses the cache (used after a 401 mid-request).
 * @param now injectable for tests.
 */
export async function getToken(opts: { forceRefresh?: boolean } = {}, now: () => number = Date.now): Promise<string> {
  if (!opts.forceRefresh && cached && cached.expiresAt > now()) return cached.token;
  if (pending) return pending;

  cached = null;
  pending = requestToken(false, now).finally(() => {
    pending = null;
  });
  return pending;
}

/** Revokes the token and clears the opt-in. The cloud copy is left alone —
 * disconnecting stops syncing, it doesn't destroy the user's backup. */
export async function disconnect(): Promise<void> {
  const token = cached?.token;
  cached = null;
  setConnected(false);

  if (!token) return;
  try {
    const oauth2 = window.google?.accounts?.oauth2;
    await new Promise<void>((resolve) => {
      if (!oauth2) return resolve();
      oauth2.revoke(token, () => resolve());
    });
  } catch {
    // Best effort: the local opt-in is already cleared, and the token expires
    // within the hour regardless.
  }
}

/** Test seam: drops all module state between cases. */
export function resetAuthForTests(): void {
  scriptPromise = null;
  tokenClient = null;
  cached = null;
  pending = null;
}
