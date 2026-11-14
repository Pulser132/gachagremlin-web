import { scheduleSync } from '../data/cloud/sync.ts';
import { findBannerGroup, GAME_BANNER_CONFIGS, type BannerGroup, type GameBannerConfig } from '../data/wishes/banners.ts';
import { bannerStats, guaranteeState, pityAtEach5Star, pityCounts, type BannerStats, type FiveStarPull } from '../data/wishes/pity.ts';
import { portraitUrl } from '../data/wishes/portraits/resolve.ts';
import { getActiveAccount } from '../data/wishes/store.ts';
import type { GameKey, WishAccount, WishItem } from '../types.ts';
import { openImportDialog, type ImportSummary } from './importDialog.ts';
import { classifyItem, createItemIcon } from './itemIcons.ts';
import { renderPullChart } from './pullChart.ts';
import { renderUidSwitcher } from './uidSwitcher.ts';

const HIDE_BEGINNER_KEY = 'gachagremlin:hideBeginnerBanner';

function readHideBeginner(): boolean {
  try {
    return localStorage.getItem(HIDE_BEGINNER_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHideBeginner(hide: boolean): void {
  try {
    localStorage.setItem(HIDE_BEGINNER_KEY, hide ? '1' : '0');
  } catch {
    // Private browsing / quota: the toggle just won't persist.
  }
}

const RARITY_STARS: Record<string, string> = { '5': '★★★★★', '4': '★★★★', '3': '★★★' };

/** Every HoYoverse game prices one pull at 160 of its premium currency —
 * shown as the ✦ cost line under Lifetime Pulls. */
const CURRENCY_PER_PULL = 160;
const CURRENCY_NAME: Record<GameKey, string> = {
  genshin: 'Primogems',
  hsr: 'Stellar Jade',
  zzz: 'Polychromes',
};

/** Set by the import flow so the next render of the matching game can show a
 * one-time "saved to a different UID" notice. Module-scoped because a full
 * app re-render rebuilds this view from scratch. */
let pendingImportNotice: { game: GameKey; summary: ImportSummary } | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  return node;
}

/** Renders the Wishes/Warps/Signals view for `game`. `onChange` is called
 * after a successful import so the caller can re-render this view. */
export function renderWishesView(game: GameKey, onChange: () => void): HTMLElement {
  const config = GAME_BANNER_CONFIGS[game];
  const account = getActiveAccount(game);

  const wrap = el('div', { className: 'wishes-view' });

  const notice = takeImportNotice(game);
  if (notice) wrap.appendChild(notice);

  const header = el('div', { className: 'wishes-header' });
  header.appendChild(el('h2', { text: config.itemLabel }));
  if (account) {
    header.appendChild(
      el('span', {
        className: 'wishes-meta',
        text: `${account.items.length.toLocaleString()} ${config.itemLabel.toLowerCase()} · imported ${new Date(account.updatedAt).toLocaleDateString()}`,
      }),
    );
  }
  const switcher = renderUidSwitcher(game, onChange);
  if (switcher) header.appendChild(switcher);
  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'import-button';
  importBtn.textContent = account ? `Re-import ${config.itemLabel}` : `Import ${config.itemLabel}`;
  importBtn.addEventListener('click', () =>
    openImportDialog(game, (summary) => {
      pendingImportNotice = { game, summary };
      onChange();
      scheduleSync('merge'); // new pulls are additive
    }),
  );
  header.appendChild(importBtn);
  wrap.appendChild(header);

  if (!account) {
    wrap.appendChild(renderEmptyState(config.itemLabel));
    return wrap;
  }

  const beginner = config.groups.find((g) => g.beginner);
  if (beginner) {
    const label = el('label', { className: 'beginner-toggle' });
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = readHideBeginner();
    box.addEventListener('change', () => {
      writeHideBeginner(box.checked);
      onChange();
    });
    label.appendChild(box);
    label.appendChild(el('span', { text: `Hide ${beginner.label}` }));
    wrap.appendChild(label);
  }

  wrap.appendChild(renderBannerCards(game, account, config, readHideBeginner()));
  wrap.appendChild(renderHistoryTable(game, account));

  return wrap;
}

/** Consumes a one-time import notice for `game`. Returns a dismissible banner
 * only when the import landed on a different UID than the one being viewed
 * (the view has already auto-swapped to it); otherwise null. */
function takeImportNotice(game: GameKey): HTMLElement | null {
  const pending = pendingImportNotice;
  if (!pending || pending.game !== game) return null;
  pendingImportNotice = null;

  const { previousUid, activeUid } = pending.summary;
  if (!previousUid || previousUid === activeUid) return null;

  const banner = el('div', { className: 'wishes-notice' });
  banner.setAttribute('role', 'status');
  banner.appendChild(
    el('span', {
      text: `These pulls belong to UID ${activeUid}, not the UID you were viewing (${previousUid}). They've been saved to UID ${activeUid} and the view has switched to it.`,
    }),
  );
  const dismiss = el('button', { className: 'wishes-notice-dismiss', text: '×' });
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.addEventListener('click', () => banner.remove());
  banner.appendChild(dismiss);
  return banner;
}

function renderEmptyState(itemLabel: string): HTMLElement {
  const box = el('div', { className: 'wishes-empty' });
  box.appendChild(el('p', { text: `No ${itemLabel.toLowerCase()} imported yet.` }));
  box.appendChild(
    el('p', {
      className: 'wishes-empty-hint',
      text: `Click "Import ${itemLabel}" above and follow the steps to bring in your pull history from the game.`,
    }),
  );
  return box;
}

/** One inset stat row: label + sub-caption on the left, a big display-face
 * number on the right (paimon.moe-style Wish Counter row). */
function statRow(label: string, sub: string, value: string, valueClass: string, subTitle?: string): HTMLElement {
  const row = el('div', { className: 'stat-row' });
  const text = el('div', { className: 'stat-text' });
  text.appendChild(el('span', { className: 'stat-label', text: label }));
  const subEl = el('span', { className: 'stat-sub', text: sub });
  if (subTitle) subEl.title = subTitle;
  text.appendChild(subEl);
  row.appendChild(text);
  row.appendChild(el('span', { className: `stat-value ${valueClass}`, text: value }));
  return row;
}

const dec = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const percentOf = (n: number, of: number): string => (of > 0 ? `${dec((n / of) * 100)}%` : '—');

/** The 4★ sub-rows are keyed by what the category is called in each game. */
function fourStarTypeLabel(itemType: string, game: GameKey): string {
  const key = classifyItem(itemType, game);
  if (key === 'character') return game === 'zzz' ? 'Agent' : 'Character';
  if (key === 'unknown') return itemType || 'Other';
  return { weapon: 'Weapon', lightcone: 'Light Cone', wengine: 'W-Engine', bangboo: 'Bangboo' }[key];
}

/** One row of the breakdown table: a label (indented under its parent when
 * `child`) and up to three right-aligned figures — total, share, average pity. */
function breakdownRow(
  label: string,
  cells: [string, string, string],
  opts: { tone: '5' | '4'; child?: boolean; title?: string },
): HTMLElement {
  const row = el('div', { className: `breakdown-row tone-${opts.tone}${opts.child ? ' child' : ''}` });
  const name = el('span', { className: 'breakdown-label', text: label });
  if (opts.title) name.title = opts.title;
  row.appendChild(name);
  for (const c of cells) row.appendChild(el('span', { className: 'breakdown-cell', text: c }));
  return row;
}

/** The detailed stats under the pity gauges: 5★ and 4★ totals, share of all
 * pulls, average pity, the 50/50 record, and the 4★ split by category. */
function renderBreakdown(game: GameKey, group: BannerGroup, s: BannerStats): HTMLElement {
  const box = el('div', { className: 'breakdown' });
  box.setAttribute('role', 'table');
  box.setAttribute('aria-label', `${group.label} statistics`);

  const head = el('div', { className: 'breakdown-row breakdown-head' });
  head.setAttribute('role', 'row');
  head.appendChild(el('span'));
  for (const t of ['Total', 'Percent', 'Avg pity']) head.appendChild(el('span', { className: 'breakdown-cell', text: t }));
  box.appendChild(head);

  const avg = (n: number | null): string => (n === null ? '—' : dec(n));

  box.appendChild(breakdownRow('5★', [String(s.fiveCount), percentOf(s.fiveCount, s.total), avg(s.fiveAvgPity)], { tone: '5' }));
  if (group.has5050 && s.flips > 0) {
    const odds = (group.oddsLabel ?? '50/50').replace('/', ':');
    box.appendChild(
      breakdownRow(`Win ${odds}`, [String(s.wins), percentOf(s.wins, s.flips), ''], {
        tone: '5',
        child: true,
        title: `${s.wins} of ${s.flips} coin flips. 5★s guaranteed after a loss aren't counted.`,
      }),
    );
  }

  if (s.fourCount > 0) {
    box.appendChild(breakdownRow('4★', [String(s.fourCount), percentOf(s.fourCount, s.total), avg(s.fourAvgPity)], { tone: '4' }));
    // Split only when it says something: a single category is just the parent row again.
    if (s.fourByType.size > 1) {
      for (const [type, n] of [...s.fourByType].sort((a, b) => b[1] - a[1])) {
        box.appendChild(breakdownRow(fourStarTypeLabel(type, game), [String(n), percentOf(n, s.total), ''], { tone: '4', child: true }));
      }
    }
  }
  return box;
}

/** Pity tier for a 5★ chip: early, middle or deep into the soft-pity ramp. */
function pityTier(pity: number, hardPity: number): 'early' | 'mid' | 'late' {
  const f = pity / hardPity;
  if (f <= 0.45) return 'early';
  if (f <= 0.8) return 'mid';
  return 'late';
}

/** Every 5★ on this banner, oldest first, as a name + the pity it took.
 * Gold outline = the limited pull (a won 50/50 or a guarantee); the number's
 * colour says how deep the pity ran. */
function renderPullChips(group: BannerGroup, fives: FiveStarPull[]): HTMLElement {
  const list = el('ul', { className: 'pull-chips' });
  list.setAttribute('aria-label', `${group.label} 5★ pulls, oldest first`);
  for (const { item, pity, limited } of fives) {
    const li = el('li', { className: `pull-chip${limited ? ' limited' : ''}` });
    li.appendChild(el('span', { className: 'pull-chip-name', text: item.name }));
    li.appendChild(el('span', { className: `pull-chip-pity tier-${pityTier(pity, group.hardPity)}`, text: String(pity) }));
    if (limited) li.title = 'Limited 5★';
    list.appendChild(li);
  }
  return list;
}

function renderBannerCard(game: GameKey, account: WishAccount, group: BannerGroup, config: GameBannerConfig): HTMLElement {
  const counts = pityCounts(account.items, group);
  const card = el('article', { className: 'banner-card' });

  const head = el('div', { className: 'banner-card-head' });
  head.appendChild(el('h3', { className: 'banner-card-title', text: group.label }));
  if (group.has5050) {
    const state = guaranteeState(account.items, group, config.standardPool5Star);
    head.appendChild(
      el('span', {
        className: `guarantee-badge ${state.guaranteed ? 'guaranteed' : 'coinflip'}`,
        text: state.guaranteed ? 'Guaranteed' : (group.oddsLabel ?? '50/50'),
      }),
    );
  }
  card.appendChild(head);

  card.appendChild(
    statRow(
      'Lifetime Pulls',
      `✦ ${(counts.total * CURRENCY_PER_PULL).toLocaleString()}`,
      counts.total.toLocaleString(),
      'stat-total',
      `${CURRENCY_NAME[game]}, at ${CURRENCY_PER_PULL} per pull`,
    ),
  );

  const fiveRow = statRow('5★ Pity', `Guaranteed at ${group.hardPity}`, String(counts.since5Star), 'stat-5');
  // The pity fuse: a thin progress line along the row's bottom edge, keeping
  // the old pity bar's progressbar semantics.
  const fuse = el('div', { className: 'stat-fuse' });
  fuse.setAttribute('role', 'progressbar');
  fuse.setAttribute('aria-label', `${group.label} pity`);
  fuse.setAttribute('aria-valuenow', String(counts.since5Star));
  fuse.setAttribute('aria-valuemin', '0');
  fuse.setAttribute('aria-valuemax', String(group.hardPity));
  const fill = el('div', { className: 'stat-fuse-fill' });
  fill.style.width = `${Math.min(100, (counts.since5Star / group.hardPity) * 100)}%`;
  fuse.appendChild(fill);
  fiveRow.appendChild(fuse);
  card.appendChild(fiveRow);

  card.appendChild(statRow('4★ Pity', 'Guaranteed at 10', String(counts.since4Star), 'stat-4'));

  const stats = bannerStats(account.items, group, config.standardPool5Star);
  if (stats.fiveCount > 0 || stats.fourCount > 0) {
    card.appendChild(renderBreakdown(game, group, stats));
  }
  if (stats.fives.length > 0) card.appendChild(renderPullChips(group, stats.fives));

  // Expander (the reference's chevron): the last five 5★s and their pity.
  const fives = account.items.filter((i) => i.rank === '5' && group.bannerTypes.includes(i.bannerType));
  if (fives.length > 0) {
    const pityById = pityAtEach5Star(account.items, group);
    const details = el('details', { className: 'banner-recent' });
    details.appendChild(el('summary', { text: 'Recent 5★' }));
    const list = el('ul');
    for (const item of fives.slice(-5).reverse()) {
      const li = el('li');
      appendRecentItem(li, item, game);
      li.appendChild(el('span', { className: 'recent-pity', text: `${pityById.get(item.id) ?? '—'} pity` }));
      list.appendChild(li);
    }
    details.appendChild(list);
    card.appendChild(details);
  }

  return card;
}

/** The Wish Counter grid: one card per banner group, then the pulls-per-month
 * chart filling the last cell. */
function renderBannerCards(game: GameKey, account: WishAccount, config: GameBannerConfig, hideBeginner: boolean): HTMLElement {
  const grid = el('section', { className: 'banner-grid' });
  for (const group of config.groups) {
    if (hideBeginner && group.beginner) continue;
    grid.appendChild(renderBannerCard(game, account, group, config));
  }
  grid.appendChild(renderPullChart(account.items, config.itemLabel));
  return grid;
}

/** Appends this 5★'s name to `li` in the Recent 5★ list — wrapped with a
 * 40px portrait for a matched character/Light Cone, or bare text for an
 * unmatched one.
 *
 * This surface carries no category glyph today, so a miss (`portraitUrl`
 * returns `null`) appends exactly the bare name span it always has — no
 * wrapper, no slot. A matched item's portrait and name are wrapped together
 * in `.recent-item` so the list's `space-between` layout still puts the pity
 * figure hard right instead of stranding the name mid-row. */
function appendRecentItem(li: HTMLElement, item: WishItem, game: GameKey): void {
  const bareName = () => el('span', { text: item.name });

  const url = portraitUrl(item, game);
  if (!url) {
    li.appendChild(bareName());
    return;
  }

  const wrapper = el('span', { className: 'recent-item' });

  const img = document.createElement('img');
  img.className = 'recent-portrait';
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  // A stale manifest entry or a runtime CDN failure must leave the row
  // looking like today's: drop the portrait wrapper and put the bare name
  // span back in its place.
  img.addEventListener('error', () => {
    wrapper.replaceWith(bareName());
  });
  img.src = url;

  wrapper.appendChild(img);
  wrapper.appendChild(bareName());
  li.appendChild(wrapper);
}

/** Appends this pull's icon to `cell` — a bare category glyph for the
 * overwhelming majority of rows, or a 32px portrait carrying that same glyph
 * shrunk into a corner badge for a matched 4★/5★ character or Light Cone.
 *
 * An unmatched item (`portraitUrl` returns `null`) appends the exact fragment
 * `createItemIcon` always has — the never-regress guarantee (spec §1.3): no
 * slot, no skeleton, byte-identical to before portraits existed. */
function appendItemIcon(cell: HTMLElement, item: WishItem, game: GameKey): void {
  const url = portraitUrl(item, game);
  if (!url) {
    cell.appendChild(createItemIcon(item.itemType, game));
    return;
  }

  const iconFragment = createItemIcon(item.itemType, game);
  const svg = iconFragment.querySelector('svg.item-icon')!;
  const label = iconFragment.querySelector('.sr-only')!;

  const slot = document.createElement('span');
  slot.className = 'icon-slot';
  slot.appendChild(svg);

  const img = document.createElement('img');
  img.className = 'portrait-img';
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  // A stale manifest entry or a runtime CDN failure must not leave a gap or a
  // stranded badge: drop the label that's about to be appended alongside the
  // slot and rebuild today's glyph fresh in the slot's place, in one motion.
  img.addEventListener('error', () => {
    label.remove();
    slot.replaceWith(createItemIcon(item.itemType, game));
  });
  img.src = url;
  slot.appendChild(img);

  cell.appendChild(slot);
  cell.appendChild(label);
}

function renderHistoryTable(game: GameKey, account: WishAccount): HTMLElement {
  const config = GAME_BANNER_CONFIGS[game];
  // A native disclosure: closed until the player opens it. The table is still
  // built up front, so opening is instant and filters keep their state.
  const section = el('details', { className: 'wishes-history' });
  const summary = el('summary');
  summary.appendChild(el('h3', { text: 'Pull History' }));
  summary.appendChild(el('span', { className: 'history-chevron' }));
  summary.lastElementChild!.setAttribute('aria-hidden', 'true');
  section.appendChild(summary);

  const filters = el('div', { className: 'history-filters' });

  const bannerSelect = document.createElement('select');
  bannerSelect.setAttribute('aria-label', 'Filter by banner');
  const allBannersOption = document.createElement('option');
  allBannersOption.value = 'all';
  allBannersOption.textContent = 'All banners';
  bannerSelect.appendChild(allBannersOption);
  for (const group of config.groups) {
    const opt = document.createElement('option');
    opt.value = group.key;
    opt.textContent = group.label;
    bannerSelect.appendChild(opt);
  }
  filters.appendChild(bannerSelect);

  const raritySelect = document.createElement('select');
  raritySelect.setAttribute('aria-label', 'Filter by rarity');
  const rarityOptions: [string, string][] = [
    ['all', 'All rarities'],
    ['5', '5★'],
    ['4', '4★'],
    ['3', '3★'],
  ];
  for (const [value, label] of rarityOptions) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    raritySelect.appendChild(opt);
  }
  filters.appendChild(raritySelect);

  const countSelect = document.createElement('select');
  countSelect.setAttribute('aria-label', 'Show how many pulls');
  const countOptions: [string, string][] = [
    ['100', 'Last 100'],
    ['50', 'Last 50'],
    ['10', 'Last 10'],
    ['all', 'All pulls'],
  ];
  for (const [value, label] of countOptions) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === '100') opt.selected = true; // default: don't flood the table on load
    countSelect.appendChild(opt);
  }
  filters.appendChild(countSelect);

  const countCaption = el('span', { className: 'history-count' });
  filters.appendChild(countCaption);

  section.appendChild(filters);

  const tableWrap = el('div', { className: 'history-table-wrap' });
  section.appendChild(tableWrap);

  // Pity is scoped per banner group, so compute it once per group and
  // merge into a single id -> pity lookup for the table's Pity column.
  const pityById = new Map<string, number>();
  for (const group of config.groups) {
    for (const [id, pity] of pityAtEach5Star(account.items, group)) {
      pityById.set(id, pity);
    }
  }

  function renderRows(): void {
    tableWrap.innerHTML = '';
    const bannerFilter = bannerSelect.value;
    const rarityFilter = raritySelect.value;

    const filtered = account.items
      .filter((item) => {
        if (rarityFilter !== 'all' && item.rank !== rarityFilter) return false;
        if (bannerFilter !== 'all') {
          const group = findBannerGroup(game, item.bannerType);
          if (!group || group.key !== bannerFilter) return false;
        }
        return true;
      })
      .slice()
      .reverse(); // account.items is ascending by id; show newest pulls first

    // Only render the most recent `limit` matches so a large history doesn't
    // flood the table; pity above is still computed across the full history.
    const limit = countSelect.value;
    const shown = limit === 'all' ? filtered : filtered.slice(0, Number(limit));

    const itemLabel = config.itemLabel.toLowerCase();
    if (filtered.length === 0) {
      countCaption.textContent = '';
    } else if (shown.length === filtered.length) {
      countCaption.textContent = `Showing all ${filtered.length.toLocaleString()} ${itemLabel}`;
    } else {
      countCaption.textContent = `Showing latest ${shown.length.toLocaleString()} of ${filtered.length.toLocaleString()} ${itemLabel}`;
    }

    if (filtered.length === 0) {
      tableWrap.appendChild(el('p', { className: 'empty', text: 'No pulls match these filters.' }));
      return;
    }

    const table = document.createElement('table');
    table.className = 'history-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of ['Item', 'Banner', 'Time', 'Pity']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const item of shown) {
      const tr = document.createElement('tr');
      tr.className = `rarity-${item.rank}`;

      const nameCell = document.createElement('td');
      nameCell.className = 'history-item-cell';
      appendItemIcon(nameCell, item, game);
      nameCell.appendChild(document.createTextNode(item.name));
      const starEl = document.createElement('span');
      starEl.className = 'rarity-star';
      starEl.setAttribute('aria-hidden', 'true');
      starEl.textContent = ` ${RARITY_STARS[item.rank] ?? ''}`;
      nameCell.appendChild(starEl);
      tr.appendChild(nameCell);

      const bannerCell = document.createElement('td');
      bannerCell.textContent = findBannerGroup(game, item.bannerType)?.label ?? item.bannerType;
      tr.appendChild(bannerCell);

      const timeCell = document.createElement('td');
      timeCell.textContent = item.time;
      tr.appendChild(timeCell);

      const pityCell = document.createElement('td');
      pityCell.textContent = item.rank === '5' ? String(pityById.get(item.id) ?? '') : '';
      tr.appendChild(pityCell);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }

  bannerSelect.addEventListener('change', renderRows);
  raritySelect.addEventListener('change', renderRows);
  countSelect.addEventListener('change', renderRows);
  renderRows();

  return section;
}
