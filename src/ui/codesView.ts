import { liveCodes, type CodeItem, type CodesResult } from '../data/codesApi.ts';
import { GAME_CONFIGS } from '../data/wiki/games.ts';
import type { GameKey } from '../types.ts';

/** A Code first seen within this window gets the NEW badge instead of Active. */
const NEW_WINDOW_MS = 48 * 3600_000;

function copyCard(c: CodeItem): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'codes-copy';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'codes-code';
  btn.textContent = c.code;
  btn.setAttribute('aria-label', `Copy code ${c.code}`);
  const note = document.createElement('span');
  note.className = 'codes-copied';
  note.setAttribute('role', 'status');
  let timer: ReturnType<typeof setTimeout> | undefined;
  btn.addEventListener('click', () => {
    const done = (msg: string) => {
      note.textContent = msg;
      clearTimeout(timer);
      timer = setTimeout(() => { note.textContent = ''; }, 2000);
    };
    const write = navigator.clipboard?.writeText(c.code);
    if (!write) return done('Copy failed — select the code and copy it manually');
    write.then(() => done('Copied!'), () => done('Copy failed — select the code and copy it manually'));
  });
  wrap.append(btn, note);
  return wrap;
}

function card(c: CodeItem, fallbackGame: GameKey, now: number): HTMLElement {
  const el = document.createElement('li');
  el.className = 'codes-card';
  if (c.premium) el.classList.add('codes-premium');

  const head = document.createElement('div');
  head.className = 'codes-head';
  const badge = document.createElement('span');
  const isNew = now - c.firstSeenAt < NEW_WINDOW_MS;
  badge.className = `codes-badge${isNew ? ' codes-badge-new' : ''}`;
  badge.textContent = isNew ? 'NEW' : 'Active';
  const label = document.createElement('span');
  label.className = 'codes-game';
  label.textContent = GAME_CONFIGS[c.game]?.label ?? GAME_CONFIGS[fallbackGame].label;
  head.append(badge, label);
  el.append(head, copyCard(c));

  if (c.rewards.length > 0) {
    const chips = document.createElement('ul');
    chips.className = 'codes-chips';
    chips.setAttribute('aria-label', 'Rewards');
    for (const r of c.rewards) {
      const chip = document.createElement('li');
      chip.className = 'codes-chip';
      chip.textContent = `${r.item} ×${r.qty.toLocaleString('en-US')}`;
      chips.appendChild(chip);
    }
    el.appendChild(chips);
  }

  if (c.claimUrl) {
    const claim = document.createElement('a');
    claim.className = 'codes-claim';
    claim.href = c.claimUrl;
    claim.target = '_blank';
    claim.rel = 'noopener noreferrer';
    claim.textContent = 'Claim';
    claim.setAttribute('aria-label', `Claim ${c.code} (opens in a new tab)`);
    el.appendChild(claim);
  }
  return el;
}

/** A grid of hero cards for the game's live Codes, newest first, plus when the bot last checked. */
export function renderCodesView(game: GameKey, data: CodesResult, now: number = Date.now()): HTMLElement {
  const root = document.createElement('section');
  root.className = 'codes-view';

  const live = liveCodes(data.items);
  if (live.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'no live codes right now';
    root.appendChild(empty);
  } else {
    const grid = document.createElement('ul');
    grid.className = 'codes-grid';
    for (const c of live) grid.appendChild(card(c, game, now));
    root.appendChild(grid);
  }

  const checked = document.createElement('p');
  checked.className = 'codes-checked';
  checked.textContent =
    data.lastCheckedAt === null ? 'Codes: not checked yet' : `Last checked ${new Date(data.lastCheckedAt).toLocaleString()}`;
  root.appendChild(checked);
  return root;
}
