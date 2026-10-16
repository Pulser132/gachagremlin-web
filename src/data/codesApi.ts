/**
 * Client for the public redemption-code endpoint hosted by the GachaGremlin bot.
 * Contract: https://github.com/Pulser132/GachaGremlin/blob/f22f2f8/docs/api/codes.md
 *
 * `GET /v1/codes` needs no token and no credentials. `fetchImpl` is injected so
 * tests pass a stub. Only the fields the site uses are kept; the contract
 * promises additive changes inside `/v1`, so unknown fields are dropped.
 */
import type { GameKey } from '../types.ts';
import type { FetchLike } from './cloud/drive.ts';
import { REMINDER_API_BASE_URL } from './reminderApi.ts';

export interface CodeReward {
  item: string;
  qty: number;
}

export interface CodeItem {
  game: GameKey;
  code: string;
  status: 'active' | 'expired';
  rewards: CodeReward[];
  premium: boolean;
  claimUrl: string;
  /** Unix ms. */
  firstSeenAt: number;
  /** Unix ms; `null` while Active. */
  expiredAt: number | null;
}

export interface CodesResult {
  items: CodeItem[];
  /** Unix ms of the bot's last healthy check; `null` before the first one. */
  lastCheckedAt: number | null;
}

export type CodesApiErrorKind = 'rate-limited' | 'network' | 'other';

export class CodesApiError extends Error {
  readonly kind: CodesApiErrorKind;
  readonly status?: number;
  constructor(kind: CodesApiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'CodesApiError';
    this.kind = kind;
    this.status = status;
  }
}

export interface CodesApiOptions {
  /** Defaults to the same origin as the reminder API. */
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function parseCodeItem(raw: unknown): CodeItem {
  if (!isObject(raw) || typeof raw.code !== 'string' || typeof raw.game !== 'string' || typeof raw.firstSeenAt !== 'number') {
    throw new CodesApiError('other', 'Codes service returned an item that does not match the contract');
  }
  const rewards = Array.isArray(raw.rewards)
    ? raw.rewards.filter(isObject).map((r) => ({ item: String(r.item), qty: Number(r.qty) }))
    : [];
  return {
    game: raw.game as GameKey,
    code: raw.code,
    status: raw.status === 'expired' ? 'expired' : 'active',
    rewards,
    premium: raw.premium === true,
    claimUrl: typeof raw.claimUrl === 'string' ? raw.claimUrl : '',
    firstSeenAt: raw.firstSeenAt,
    expiredAt: typeof raw.expiredAt === 'number' ? raw.expiredAt : null,
  };
}

export interface CodesFetched extends CodesResult {
  /** The response's `ETag`, to send back as `If-None-Match`; `null` when absent or not exposed. */
  etag: string | null;
}

/**
 * Conditional GET. With an `etag`, sends `If-None-Match`; a `304` resolves to
 * `{ notModified: true }` so the caller keeps the list it already has.
 */
export async function fetchCodesConditional(
  game: GameKey,
  etag: string | null,
  opts: CodesApiOptions = {},
): Promise<CodesFetched | { notModified: true }> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = (opts.baseUrl ?? REMINDER_API_BASE_URL).replace(/\/+$/, '');
  const url = `${base}/v1/codes?game=${encodeURIComponent(game)}`;
  let response: Response;
  try {
    response = await (etag ? fetchImpl(url, { headers: { 'If-None-Match': etag } }) : fetchImpl(url));
  } catch (e) {
    throw new CodesApiError('network', `Could not reach the codes service: ${(e as Error).message}`);
  }
  if (response.status === 304) return { notModified: true };
  if (!response.ok) {
    throw new CodesApiError(
      response.status === 429 ? 'rate-limited' : 'other',
      `Codes request failed (${response.status})`,
      response.status,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (e) {
    throw new CodesApiError('other', `Codes service returned an unreadable response: ${(e as Error).message}`);
  }
  if (!isObject(body) || !Array.isArray(body.items)) {
    throw new CodesApiError('other', 'Codes service returned a response that does not match the contract');
  }
  return {
    items: body.items.map(parseCodeItem),
    lastCheckedAt: typeof body.lastCheckedAt === 'number' ? body.lastCheckedAt : null,
    etag: response.headers?.get('ETag') ?? null,
  };
}

export async function fetchCodes(game: GameKey, opts: CodesApiOptions = {}): Promise<CodesResult> {
  const out = await fetchCodesConditional(game, null, opts);
  if ('notModified' in out) throw new CodesApiError('other', 'Codes service returned 304 to an unconditional request', 304);
  return { items: out.items, lastCheckedAt: out.lastCheckedAt };
}

/** Active items only, newest `firstSeenAt` first. */
export function liveCodes(items: CodeItem[]): CodeItem[] {
  return items.filter((c) => c.status === 'active').sort((a, b) => b.firstSeenAt - a.firstSeenAt);
}
