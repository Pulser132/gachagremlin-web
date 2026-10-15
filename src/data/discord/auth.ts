/**
 * "Sign in with Discord" for reminder sync: OAuth2 authorization-code flow
 * with PKCE (S256), scope `identify`. Optional — signed out, reminders stay
 * local-only exactly as before.
 * Contract: https://github.com/Pulser132/GachaGremlin/blob/bbfdbcc/docs/api/reminders.md
 *
 * The site never sees a client secret: it sends the code and PKCE verifier to
 * the bot (`POST /v1/auth/discord`), which exchanges them with Discord and
 * returns an opaque session token. Only that token, its expiry and the user
 * (string ID — Discord IDs exceed 2^53) are stored, under their own key.
 */
import { createReminderApi, isReminderApiConfigured, REMINDER_API_BASE_URL, ReminderApiError, type FetchLike } from '../reminderApi.ts';

/** Public by design (OAuth client IDs ship in every client-side bundle). Blank
 * until the maintainer registers the Discord application; see the README. */
export const DISCORD_CLIENT_ID: string = String(import.meta.env.VITE_DISCORD_CLIENT_ID ?? '').trim();

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const SESSION_KEY = 'gachagremlin:reminders:session';
/** Survives the round-trip to Discord (a full-page redirect), not the tab. */
const PENDING_KEY = 'gachagremlin:reminders:discord-pending';

/** No Discord client ID or no reminder API → no sign-in UI at all. */
export function isDiscordConfigured(): boolean {
  return DISCORD_CLIENT_ID.length > 0 && isReminderApiConfigured();
}

export interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
}

export interface DiscordSession {
  token: string;
  /** Unix ms. */
  expiresAt: number;
  user: DiscordUser;
}

export class DiscordAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscordAuthError';
  }
}

/**
 * The exact redirect URI to register on the Discord application:
 * origin + the Vite base path, so
 *   https://pulser132.github.io/gachagremlin-web/   (prod)
 *   http://localhost:5173/gachagremlin-web/           (dev)
 */
export function redirectUri(origin: string = location.origin, basePath: string = import.meta.env.BASE_URL): string {
  return `${origin}${basePath}`;
}

// ---- PKCE ------------------------------------------------------------------

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(byteLength = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** S256 code challenge: base64url(SHA-256(verifier)). */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

interface Pending {
  state: string;
  verifier: string;
}

function savePending(p: Pending): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    throw new DiscordAuthError('Discord sign-in needs session storage, which is unavailable.');
  }
}

/** Reads and always clears: a state is single-use. */
function takePending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Pending> | null;
    if (typeof p?.state !== 'string' || typeof p.verifier !== 'string' || !p.state || !p.verifier) return null;
    return { state: p.state, verifier: p.verifier };
  } catch {
    return null;
  }
}

/** Builds the Discord authorize URL and stashes `state` + verifier for the
 * return trip. The caller navigates to the result. */
export async function beginSignIn(clientId: string = DISCORD_CLIENT_ID, redirect: string = redirectUri()): Promise<string> {
  const state = randomToken();
  const verifier = randomToken();
  savePending({ state, verifier });
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'identify',
    redirect_uri: redirect,
    state,
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${params}`;
}

// ---- Callback --------------------------------------------------------------

export type CallbackParams =
  | { kind: 'none' }
  | { kind: 'code'; code: string; state: string }
  | { kind: 'error'; message: string };

/** Classifies `location.search` after the Discord redirect. Anything without a
 * `state` plus a `code` or `error` is not ours and is left alone. */
export function parseCallback(search: string): CallbackParams {
  const q = new URLSearchParams(search);
  const state = q.get('state');
  const code = q.get('code');
  const error = q.get('error');
  if (!state || (!code && !error)) return { kind: 'none' };
  if (error) {
    return {
      kind: 'error',
      message: error === 'access_denied' ? 'Discord sign-in was cancelled.' : `Discord sign-in failed: ${q.get('error_description') ?? error}`,
    };
  }
  return { kind: 'code', code: code!, state };
}

/**
 * Finishes sign-in: verifies `state`, trades the code for a bot session and
 * stores it. Throws `DiscordAuthError` with a user-presentable message.
 */
export async function completeSignIn(
  search: string,
  opts: { fetchImpl?: FetchLike; redirect?: string; baseUrl?: string } = {},
): Promise<DiscordSession> {
  const parsed = parseCallback(search);
  const pending = takePending();
  if (parsed.kind === 'none') throw new DiscordAuthError('No Discord sign-in in progress.');
  if (parsed.kind === 'error') throw new DiscordAuthError(parsed.message);
  if (!pending || pending.state !== parsed.state) {
    throw new DiscordAuthError('Discord sign-in could not be verified (state mismatch). Please try again.');
  }

  const fetchImpl: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = (opts.baseUrl ?? REMINDER_API_BASE_URL).replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetchImpl(`${base}/v1/auth/discord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: parsed.code, redirectUri: opts.redirect ?? redirectUri(), codeVerifier: pending.verifier }),
    });
  } catch (e) {
    throw new DiscordAuthError(`Couldn't reach the reminder service: ${(e as Error).message}`);
  }
  if (!response.ok) {
    throw new DiscordAuthError(
      response.status === 429
        ? 'Too many sign-in attempts. Wait a minute and try again.'
        : response.status === 401
          ? 'Discord rejected the sign-in. Please try again.'
          : `Discord sign-in failed (${response.status}).`,
    );
  }
  const body = (await response.json().catch(() => null)) as Partial<DiscordSession> | null;
  const user = body?.user;
  if (typeof body?.token !== 'string' || !body.token || typeof body.expiresAt !== 'number' || typeof user?.id !== 'string') {
    throw new DiscordAuthError('The reminder service returned an unreadable sign-in response.');
  }
  const session: DiscordSession = {
    token: body.token,
    expiresAt: body.expiresAt,
    user: { id: user.id, username: String(user.username ?? ''), avatar: typeof user.avatar === 'string' ? user.avatar : null },
  };
  writeSession(session);
  return session;
}

// ---- Session ---------------------------------------------------------------

/** Fallback when localStorage is unavailable: signed in for this page's lifetime. */
let memorySession: DiscordSession | null = null;
/** True only when the last write to localStorage failed. */
let memoryOnly = false;

function writeSession(session: DiscordSession): void {
  memorySession = session;
  memoryOnly = false;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    memoryOnly = true;
    // storage unavailable — the in-memory copy keeps this page signed in
  }
}

export function clearSession(): void {
  memorySession = null;
  memoryOnly = false;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // nothing to clear
  }
}

/** The stored session, or null when absent, corrupt or expired (an expired
 * one is cleared so the UI drops to signed-out). */
export function getSession(now: number = Date.now()): DiscordSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return memoryOnly && memorySession && memorySession.expiresAt > now ? memorySession : null;
    const s = JSON.parse(raw) as Partial<DiscordSession> | null;
    if (typeof s?.token !== 'string' || !s.token || typeof s.expiresAt !== 'number' || typeof s.user?.id !== 'string') {
      clearSession();
      return null;
    }
    if (s.expiresAt <= now) {
      clearSession();
      return null;
    }
    return s as DiscordSession;
  } catch {
    return memorySession && memorySession.expiresAt > now ? memorySession : null;
  }
}

export function getSessionToken(now?: number): string | null {
  return getSession(now)?.token ?? null;
}

/** Revokes the token server-side (best effort — an unreachable bot must not
 * trap the user signed in), then always clears the local session. */
export async function signOut(opts: { fetchImpl?: FetchLike; baseUrl?: string } = {}): Promise<void> {
  const token = getSessionToken();
  try {
    if (token) {
      await createReminderApi({
        baseUrl: opts.baseUrl ?? REMINDER_API_BASE_URL,
        getToken: () => token,
        fetchImpl: opts.fetchImpl,
      }).logout();
    }
  } catch (e) {
    if (!(e instanceof ReminderApiError)) throw e;
  } finally {
    clearSession();
  }
}
