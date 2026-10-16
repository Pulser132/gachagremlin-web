import { ReminderApiError, type CodeDmState, type ReminderApi } from '../data/reminderApi.ts';
import { GAME_CONFIGS } from '../data/wiki/games.ts';
import type { GameKey } from '../types.ts';

type CodeDmApi = Pick<ReminderApi, 'codeDms' | 'setCodeDms'>;

function failure(e: unknown, reading = false): string {
  if (reading && !(e instanceof ReminderApiError && e.kind === 'unauthorized')) return "Couldn't load your DM setting — try again later.";
  switch (e instanceof ReminderApiError ? e.kind : undefined) {
    case 'dms_closed':
      return "Discord won't let the bot message you — open your DMs and try again.";
    case 'unauthorized':
      return 'Your Discord session ended — sign in again.';
    case 'rate-limited':
      return 'Too many requests — try again in a moment.';
    case 'network':
      return "Couldn't reach the bot, so the change failed and nothing was saved. Try again when you're online.";
    default:
      return "Couldn't save — the change failed. Try again.";
  }
}

/**
 * Per-game Code DM opt-in for a signed-in user. The server is the source of
 * truth: the checkbox only changes to what `GET`/`PUT /v1/me/code-dms` returns,
 * a failed write leaves it as it was, and nothing is queued or retried.
 */
export function buildCodeDmToggle(game: GameKey, api: CodeDmApi): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'codes-dm';
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.disabled = true;
  const text = document.createElement('span');
  text.textContent = `DM me new ${GAME_CONFIGS[game].label} codes`;
  label.append(box, text);
  const note = document.createElement('p');
  note.className = 'codes-dm-note';
  note.setAttribute('role', 'status');
  wrap.append(label, note);

  const settle = (state: CodeDmState) => { box.checked = state[game]; box.disabled = false; };
  const fail = (e: unknown, revertTo: boolean, reading = false) => {
    box.checked = revertTo;
    note.classList.add('error');
    note.textContent = failure(e, reading);
  };

  api.codeDms().then(
    settle,
    (e) => fail(e, false, true),
  );

  box.addEventListener('change', () => {
    const want = box.checked;
    box.disabled = true;
    note.classList.remove('error');
    note.textContent = '';
    api.setCodeDms({ [game]: want }).then(
      settle,
      (e) => { fail(e, !want); box.disabled = false; },
    );
  });
  return wrap;
}
