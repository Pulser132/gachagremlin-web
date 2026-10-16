// PROTOTYPE — throwaway. Answers "how should the Codes tab look and behave?"
// Three structurally different variants, switched with ?variant=A|B|C (or the
// floating bar / ← →). ?state=ok|empty|down|stale fakes the API outcome.
// Sample data only; "redeemed" is local-only (in memory + localStorage).
import type { GameKey } from '../types.ts';

type Status = 'new' | 'active' | 'expired';
interface Reward { item: string; qty: number }
interface SampleCode { code: string; status: Status; added: string; rewards: Reward[] }

const PREMIUM: Record<GameKey, string> = { genshin: 'Primogem', hsr: 'Stellar Jade', zzz: 'Polychrome' };
const CLAIM: Record<GameKey, string> = {
  genshin: 'https://genshin.hoyoverse.com/gift?code=',
  hsr: 'https://hsr.hoyoverse.com/gift?code=',
  zzz: 'https://zenless.hoyoverse.com/redemption?code=',
};

const SAMPLE: Record<GameKey, SampleCode[]> = {
  genshin: [
    { code: 'GENSHINGIFT', status: 'new', added: '2h ago', rewards: [{ item: 'Primogem', qty: 60 }, { item: "Hero's Wit", qty: 3 }] },
    { code: 'CA3BQQQ7ZSAN', status: 'new', added: '5h ago', rewards: [{ item: 'Mora', qty: 20000 }, { item: 'Mystic Enhancement Ore', qty: 5 }] },
    { code: 'ST8VJ6SJ9MPY', status: 'active', added: '3d ago', rewards: [{ item: 'Primogem', qty: 100 }, { item: "Adventurer's Experience", qty: 5 }] },
    { code: 'GA6B7YZ3NYAD', status: 'active', added: '6d ago', rewards: [{ item: 'Mora', qty: 10000 }] },
    { code: 'OLDCODE2024', status: 'expired', added: '41d ago', rewards: [{ item: 'Primogem', qty: 50 }] },
  ],
  hsr: [
    { code: 'STARRAILGIFT', status: 'new', added: '1h ago', rewards: [{ item: 'Stellar Jade', qty: 50 }, { item: 'Credit', qty: 50000 }] },
    { code: 'HSRTRAVELER', status: 'active', added: '2d ago', rewards: [{ item: 'Traveler\'s Guide', qty: 5 }, { item: 'Credit', qty: 20000 }] },
    { code: 'HSRPAST0001', status: 'expired', added: '33d ago', rewards: [{ item: 'Stellar Jade', qty: 60 }] },
  ],
  zzz: [
    { code: 'ZENLESSGIFT', status: 'new', added: '30m ago', rewards: [{ item: 'Polychrome', qty: 300 }, { item: 'Denny', qty: 40000 }] },
    { code: 'ZZZBOOP2026', status: 'active', added: '4d ago', rewards: [{ item: 'Denny', qty: 30000 }, { item: 'W-Engine Energy Module', qty: 3 }] },
  ],
};

const REDEEMED_KEY = 'gachagremlin:PROTOTYPE:redeemed';
const loadRedeemed = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(REDEEMED_KEY) ?? '[]')); } catch { return new Set(); }
};
const saveRedeemed = (s: Set<string>): void => {
  try { localStorage.setItem(REDEEMED_KEY, JSON.stringify([...s])); } catch { /* prototype */ }
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function chip(game: GameKey, r: Reward): HTMLElement {
  const premium = r.item === PREMIUM[game];
  return el('span', `cp-chip${premium ? ' cp-chip-premium' : ''}`, `${r.item} ×${r.qty.toLocaleString()}`);
}

function claimLink(game: GameKey, code: string, cls = 'cp-claim'): HTMLAnchorElement {
  const a = el('a', cls, 'Claim ↗');
  a.href = CLAIM[game] + encodeURIComponent(code);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function copyBtn(code: string): HTMLButtonElement {
  const b = el('button', 'cp-copy', 'Copy');
  b.type = 'button';
  b.addEventListener('click', () => {
    void navigator.clipboard?.writeText(code);
    b.textContent = 'Copied ✓';
    setTimeout(() => (b.textContent = 'Copy'), 1200);
  });
  return b;
}

function badge(s: Status): HTMLElement {
  return el('span', `cp-badge cp-badge-${s}`, s === 'new' ? 'NEW' : s === 'expired' ? 'Expired' : 'Active');
}

/** Banner for the API outcome states; null when all is well. */
function stateBanner(state: string): HTMLElement | null {
  if (state === 'down') return el('div', 'cp-banner cp-banner-down', "Couldn't reach the bot's code feed. Showing nothing — try Refresh in a moment.");
  if (state === 'stale') return el('div', 'cp-banner cp-banner-stale', 'Bot unreachable — showing codes cached 3 hours ago. Some may have expired.');
  return null;
}

type Ctx = { game: GameKey; codes: SampleCode[]; redeemed: Set<string>; rerender: () => void };

/* ---------- Variant A: dense table, grouped by status ---------- */
function variantA({ game, codes, redeemed, rerender }: Ctx): HTMLElement {
  const root = el('div', 'cp-a');
  const groups: [string, Status[]][] = [['Live', ['new', 'active']], ['Expired (kept 30 days)', ['expired']]];
  for (const [title, statuses] of groups) {
    const rows = codes.filter((c) => statuses.includes(c.status));
    if (!rows.length) continue;
    const sec = el('section', 'cp-a-section');
    sec.appendChild(el('h3', 'cp-a-h', `${title} · ${rows.length}`));
    const table = el('table', 'cp-a-table');
    for (const c of rows) {
      const tr = el('tr', c.status === 'expired' ? 'is-expired' : redeemed.has(c.code) ? 'is-redeemed' : '');
      const tdCode = el('td', 'cp-a-code');
      tdCode.append(badge(c.status), ' ', el('code', '', c.code));
      const tdRw = el('td', 'cp-a-rewards');
      c.rewards.forEach((r) => tdRw.appendChild(chip(game, r)));
      const tdAdded = el('td', 'cp-a-added', c.added);
      const tdAct = el('td', 'cp-a-actions');
      if (c.status !== 'expired') {
        tdAct.append(copyBtn(c.code), claimLink(game, c.code));
        const cb = el('input');
        cb.type = 'checkbox';
        cb.title = 'Mark as redeemed (this browser only)';
        cb.checked = redeemed.has(c.code);
        cb.addEventListener('change', () => { cb.checked ? redeemed.add(c.code) : redeemed.delete(c.code); saveRedeemed(redeemed); rerender(); });
        tdAct.appendChild(cb);
      }
      tr.append(tdCode, tdRw, tdAdded, tdAct);
      table.appendChild(tr);
    }
    sec.appendChild(table);
    root.appendChild(sec);
  }
  return root;
}

/* ---------- Variant B: big cards with the code as the hero ---------- */
function variantB({ game, codes, redeemed, rerender }: Ctx): HTMLElement {
  const root = el('div', 'cp-b');
  const live = codes.filter((c) => c.status !== 'expired');
  const grid = el('div', 'cp-b-grid');
  for (const c of live) {
    const card = el('article', `cp-b-card${c.status === 'new' ? ' is-new' : ''}${redeemed.has(c.code) ? ' is-redeemed' : ''}`);
    const top = el('div', 'cp-b-top');
    top.append(badge(c.status), el('span', 'cp-b-added', c.added));
    const big = el('button', 'cp-b-code', c.code);
    big.type = 'button';
    big.title = 'Click to copy';
    big.addEventListener('click', () => { void navigator.clipboard?.writeText(c.code); big.dataset.copied = '1'; setTimeout(() => delete big.dataset.copied, 1200); });
    const rw = el('div', 'cp-b-rewards');
    c.rewards.forEach((r) => rw.appendChild(chip(game, r)));
    const foot = el('div', 'cp-b-foot');
    const done = el('button', 'cp-b-done', redeemed.has(c.code) ? '✓ Redeemed' : 'Mark redeemed');
    done.type = 'button';
    done.addEventListener('click', () => { redeemed.has(c.code) ? redeemed.delete(c.code) : redeemed.add(c.code); saveRedeemed(redeemed); rerender(); });
    foot.append(claimLink(game, c.code, 'cp-claim cp-claim-big'), done);
    card.append(top, big, rw, foot);
    grid.appendChild(card);
  }
  root.appendChild(grid);
  const exp = codes.filter((c) => c.status === 'expired');
  if (exp.length) {
    const d = el('details', 'cp-b-expired');
    d.appendChild(el('summary', '', `${exp.length} expired`));
    exp.forEach((c) => d.appendChild(el('div', 'cp-b-expired-row', `${c.code} — ${c.rewards.map((r) => `${r.item} ×${r.qty}`).join(', ')}`)));
    root.appendChild(d);
  }
  return root;
}

/* ---------- Variant C: redeem queue — one focus code, progress, no expired ---------- */
function variantC({ game, codes, redeemed, rerender }: Ctx): HTMLElement {
  const root = el('div', 'cp-c');
  const live = codes.filter((c) => c.status !== 'expired');
  const todo = live.filter((c) => !redeemed.has(c.code));
  const prog = el('div', 'cp-c-progress');
  prog.appendChild(el('span', '', `${live.length - todo.length} of ${live.length} redeemed`));
  const bar = el('div', 'cp-c-bar');
  const fill = el('div', 'cp-c-fill');
  fill.style.width = `${live.length ? ((live.length - todo.length) / live.length) * 100 : 100}%`;
  bar.appendChild(fill);
  prog.appendChild(bar);
  root.appendChild(prog);

  if (!todo.length) {
    root.appendChild(el('p', 'cp-c-done', 'All caught up. New codes will show up here — and the bot can DM you with /codes-dm.'));
  } else {
    const [next, ...rest] = todo;
    const focus = el('div', 'cp-c-focus');
    focus.append(badge(next.status), el('div', 'cp-c-code', next.code));
    const rw = el('div', 'cp-c-rewards');
    next.rewards.forEach((r) => rw.appendChild(chip(game, r)));
    const steps = el('ol', 'cp-c-steps');
    const s1 = el('li');
    s1.append('Copy ', copyBtn(next.code));
    const s2 = el('li');
    s2.append('Redeem ', claimLink(game, next.code, 'cp-claim cp-claim-big'));
    const s3 = el('li');
    const done = el('button', 'cp-c-next', 'Done — next code');
    done.type = 'button';
    done.addEventListener('click', () => { redeemed.add(next.code); saveRedeemed(redeemed); rerender(); });
    s3.appendChild(done);
    steps.append(s1, s2, s3);
    focus.append(rw, steps);
    root.appendChild(focus);
    if (rest.length) root.appendChild(el('div', 'cp-c-queue', `Up next: ${rest.map((c) => c.code).join(' · ')}`));
  }
  const reset = el('button', 'cp-c-reset', 'Reset redeemed');
  reset.type = 'button';
  reset.addEventListener('click', () => { redeemed.clear(); saveRedeemed(redeemed); rerender(); });
  root.appendChild(reset);
  return root;
}

const VARIANTS = ['A', 'B', 'C'] as const;
const NAMES: Record<string, string> = { A: 'Dense table', B: 'Hero cards', C: 'Redeem queue' };
const STATES = ['ok', 'empty', 'down', 'stale'];

function param(name: string, fallback: string): string {
  return new URLSearchParams(location.search).get(name) ?? fallback;
}
function setParam(name: string, value: string): void {
  const u = new URL(location.href);
  u.searchParams.set(name, value);
  history.replaceState(null, '', u);
}

export function renderCodesPrototype(game: GameKey): HTMLElement {
  const root = el('div', 'cp-root');
  const redeemed = loadRedeemed();
  const draw = (): void => {
    root.innerHTML = '';
    const variant = param('variant', 'A');
    const state = param('state', 'ok');
    const banner = stateBanner(state);
    if (banner) root.appendChild(banner);
    const codes = state === 'down' ? [] : state === 'empty' ? [] : SAMPLE[game];
    const head = el('div', 'cp-head');
    head.append(
      el('span', 'cp-head-title', `${codes.filter((c) => c.status !== 'expired').length} live codes`),
      el('span', 'cp-head-note', `Premium reward highlighted: ${PREMIUM[game]} · "redeemed" is saved in this browser only`),
    );
    root.appendChild(head);
    if (!codes.length) {
      if (state === 'empty') root.appendChild(el('p', 'cp-empty', 'No live codes right now. The bot checks hourly.'));
    } else {
      const ctx: Ctx = { game, codes, redeemed, rerender: draw };
      root.appendChild(variant === 'B' ? variantB(ctx) : variant === 'C' ? variantC(ctx) : variantA(ctx));
    }
    // floating switcher
    document.querySelector('.cp-switcher')?.remove();
    const bar = el('div', 'cp-switcher');
    const mk = (label: string, fn: () => void): HTMLButtonElement => { const b = el('button', '', label); b.type = 'button'; b.addEventListener('click', fn); return b; };
    const cycle = (d: number): void => { setParam('variant', VARIANTS[(VARIANTS.indexOf(variant as 'A') + d + 3) % 3]); draw(); };
    const stateSel = el('select');
    STATES.forEach((s) => { const o = el('option', '', `state: ${s}`); o.value = s; o.selected = s === state; stateSel.appendChild(o); });
    stateSel.addEventListener('change', () => { setParam('state', stateSel.value); draw(); });
    bar.append(mk('←', () => cycle(-1)), el('span', '', `${variant} (${NAMES[variant] ?? '?'})`), mk('→', () => cycle(1)), stateSel);
    document.body.appendChild(bar);
  };
  draw();
  return root;
}

export function removeCodesPrototypeBar(): void {
  document.querySelector('.cp-switcher')?.remove();
}
