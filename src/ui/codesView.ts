import { liveCodes, type CodesResult } from '../data/codesApi.ts';
import { GAME_CONFIGS } from '../data/wiki/games.ts';
import type { GameKey } from '../types.ts';

/** A plain list of the game's live Codes, newest first, plus when the bot last checked. */
export function renderCodesView(game: GameKey, data: CodesResult): HTMLElement {
  const root = document.createElement('section');
  root.className = 'codes-view';

  const live = liveCodes(data.items);
  if (live.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'no live codes right now';
    root.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'codes-list';
    for (const c of live) {
      const li = document.createElement('li');
      li.className = 'codes-item';
      const code = document.createElement('code');
      code.className = 'codes-code';
      code.textContent = c.code;
      const label = document.createElement('span');
      label.className = 'codes-game';
      label.textContent = GAME_CONFIGS[c.game]?.label ?? GAME_CONFIGS[game].label;
      li.append(code, label);
      list.appendChild(li);
    }
    root.appendChild(list);
  }

  const checked = document.createElement('p');
  checked.className = 'codes-checked';
  checked.textContent =
    data.lastCheckedAt === null ? 'Codes: not checked yet' : `Last checked ${new Date(data.lastCheckedAt).toLocaleString()}`;
  root.appendChild(checked);
  return root;
}
