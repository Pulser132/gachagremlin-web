/**
 * Best-effort "the bot may not be able to DM you" hint, from `GET /v1/me`.
 * `deliverable: false` means the bot probably shares no server with the user.
 * It is a hint, never an error: a failed read shows nothing, and dismissal is
 * remembered per user so it doesn't nag.
 * Contract: https://github.com/Pulser132/GachaGremlin/blob/bbfdbcc/docs/api/reminders.md
 */
import type { ReminderApi } from './reminderApi.ts';

const DISMISSED_KEY = 'gachagremlin:reminders:deliverable-hint-dismissed';

export interface DeliverableHint {
  /** Whether the hint should be showing right now. */
  visible(): boolean;
  /** Re-reads `/v1/me`. Never rejects. */
  check(): Promise<void>;
  dismiss(): void;
  /** Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
}

function dismissedFor(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function createDeliverableHint(api: Pick<ReminderApi, 'me'>, getUserId: () => string | null): DeliverableHint {
  let undeliverable = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of [...listeners]) fn();
  };
  const visible = () => {
    const user = getUserId();
    return undeliverable && user !== null && dismissedFor() !== user;
  };
  return {
    visible,
    async check() {
      let next = false;
      try {
        next = (await api.me()).deliverable === false;
      } catch {
        // best-effort: no answer, no hint
      }
      undeliverable = next;
      notify();
    },
    dismiss() {
      const user = getUserId();
      if (user) {
        try {
          localStorage.setItem(DISMISSED_KEY, user);
        } catch {
          // stays dismissed until reload
        }
      }
      undeliverable = false;
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}
