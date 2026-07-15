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

/** The `activeUid` pointer is stored under the same `<game>:` namespace as the
 * accounts, so account enumeration must skip this reserved suffix. */
const ACTIVE_UID_SUFFIX = 'activeUid';

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

export function getActiveUid(game: GameKey): string | null {
  return readActiveUid(game);
}

export function setActiveUid(game: GameKey, uid: string): void {
  writeActiveUid(game, uid);
}

/**
 * Lists every stored account for `game` (uid + optional nickname), so the UI
 * can offer a switcher. Scans localStorage keys under the game's namespace,
 * skipping the reserved `:activeUid` pointer. Ordered by uid for a stable
 * dropdown; corrupt entries are ignored.
 */
export function listAccounts(game: GameKey): { uid: string; nickname?: string }[] {
  const prefix = `${STORAGE_PREFIX}${game}:`;
  const accounts: { uid: string; nickname?: string }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const suffix = key.slice(prefix.length);
      // A uid never contains ':', so a suffix with one is some other key
      // (the activeUid pointer, or a future sub-key) — skip it.
      if (suffix === ACTIVE_UID_SUFFIX || suffix.includes(':')) continue;
      const account = readAccount(game, suffix);
      if (account) accounts.push({ uid: account.uid, nickname: account.nickname });
    }
  } catch {
    // storage unavailable — behave as if no accounts are stored
  }
  return accounts.sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
}

/**
 * Sets (or clears, when `nickname` is empty) the label for one account.
 *
 * Stamps `nicknameUpdatedAt` so a later merge can tell which side renamed most
 * recently (see restoreAccount). Note it deliberately does NOT touch
 * `updatedAt`: that field means "last imported pulls" and is rendered to the
 * user as "imported <date>", so bumping it here would claim a re-import that
 * never happened.
 * @param now injectable for tests; defaults to the real wall clock.
 */
export function setNickname(game: GameKey, uid: string, nickname: string, now: () => number = Date.now): void {
  const account = readAccount(game, uid);
  if (!account) return;
  const trimmed = nickname.trim();
  writeAccount(game, { ...account, nickname: trimmed || undefined, nicknameUpdatedAt: now() });
}

/**
 * Deletes one account's stored history. If it was the active account, the
 * pointer is moved to another remaining account (or removed when none are
 * left) so the UI never points at a deleted uid.
 */
export function deleteAccount(game: GameKey, uid: string): void {
  try {
    localStorage.removeItem(accountKey(game, uid));
  } catch {
    // storage unavailable — nothing persisted to remove
  }
  if (readActiveUid(game) !== uid) return;
  const remaining = listAccounts(game);
  try {
    if (remaining.length > 0) {
      writeActiveUid(game, remaining[0].uid);
    } else {
      localStorage.removeItem(activeUidKey(game));
    }
  } catch {
    // see writeAccount
  }
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
    nickname: existing?.nickname, // re-import must not wipe a user-set label
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

/**
 * Picks the surviving nickname when merging two copies of one account.
 *
 * Renames need to propagate across devices under cloud sync, so when both
 * sides carry a `nicknameUpdatedAt` the newer rename wins. Without that
 * timestamp there's nothing to compare, so we keep the pre-existing
 * local-wins behavior — which also means a rename made before this field
 * existed is never clobbered by a stale backup.
 */
function resolveNickname(existing: WishAccount | null, incoming: WishAccount): Pick<WishAccount, 'nickname' | 'nicknameUpdatedAt'> {
  if (!existing) return { nickname: incoming.nickname, nicknameUpdatedAt: incoming.nicknameUpdatedAt };

  const existingAt = existing.nicknameUpdatedAt;
  const incomingAt = incoming.nicknameUpdatedAt;
  if (existingAt !== undefined && incomingAt !== undefined) {
    const winner = incomingAt > existingAt ? incoming : existing;
    return { nickname: winner.nickname, nicknameUpdatedAt: winner.nicknameUpdatedAt };
  }

  // Only one side (or neither) has been renamed since timestamps existed.
  // Keep the local label if there is one, else adopt the incoming one — the
  // original behavior, so a manual restore is unchanged.
  if (existing.nickname !== undefined) {
    return { nickname: existing.nickname, nicknameUpdatedAt: existingAt };
  }
  return { nickname: incoming.nickname, nicknameUpdatedAt: incomingAt };
}

/**
 * Merges a whole account from a backup file into local storage, unioning its
 * pulls with any already stored for that uid (same dedupe as import, so a
 * restore can never drop or duplicate pulls). Unlike importPayload it does
 * NOT move the active pointer — the backup's own activeUid is restored
 * separately. Nickname resolution: see resolveNickname.
 */
export function restoreAccount(game: GameKey, account: WishAccount): WishAccount {
  const existing = readAccount(game, account.uid);
  const merged: WishAccount = {
    uid: account.uid,
    region: account.region || existing?.region || '',
    items: mergeItems(existing?.items ?? [], account.items ?? []),
    updatedAt: Math.max(existing?.updatedAt ?? 0, account.updatedAt ?? 0),
    ...resolveNickname(existing, account),
  };
  writeAccount(game, merged);
  return merged;
}
