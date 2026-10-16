import type { CodeDmsState } from '../data/codeDms.ts';
import { GAME_CONFIGS } from '../data/wiki/games.ts';
import type { GameKey } from '../types.ts';

function message(error: NonNullable<CodeDmsState['error']>): string {
  if (error.op === 'read' && error.kind !== 'unauthorized') return "Couldn't load your DM setting — try again later.";
  switch (error.kind) {
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

/** The per-game Code DM checkbox for the given state; `onToggle` gets the wanted value. */
export function renderCodeDmToggle(game: GameKey, state: CodeDmsState, onToggle: (on: boolean) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'codes-dm';
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = state.dms?.[game] ?? false;
  box.disabled = state.busy || state.dms === null;
  box.addEventListener('change', () => onToggle(box.checked));
  const text = document.createElement('span');
  text.textContent = `DM me new ${GAME_CONFIGS[game].label} codes`;
  label.append(box, text);
  const note = document.createElement('p');
  note.className = 'codes-dm-note';
  note.setAttribute('role', 'status');
  if (state.error) {
    note.classList.add('error');
    note.textContent = message(state.error);
  }
  wrap.append(label, note);
  return wrap;
}
