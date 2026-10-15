/**
 * Orchestrates two-way reminder sync with the bot API.
 *
 * Local toggles and backup restores are enqueued (only while signed in) and
 * flushed through `/sync`; each run then pulls every game since its cursor, so
 * bells reflect the server — including removals made by the bot (tombstones).
 * Runs on load, on focus/online, and after each local change. Signed out, this
 * does nothing and reminders stay local-only.
 *
 * First sign-in on a browser: every live local reminder is queued with
 * `updatedAt` = now so nothing local is lost, then the server's state is
 * adopted by the same flush + pull. Local tombstones from before that are
 * deliberately not sent (their stamps could delete a newer bell made
 * elsewhere). The "merged" marker records which user the local reminders
 * belong to; it survives sign-out and token expiry, so changes made while
 * signed out keep queueing and are flushed, with their true stamps, when the
 * same user signs back in. A *different* user signing in wipes the previous
 * user's local reminders first, so one account's bells never leak into another.
 */
import type { GameKey } from '../types.ts';
import { GAME_KEYS } from './wiki/games.ts';
import { ReminderApiError, type ReminderApi } from './reminderApi.ts';
import { enqueueReminder, flushQueue, listQueue, pullReminders, resetSyncState } from './reminderQueue.ts';
import { listReminderRecords, onReminderChange, setReminderRecords } from './reminders.ts';

const MERGED_KEY = 'gachagremlin:reminderSync:merged';

export type ReminderSyncStatus = 'signed-out' | 'syncing' | 'synced' | 'offline' | 'error';

export interface ReminderSyncState {
  status: ReminderSyncStatus;
  /** Local writes not yet accepted by the server. */
  pending: number;
  error: string | null;
}

export interface ReminderSyncDeps {
  /** The signed-in user's ID, or null when signed out. */
  getUserId: () => string | null;
  api: ReminderApi;
  /** Called after a sync changed local reminders, so the view can re-render. */
  onMerged?: () => void;
  now?: () => number;
}

export interface ReminderSync {
  getState(): ReminderSyncState;
  subscribe(cb: (state: ReminderSyncState) => void): () => void;
  /** Requests a sync; coalesces with one already running. Never rejects. */
  request(): Promise<void>;
  /** Marks the state signed-out after an explicit sign-out. */
  handleSignedOut(): void;
  /** Listens for local changes and for focus/online. Returns a detach function. */
  attach(target: Window): () => void;
}

function readMarker(): string | null {
  try {
    return localStorage.getItem(MERGED_KEY);
  } catch {
    return null;
  }
}

function writeMarker(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(MERGED_KEY, userId);
    else localStorage.removeItem(MERGED_KEY);
  } catch {
    // worst case the next load merges again, which is harmless
  }
}

function snapshot(): string {
  return JSON.stringify(GAME_KEYS.map((g) => listReminderRecords(g)));
}

export function createReminderSync(deps: ReminderSyncDeps): ReminderSync {
  const now = deps.now ?? Date.now;
  const listeners = new Set<(s: ReminderSyncState) => void>();
  let state: ReminderSyncState = { status: 'signed-out', pending: 0, error: null };
  let running: Promise<void> | null = null;
  let again = false;

  function set(next: Partial<ReminderSyncState> & { status: ReminderSyncStatus }): void {
    state = { pending: listQueue().length, error: null, ...next };
    for (const cb of listeners) cb(state);
  }

  function enqueueLiveLocal(): void {
    const stamp = now();
    for (const game of GAME_KEYS) {
      for (const r of listReminderRecords(game)) {
        if (!r.deleted) enqueueReminder({ eventKey: r.eventKey, updatedAt: stamp, deleted: false });
      }
    }
  }

  /** Returns how many live writes the server refused (cap reached). */
  async function runOnce(): Promise<number> {
    let refused = 0;
    const userId = deps.getUserId();
    if (!userId) {
      set({ status: 'signed-out', pending: 0 });
      return 0;
    }
    set({ status: 'syncing' });
    const before = snapshot();
    try {
      const marker = readMarker();
      if (marker !== userId) {
        resetSyncState(GAME_KEYS);
        if (marker) {
          // Another account's bells: drop them; this user's come from the server.
          for (const game of GAME_KEYS) setReminderRecords(game, []);
        } else {
          enqueueLiveLocal();
        }
        writeMarker(userId);
      }
      const { rejected } = await flushQueue(deps.api);
      await Promise.all(GAME_KEYS.map((game) => pullReminders(deps.api, game)));
      if (deps.getUserId() !== userId) {
        // Signed out (or switched) while requests were in flight.
        set({ status: 'signed-out', pending: 0 });
        return 0;
      }
      refused = rejected.length;
      set({ status: 'synced' });
    } catch (e) {
      if (e instanceof ReminderApiError && e.kind === 'unauthorized') {
        set({ status: 'signed-out', pending: 0 });
      } else if (e instanceof ReminderApiError && e.kind === 'network') {
        set({ status: 'offline' });
      } else {
        set({ status: 'error', error: (e as Error).message });
      }
    }
    if (snapshot() !== before) deps.onMerged?.();
    return refused;
  }

  function request(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        let refused = 0;
        do {
          again = false;
          refused += await runOnce();
        } while (again);
        // A rerun would otherwise paper over the refusal with "synced".
        if (refused > 0 && (state.status === 'synced' || state.status === 'offline')) {
          set({ status: 'error', error: `${refused} reminder(s) not saved: the 500-reminder limit was reached.` });
        }
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    request,
    handleSignedOut() {
      set({ status: 'signed-out', pending: 0 });
    },
    attach(target) {
      const offChange = onReminderChange((_game: GameKey, records) => {
        // Keep queueing while signed out once this browser has merged for a user.
        if (!deps.getUserId() && !readMarker()) return;
        for (const r of records) enqueueReminder({ eventKey: r.eventKey, updatedAt: r.updatedAt, deleted: r.deleted });
        void request();
      });
      const trigger = () => void request();
      target.addEventListener('focus', trigger);
      target.addEventListener('online', trigger);
      return () => {
        offChange();
        target.removeEventListener('focus', trigger);
        target.removeEventListener('online', trigger);
      };
    },
  };
}
