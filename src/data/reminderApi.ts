/**
 * Typed client for the reminder sync API hosted by the GachaGremlin bot.
 * Contract: https://github.com/Pulser132/GachaGremlin/blob/e5544c3/docs/api/reminders.md
 *
 * Mirrors the shape of src/data/cloud/drive.ts: `fetchImpl` is injected so
 * tests pass a stub, and every failure is a typed `ReminderApiError`. The
 * client holds no session state; the caller supplies the bearer token and is
 * told (via `onUnauthorized`) when it stops working, so it can drop to
 * signed-out behaviour.
 */
import type { GameKey } from '../types.ts';
import type { FetchLike } from './cloud/drive.ts';

export type { FetchLike };

/** Max items the server accepts per `/sync` call. */
export const SYNC_BATCH_SIZE = 200;

/** Build-time API origin (no trailing slash). Blank until the bot is exposed,
 * in which case `isReminderApiConfigured()` is false and callers stay local. */
export const REMINDER_API_BASE_URL: string = String(import.meta.env.VITE_REMINDER_API_URL ?? '').replace(/\/+$/, '');

export function isReminderApiConfigured(): boolean {
  return REMINDER_API_BASE_URL.length > 0;
}

export type ReminderApiErrorKind =
  /** `401`, or no token to send. */
  | 'unauthorized'
  /** `409 resync_required`: the `since` cursor is older than tombstone retention. */
  | 'resync_required'
  /** `422 limit_exceeded`: per-user cap of non-deleted reminders. */
  | 'limit_exceeded'
  | 'rate-limited'
  /** The request never completed (offline, DNS, blocked). */
  | 'network'
  | 'other';

export class ReminderApiError extends Error {
  readonly kind: ReminderApiErrorKind;
  readonly status?: number;
  /** The server's machine-readable `error` code, when the body had one. */
  readonly code?: string;
  constructor(kind: ReminderApiErrorKind, message: string, status?: number, code?: string) {
    super(message);
    this.name = 'ReminderApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** A reminder as the API returns it. `offsets` is always present in responses. */
export interface ApiReminder {
  eventKey: string;
  game: GameKey;
  offsets: number[];
  updatedAt: number;
  deleted: boolean;
}

/** A write. `offsets` is omitted unless set, so the server keeps the offsets
 * chosen with `/remind`. */
export interface ReminderWrite {
  eventKey: string;
  updatedAt: number;
  deleted: boolean;
  offsets?: number[];
}

export interface ReminderList {
  items: ApiReminder[];
  serverTime: number;
}

export interface MeResponse {
  id: string;
  deliverable: boolean;
}

export interface ReminderApi {
  me(): Promise<MeResponse>;
  logout(): Promise<void>;
  list(opts?: { game?: GameKey; since?: number }): Promise<ReminderList>;
  put(eventKey: string, body: { updatedAt: number; offsets?: number[] }): Promise<ApiReminder>;
  remove(eventKey: string, updatedAt: number): Promise<ApiReminder>;
  /** Chunks into batches of {@link SYNC_BATCH_SIZE}; `serverTime` is the last chunk's. */
  sync(items: ReminderWrite[]): Promise<ReminderList>;
}

export interface ReminderApiOptions {
  baseUrl: string;
  getToken: () => string | null;
  /** Called when the server rejects the token (or there is none). */
  onUnauthorized?: () => void;
  fetchImpl?: FetchLike;
}

interface ErrorBody {
  error?: string;
  message?: string;
}

async function errorFor(response: Response): Promise<ReminderApiError> {
  let body: ErrorBody | null = null;
  let raw = '';
  try {
    raw = await response.text();
    body = JSON.parse(raw) as ErrorBody;
  } catch {
    // non-JSON or unreadable body — the status still tells us something
  }
  const code = typeof body?.error === 'string' ? body.error : undefined;
  const detail = (typeof body?.message === 'string' ? body.message : raw).slice(0, 300);
  const message = `Reminder API request failed (${response.status})${detail ? `: ${detail}` : ''}`;
  const { status } = response;
  if (status === 401) return new ReminderApiError('unauthorized', message, status, code);
  if (status === 409 && code === 'resync_required') return new ReminderApiError('resync_required', message, status, code);
  if (status === 422 && code === 'limit_exceeded') return new ReminderApiError('limit_exceeded', message, status, code);
  if (status === 429) return new ReminderApiError('rate-limited', message, status, code);
  return new ReminderApiError('other', message, status, code);
}

export function createReminderApi(opts: ReminderApiOptions): ReminderApi {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const token = opts.getToken();
    if (!token) {
      opts.onUnauthorized?.();
      throw new ReminderApiError('unauthorized', 'Not signed in to the reminder service');
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, init);
    } catch (e) {
      throw new ReminderApiError('network', `Could not reach the reminder service: ${(e as Error).message}`);
    }
    if (!response.ok) {
      const err = await errorFor(response);
      if (err.kind === 'unauthorized') opts.onUnauthorized?.();
      throw err;
    }
    return response;
  }

  async function json<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch (e) {
      throw new ReminderApiError('other', `Reminder service returned an unreadable response: ${(e as Error).message}`);
    }
  }

  const keyPath = (eventKey: string) => `/v1/reminders/${encodeURIComponent(eventKey)}`;

  return {
    async me() {
      return json<MeResponse>(await call('GET', '/v1/me'));
    },
    async logout() {
      await call('POST', '/v1/auth/logout');
    },
    async list({ game, since } = {}) {
      const params = new URLSearchParams();
      if (game) params.set('game', game);
      if (since !== undefined) params.set('since', String(since));
      const qs = params.toString();
      return json<ReminderList>(await call('GET', `/v1/reminders${qs ? `?${qs}` : ''}`));
    },
    async put(eventKey, body) {
      return json<ApiReminder>(await call('PUT', keyPath(eventKey), body));
    },
    async remove(eventKey, updatedAt) {
      return json<ApiReminder>(await call('DELETE', keyPath(eventKey), { updatedAt }));
    },
    async sync(items) {
      const out: ApiReminder[] = [];
      let serverTime = 0;
      for (let i = 0; i < items.length; i += SYNC_BATCH_SIZE) {
        const chunk = items.slice(i, i + SYNC_BATCH_SIZE);
        const res = await json<ReminderList>(await call('POST', '/v1/reminders/sync', { items: chunk }));
        out.push(...res.items);
        serverTime = res.serverTime;
      }
      return { items: out, serverTime };
    },
  };
}
