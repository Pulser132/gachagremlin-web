/**
 * Persistent offline write queue and pull cursor for reminder sync.
 *
 * Every local toggle is also enqueued here (one entry per eventKey, newest
 * `updatedAt` wins). `flushQueue` sends the queue through `/sync` and adopts
 * the winning record the server returns for each key, so a write that lost
 * converges instead of lingering. `pullReminders` fetches changes since the
 * stored per-game `serverTime` cursor. All storage access is try/catch-guarded
 * like src/data/reminders.ts.
 */
import type { GameKey } from '../types.ts';
import { listReminderRecords, mergeReminderRecords, setReminderRecords, type ReminderRecord } from './reminders.ts';
import { ReminderApiError, SYNC_BATCH_SIZE, type ApiReminder, type ReminderApi, type ReminderList, type ReminderWrite } from './reminderApi.ts';

const QUEUE_KEY = 'gachagremlin:reminderQueue';
const CURSOR_PREFIX = 'gachagremlin:reminderCursor:';

function gameOf(eventKey: string): GameKey {
  return eventKey.slice(0, eventKey.indexOf(':')) as GameKey;
}

function isWrite(v: unknown): v is ReminderWrite {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.eventKey === 'string' &&
    typeof r.updatedAt === 'number' &&
    Number.isFinite(r.updatedAt) &&
    typeof r.deleted === 'boolean' &&
    (r.offsets === undefined || (Array.isArray(r.offsets) && r.offsets.every((n) => typeof n === 'number')))
  );
}

export function listQueue(): ReminderWrite[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isWrite) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: ReminderWrite[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // storage full or unavailable — the write is still applied locally
  }
}

/** Queues a write. A newer queued write for the same key replaces an older one
 * (the older can never win); on a tie the tombstone wins, as on the server. */
export function enqueueReminder(write: ReminderWrite): void {
  const queue = listQueue();
  const i = queue.findIndex((q) => q.eventKey === write.eventKey);
  if (i < 0) queue.push(write);
  else if (mergeReminderRecords(queue[i], write) !== queue[i]) queue[i] = write;
  writeQueue(queue);
}

export function getCursor(game: GameKey): number | undefined {
  try {
    const raw = localStorage.getItem(`${CURSOR_PREFIX}${game}`);
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

function setCursor(game: GameKey, serverTime: number): void {
  try {
    localStorage.setItem(`${CURSOR_PREFIX}${game}`, String(serverTime));
  } catch {
    // worst case the next pull refetches without `since`
  }
}

/** Merges server records into local storage, per game, by the shared merge rule. */
function adopt(items: ApiReminder[]): void {
  const byGame = new Map<GameKey, ApiReminder[]>();
  for (const it of items) {
    const game = gameOf(it.eventKey);
    byGame.set(game, [...(byGame.get(game) ?? []), it]);
  }
  for (const [game, incoming] of byGame) {
    const byKey = new Map(listReminderRecords(game).map((r) => [r.eventKey, r]));
    for (const it of incoming) {
      const rec: ReminderRecord = { eventKey: it.eventKey, updatedAt: it.updatedAt, deleted: it.deleted };
      const prev = byKey.get(it.eventKey);
      byKey.set(it.eventKey, prev ? mergeReminderRecords(prev, rec) : rec);
    }
    setReminderRecords(game, [...byKey.values()]);
  }
}

/** Fetches changes for a game since the stored cursor and adopts them. A
 * `resync_required` response refetches without `since`. */
export async function pullReminders(api: ReminderApi, game: GameKey): Promise<void> {
  const since = getCursor(game);
  let res: ReminderList;
  try {
    res = await api.list({ game, since });
  } catch (e) {
    if (since !== undefined && e instanceof ReminderApiError && e.kind === 'resync_required') {
      res = await api.list({ game });
    } else throw e;
  }
  adopt(res.items);
  setCursor(game, res.serverTime);
}

export interface FlushResult {
  /** Live writes the server refused with `limit_exceeded`; dropped from the queue. */
  rejected: string[];
}

/** Removes sent entries unless they were superseded while the request was in flight. */
function dequeue(sent: ReminderWrite[]): void {
  const stamps = new Map(sent.map((s) => [s.eventKey, s.updatedAt]));
  writeQueue(listQueue().filter((q) => stamps.get(q.eventKey) !== q.updatedAt));
}

/**
 * Sends the queue through `/sync` and adopts the winning records. Batches are
 * sent (and removed from the queue) one at a time, so a failure part-way keeps
 * the unsent remainder. Errors (network, 401, …) propagate with the queue
 * intact. On `limit_exceeded` the batch's live writes are dropped and its
 * tombstones retried, so a full account cannot wedge deletions behind it.
 */
export async function flushQueue(api: ReminderApi): Promise<FlushResult> {
  const rejected: string[] = [];
  const queue = listQueue();
  for (let i = 0; i < queue.length; i += SYNC_BATCH_SIZE) {
    const batch = queue.slice(i, i + SYNC_BATCH_SIZE);
    let sent = batch;
    let items: ApiReminder[];
    try {
      items = (await api.sync(batch)).items;
    } catch (e) {
      if (!(e instanceof ReminderApiError) || e.kind !== 'limit_exceeded') throw e;
      const live = batch.filter((w) => !w.deleted);
      rejected.push(...live.map((w) => w.eventKey));
      sent = batch.filter((w) => w.deleted);
      items = sent.length ? (await api.sync(sent)).items : [];
      dequeue(live);
    }
    adopt(items);
    dequeue(sent);
  }
  return { rejected };
}

/** Calls `flush` whenever the browser comes back online or the tab regains
 * focus. Returns an unsubscribe function. */
export function attachFlushTriggers(target: Window, flush: () => void): () => void {
  target.addEventListener('online', flush);
  target.addEventListener('focus', flush);
  return () => {
    target.removeEventListener('online', flush);
    target.removeEventListener('focus', flush);
  };
}
