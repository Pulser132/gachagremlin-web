import { findBannerGroup, GAME_BANNER_CONFIGS } from '../data/wishes/banners.ts';
import { guaranteeState, pityAtEach5Star, pityCounts } from '../data/wishes/pity.ts';
import { getActiveAccount } from '../data/wishes/store.ts';
import type { GameKey, WishAccount } from '../types.ts';
import { openImportDialog } from './importDialog.ts';

const RARITY_STARS: Record<string, string> = { '5': '★★★★★', '4': '★★★★', '3': '★★★' };

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

  const header = el('div', { className: 'wishes-header' });
  header.appendChild(el('h2', { text: config.itemLabel }));
  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'import-button';
  importBtn.textContent = account ? `Re-import ${config.itemLabel}` : `Import ${config.itemLabel}`;
  importBtn.addEventListener('click', () => openImportDialog(game, onChange));
  header.appendChild(importBtn);
  wrap.appendChild(header);

  if (!account) {
    wrap.appendChild(renderEmptyState(config.itemLabel));
    return wrap;
  }

  wrap.appendChild(renderSummary(account, config.itemLabel));
  wrap.appendChild(renderPityCards(game, account));
  wrap.appendChild(renderHistoryTable(game, account));

  return wrap;
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

function renderSummary(account: WishAccount, itemLabel: string): HTMLElement {
  const bar = el('div', { className: 'wishes-summary' });
  bar.appendChild(el('span', { text: `UID ${account.uid}` }));
  bar.appendChild(el('span', { text: `${account.items.length} ${itemLabel.toLowerCase()}` }));
  bar.appendChild(el('span', { text: `Last imported ${new Date(account.updatedAt).toLocaleString()}` }));
  return bar;
}

function renderPityCards(game: GameKey, account: WishAccount): HTMLElement {
  const config = GAME_BANNER_CONFIGS[game];
  const grid = el('div', { className: 'pity-grid' });

  for (const group of config.groups) {
    const counts = pityCounts(account.items, group);
    const card = el('div', { className: 'pity-card' });
    card.appendChild(el('h3', { className: 'pity-card-title', text: group.label }));
    card.appendChild(el('p', { className: 'pity-count', text: `${counts.since5Star} / ${group.hardPity} pity` }));
    card.appendChild(
      el('p', { className: 'pity-sub', text: `${counts.since4Star} since last 4★ · ${counts.total} total pulls` }),
    );

    if (group.has5050) {
      const state = guaranteeState(account.items, group, config.standardPool5Star);
      card.appendChild(
        el('span', {
          className: `guarantee-badge ${state.guaranteed ? 'guaranteed' : 'fifty-fifty'}`,
          text: state.guaranteed ? 'Guaranteed' : '50/50',
        }),
      );
    }

    grid.appendChild(card);
  }

  return grid;
}

function renderHistoryTable(game: GameKey, account: WishAccount): HTMLElement {
  const config = GAME_BANNER_CONFIGS[game];
  const section = el('section', { className: 'wishes-history' });
  section.appendChild(el('h3', { text: 'Pull History' }));

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

    const rows = account.items
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

    if (rows.length === 0) {
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
    for (const item of rows) {
      const tr = document.createElement('tr');
      tr.className = `rarity-${item.rank}`;

      const nameCell = document.createElement('td');
      nameCell.textContent = item.name;
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
  renderRows();

  return section;
}
