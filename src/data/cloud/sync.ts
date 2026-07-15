/**
 * Cloud sync orchestration: pull → merge → push.
 *
 * The whole design rests on `importBackup` being merge-based (unions pulls and
 * reminders, dedupes by id), so a sync can't destroy data and needs no conflict
 * resolution for the additive case:
 *
 *   1. download the cloud backup (if any)
 *   2. importBackup(it) — merges into localStorage
 *   3. exportAll()      — the now-superset local state
 *   4. upload it
 *
 * Two devices can race on step 4, but each merged the other's data first, so
 * losing the race only delays the union to the next sync.
 *
 * **Push-only** is the exception. After a destructive local op (deleting an
 * account, un-belling a reminder) a merge would just resurrect what was
 * removed, so the pull is skipped and the cloud copy is overwritten. Bounded
 * limitation: the delete only sticks if no *other* device still holds that
 * account — one that does will re-add it on its next merge. Real propagation
 * needs tombstones (see goal.md stretch).
 *
 * OPAQUE PAYLOAD CONTRACT: this module never reads or builds payload fields.
 * It only calls exportAll() / importBackup(). Adding a new data type to cloud
 * sync therefore means extending backup.ts alone — nothing here changes.
 */
import { exportAll, importBackup, UnsupportedBackupVersionError } from '../backup.ts';
import { isCloudConfigured } from './config.ts';
import { CloudError, loadCloudBackup, saveCloudBackup, type FetchLike } from './drive.ts';

export type SyncMode = 'merge' | 'push-only';
export type SyncStatus = 'idle' | 'syncing' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  /** User-facing message when status is 'error'. */
  error: string | null;
  /** True when the failure was auth — the UI offers Reconnect rather than retry. */
  needsReconnect: boolean;
}

const LAST_SYNCED_KEY = 'gachagremlin:cloud:lastSyncedAt';

/** Auto-sync triggers fire per user action (bell, rename, import); this
 * collapses a burst into one round-trip. Trailing edge: wait for the user to
 * stop, then sync once. */
const DEBOUNCE_MS = 3000;

export interface SyncDeps {
  getToken: (opts?: { forceRefresh?: boolean }) => Promise<string>;
  isConnected: () => boolean;
  fetchImpl?: FetchLike;
  now?: () => number;
}

let deps: SyncDeps | null = null;
let status: SyncStatus = 'idle';
let error: string | null = null;
let needsReconnect = false;
let inFlight: Promise<void> | null = null;
let queued: SyncMode | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingMode: SyncMode | null = null;
const listeners = new Set<(state: SyncState) => void>();

/** Wires the auth implementation in. Kept as injection rather than a direct
 * import so sync.ts stays testable without the GIS script, and so auth can
 * load lazily. */
export function configureSync(next: SyncDeps): void {
  deps = next;
}

function readLastSyncedAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SYNCED_KEY);
    return raw ? Number(raw) || null : null;
  } catch {
    return null;
  }
}

function writeLastSyncedAt(value: number): void {
  try {
    localStorage.setItem(LAST_SYNCED_KEY, String(value));
  } catch {
    // storage unavailable — the indicator just won't survive a reload
  }
}

export function getSyncState(): SyncState {
  return { status, lastSyncedAt: readLastSyncedAt(), error, needsReconnect };
}

/** Subscribe to state changes (the footer is built once at mount, so it can't
 * rely on the app's render loop). Returns an unsubscribe fn. */
export function onSyncStateChange(listener: (state: SyncState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  const state = getSyncState();
  for (const listener of listeners) listener(state);
}

/** Called after a merge actually brought cloud data in, so the app can
 * re-render and show it. Set by the UI layer. */
let onMerged: (() => void) | null = null;
export function setOnMerged(callback: (() => void) | null): void {
  onMerged = callback;
}

function describe(e: unknown): { message: string; reconnect: boolean } {
  if (e instanceof UnsupportedBackupVersionError) {
    return { message: 'Your cloud data was saved by a newer version of GachaGremlin. Reload the page to update.', reconnect: false };
  }
  if (e instanceof CloudError) {
    switch (e.kind) {
      case 'unauthorized':
        return { message: 'Google sign-in expired. Reconnect to keep syncing.', reconnect: true };
      case 'rate-limited':
        return { message: 'Google Drive is rate-limiting requests. Try again in a few minutes.', reconnect: false };
      case 'network':
        return { message: "Couldn't reach Google Drive. Check your connection.", reconnect: false };
      default:
        return { message: e.message, reconnect: false };
    }
  }
  return { message: (e as Error)?.message ?? 'Cloud sync failed.', reconnect: false };
}

/** One sync round-trip. Assumes the caller has serialized access. */
async function runSync(mode: SyncMode, d: SyncDeps): Promise<void> {
  const fetchImpl = d.fetchImpl ?? fetch;
  const now = d.now ?? Date.now;
  let token = await d.getToken();

  // A token can expire between issue and use; retry once on 401 with a fresh
  // one before surfacing a reconnect prompt.
  const withRetry = async <T>(op: (t: string) => Promise<T>): Promise<T> => {
    try {
      return await op(token);
    } catch (e) {
      if (e instanceof CloudError && e.kind === 'unauthorized') {
        token = await d.getToken({ forceRefresh: true });
        return await op(token);
      }
      throw e;
    }
  };

  let knownFileId: string | undefined;
  let merged = false;

  if (mode === 'merge') {
    const hit = await withRetry((t) => loadCloudBackup(t, fetchImpl));
    if (hit) {
      knownFileId = hit.fileId;
      // Throws UnsupportedBackupVersionError for a newer-schema file. That
      // propagates out of runSync deliberately: aborting WITHOUT pushing is
      // the point — this build must never overwrite a newer build's file with
      // its own older-shaped payload.
      importBackup(hit.data, { viewState: 'fill-if-absent' });
      merged = true;
    }
  }

  await withRetry((t) => saveCloudBackup(t, exportAll(), knownFileId, fetchImpl));
  writeLastSyncedAt(now());
  if (merged) onMerged?.();
}

/**
 * Runs a sync now, serialized: while one is in flight, a request queues exactly
 * one follow-up (push-only wins over merge, so a delete can't be downgraded).
 */
export async function syncNow(mode: SyncMode = 'merge'): Promise<void> {
  if (!isCloudConfigured() || !deps || !deps.isConnected()) return;

  if (inFlight) {
    queued = queued === 'push-only' || mode === 'push-only' ? 'push-only' : 'merge';
    return inFlight;
  }

  const d = deps;
  status = 'syncing';
  error = null;
  needsReconnect = false;
  emit();

  inFlight = (async () => {
    try {
      await runSync(mode, d);
      status = 'idle';
      error = null;
      needsReconnect = false;
    } catch (e) {
      const described = describe(e);
      status = 'error';
      error = described.message;
      needsReconnect = described.reconnect;
    } finally {
      inFlight = null;
      emit();
    }

    const next = queued;
    queued = null;
    if (next) await syncNow(next);
  })();

  return inFlight;
}

/**
 * Debounced auto-sync. A destructive trigger upgrades a pending merge to
 * push-only, so a burst like "delete account, then bell an event" still skips
 * the pull that would resurrect the deleted account.
 */
export function scheduleSync(mode: SyncMode = 'merge'): void {
  if (!isCloudConfigured() || !deps || !deps.isConnected()) return;

  pendingMode = pendingMode === 'push-only' || mode === 'push-only' ? 'push-only' : 'merge';
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const next = pendingMode ?? 'merge';
    pendingMode = null;
    void syncNow(next);
  }, DEBOUNCE_MS);
}

/** Test seam: drops all module state between cases. */
export function resetSyncForTests(): void {
  deps = null;
  status = 'idle';
  error = null;
  needsReconnect = false;
  inFlight = null;
  queued = null;
  pendingMode = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  listeners.clear();
  onMerged = null;
}
