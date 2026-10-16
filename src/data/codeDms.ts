/**
 * Code DM opt-in state for the signed-in user: the one place that talks to
 * `GET`/`PUT /v1/me/code-dms`. The server is the source of truth, so `dms`
 * only ever holds what the server last returned; a failed write leaves it
 * untouched and is reported in `error`. Nothing is queued or retried.
 * Contract: https://github.com/Pulser132/GachaGremlin/blob/main/docs/api/codes.md
 */
import { ReminderApiError, type CodeDmState, type ReminderApi, type ReminderApiErrorKind } from './reminderApi.ts';
import type { GameKey } from '../types.ts';

export interface CodeDmsState {
  /** The server's last answer; `null` until the first read succeeds. */
  dms: CodeDmState | null;
  /** A read or write is in flight. */
  busy: boolean;
  /** Why the last read or write failed; cleared when the next one starts. */
  error: { op: 'read' | 'write'; kind: ReminderApiErrorKind } | null;
}

export interface CodeDmsController {
  getState(): CodeDmsState;
  /** Re-reads the server state; a no-op while something is already in flight. */
  load(): Promise<void>;
  /** Sets one game; a no-op while something is already in flight. */
  set(game: GameKey, on: boolean): Promise<void>;
  /** Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
}

export function createCodeDms(api: Pick<ReminderApi, 'codeDms' | 'setCodeDms'>): CodeDmsController {
  let state: CodeDmsState = { dms: null, busy: false, error: null };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<CodeDmsState>) => {
    state = { ...state, ...patch };
    for (const fn of [...listeners]) fn();
  };
  const kindOf = (e: unknown): ReminderApiErrorKind => (e instanceof ReminderApiError ? e.kind : 'other');

  async function run(op: 'read' | 'write', call: () => Promise<CodeDmState>): Promise<void> {
    if (state.busy) return;
    update({ busy: true, error: null });
    try {
      update({ dms: await call(), busy: false });
    } catch (e) {
      update({ busy: false, error: { op, kind: kindOf(e) } });
    }
  }

  return {
    getState: () => state,
    load: () => run('read', () => api.codeDms()),
    set: (game, on) => run('write', () => api.setCodeDms({ [game]: on })),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
