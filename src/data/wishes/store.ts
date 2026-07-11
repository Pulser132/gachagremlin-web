/**
 * localStorage persistence for imported wish/warp/signal history.
 *
 * One entry per (game, uid): `gachagremlin:wishes:<game>:<uid>` holds a
 * WishAccount. A second key, `gachagremlin:wishes:<game>:activeUid`, names
 * the uid the UI currently shows — v1 supports one visible account per game
 * (see plan decision 9); switching accounts is a stretch goal.
 */
import { dedupeCrossSource } from './dedupe.ts';
import type { GameKey, WishAccount, WishItem, WishPayload } from '../../types.ts';

const STORAGE_PREFIX = 'gachagremlin:wishes:';

function accountKey(game: GameKey, uid: string): string {
  return `${STORAGE_PREFIX}${game}:${uid}`;
}

function activeUidKey(game: GameKey): string {
  return `${STORAGE_PREFIX}${game}:activeUid`;
}

function readAccount(game: GameKey, uid: string): WishAccount | null {
  try {
    const raw = localStorage.getItem(accountKey(game, uid));
    if (!raw) return null;
    const account = JSON.parse(raw) as WishAccount;

    // Repair-on-read: accounts stored before dedupe.ts existed can hold
    // the same pull twice under two id schemes (backup import + script
    // import). Collapse those and persist the repaired list, so existing
    // users are fixed on next load without re-importing anything.
    const repaired = dedupeCrossSource(account.items);
    if (repaired.length !== account.items.length) {
      const fixed = { ...account, items: repaired };
      writeAccount(game, fixed);
      return fixed;
    }
    return account;
  } catch {
    return null; // corrupt entry or storage unavailable — treat as no account
  }
}

function writeAccount(game: GameKey, account: WishAccount): void {
  try {
    localStorage.setItem(accountKey(game, account.uid), JSON.stringify(account));
  } catch {
    // localStorage full or unavailable — the import still works for this
    // session, it just won't persist across reloads.
  }
}

function readActiveUid(game: GameKey): string | null {
  try {
    return localStorage.getItem(activeUidKey(game));
  } catch {
    return null;
  }
}

function writeActiveUid(game: GameKey, uid: string): void {
  try {
    localStorage.setItem(activeUidKey(game), uid);
  } catch {
    // see writeAccount
  }
}

/**
 * Compares gacha log ids, which are numeric strings too large for `Number`
 * (loses precision past 2^53). Longer string always wins; equal-length
 * strings sort lexicographically, which agrees with numeric order because
 * every digit position carries equal weight.
 */
export function compareIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Union by id, ascending, then collapse cross-source duplicates (the same
 * physical pull imported once via a backup file with a synthetic id and
 * once via the PowerShell script with its real API id — see dedupe.ts).
 * Never drops a genuinely distinct pull: an incoming payload can only ever
 * add pulls, not remove aged-out ones. */
export function mergeItems(existing: WishItem[], incoming: WishItem[]): WishItem[] {
  const byId = new Map<string, WishItem>();
  for (const item of existing) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  return dedupeCrossSource([...byId.values()].sort((a, b) => compareIds(a.id, b.id)));
}

export function loadAccount(game: GameKey, uid: string): WishAccount | null {
  return readAccount(game, uid);
}

export function getActiveAccount(game: GameKey): WishAccount | null {
  const uid = readActiveUid(game);
  if (!uid) return null;
  return readAccount(game, uid);
}

export function setActiveUid(game: GameKey, uid: string): void {
  writeActiveUid(game, uid);
}

/**
 * Merges a freshly-validated payload into any existing account for its uid,
 * persists the result, marks it active, and returns the merged account.
 * @param now injectable for tests; defaults to the real wall clock.
 */
export function importPayload(payload: WishPayload, now: () => number = Date.now): WishAccount {
  const existing = readAccount(payload.game, payload.uid);
  const merged: WishAccount = {
    uid: payload.uid,
    region: payload.region,
    items: mergeItems(existing?.items ?? [], payload.items),
    updatedAt: now(),
  };
  writeAccount(payload.game, merged);
  writeActiveUid(payload.game, payload.uid);
  return merged;
}

/**
 * Imports every payload (e.g. all accounts found in one multi-uid UIGF
 * file) and returns the merged accounts in the same order. The last
 * payload's uid ends up active, matching importPayload's single-payload
 * behavior.
 */
export function importPayloads(payloads: WishPayload[], now: () => number = Date.now): WishAccount[] {
  return payloads.map((payload) => importPayload(payload, now));
}
