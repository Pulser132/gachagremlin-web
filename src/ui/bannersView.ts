import { getGame } from '../data/wiki/games.ts';
import type { BannerCategorySection, BannerInfo, GameBanners, GameKey, Region } from '../types.ts';
import { resolveRegionUnix } from './eventCard.ts';
import { formatAbsolute } from './format.ts';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  return node;
}

/**
 * Renders the Banners tab for `game`. `banners === null` means the game has
 * no configured Banner listing page (the "not wired up yet" placeholder) —
 * distinct from a wired game whose current/upcoming lists are simply empty,
 * which renders its own empty-state message instead.
 */
export function renderBannersView(game: GameKey, banners: GameBanners | null, region: Region): HTMLElement {
  const wrap = el('div', { className: 'banners-view' });

  if (banners === null) {
    wrap.appendChild(renderUnsupportedPanel(game));
    return wrap;
  }

  if (banners.current.length === 0 && banners.upcoming.length === 0) {
    wrap.appendChild(el('p', { className: 'empty', text: 'No banners are currently listed on the wiki.' }));
    return wrap;
  }

  for (const section of banners.current) {
    wrap.appendChild(renderCategorySection(section, region, 'h2'));
  }

  if (banners.upcoming.length > 0) {
    const upcomingWrap = el('div', { className: 'banners-upcoming' });
    upcomingWrap.appendChild(el('h2', { text: 'Upcoming' }));
    for (const section of banners.upcoming) {
      upcomingWrap.appendChild(renderCategorySection(section, region, 'h3'));
    }
    wrap.appendChild(upcomingWrap);
  }

  return wrap;
}

function renderUnsupportedPanel(game: GameKey): HTMLElement {
  const box = el('div', { className: 'banners-unsupported' });
  box.appendChild(
    el('p', { text: `Banner data for ${getGame(game).label} isn't wired up yet — check back soon.` }),
  );
  return box;
}

function renderCategorySection(
  section: BannerCategorySection,
  region: Region,
  headingTag: 'h2' | 'h3',
): HTMLElement {
  const sectionEl = document.createElement('section');
  sectionEl.className = 'event-section banner-category-section';
  sectionEl.appendChild(el(headingTag, { text: section.label }));

  const grid = el('div', { className: 'event-grid' });
  for (const banner of section.banners) {
    grid.appendChild(renderBannerCard(banner, region));
  }
  sectionEl.appendChild(grid);
  return sectionEl;
}

function renderBannerCard(banner: BannerInfo, region: Region): HTMLElement {
  const card = el('article', { className: `event-card banner-live-card status-${banner.status}` });

  if (banner.imageUrl) {
    const art = el('img', { className: 'event-banner banner-live-art' });
    // Unlike the Events card (decorative art next to an adjacent name
    // heading), the Banners tab spec calls for meaningful alt text so
    // screen-reader users get the splash art's identity, not just its name.
    art.alt = `${banner.name} banner art`;
    art.referrerPolicy = 'no-referrer';
    art.addEventListener('error', () => art.remove());
    art.src = banner.imageUrl;
    card.appendChild(art);
  }

  const header = el('div', { className: 'event-card-header' });
  header.appendChild(el('h3', { className: 'event-name', text: banner.name }));
  header.appendChild(el('span', { className: `event-status-badge status-${banner.status}`, text: banner.status }));
  card.appendChild(header);

  if (banner.featured5Star.length > 0) {
    const p = el('p', { className: 'banner-featured banner-featured-5' });
    p.appendChild(el('strong', { text: '★5 ' }));
    p.appendChild(document.createTextNode(banner.featured5Star.join(', ')));
    card.appendChild(p);
  }
  if (banner.featured4Star.length > 0) {
    const p = el('p', { className: 'banner-featured banner-featured-4' });
    p.appendChild(el('strong', { text: '★4 ' }));
    p.appendChild(document.createTextNode(banner.featured4Star.join(', ')));
    card.appendChild(p);
  }

  card.appendChild(renderBannerTimes(banner, region));

  const linkPara = el('p', { className: 'event-link' });
  const a = el('a', { text: 'Wiki page ↗' });
  a.href = banner.wikiUrl;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  linkPara.appendChild(a);
  card.appendChild(linkPara);

  return card;
}

function renderBannerTimes(banner: BannerInfo, region: Region): HTMLElement {
  const wrap = el('div', { className: 'event-times' });

  if (banner.status === 'unknown' || !banner.endUnix) {
    wrap.appendChild(el('p', { className: 'event-times-missing', text: 'End time not announced on the wiki yet.' }));
    return wrap;
  }

  const endAt = resolveRegionUnix(banner.endUnix, region);
  const startAt = resolveRegionUnix(banner.startUnix, region);

  if (startAt !== null && banner.status === 'upcoming') {
    wrap.appendChild(renderTimeRow('starts in', startAt));
  }

  if (banner.status === 'ended') {
    wrap.appendChild(el('p', { className: 'event-times-missing banner-live-ended', text: 'Ended' }));
  } else if (endAt !== null) {
    wrap.appendChild(renderTimeRow('ends in', endAt));
  } else {
    wrap.appendChild(el('p', { className: 'event-times-missing', text: 'End time not announced on the wiki yet.' }));
  }

  return wrap;
}

function renderTimeRow(label: string, unixSeconds: number): HTMLElement {
  const row = el('p', { className: 'event-time-row' });
  const countdown = el('span', { className: 'countdown' });
  countdown.dataset.deadline = String(unixSeconds);
  countdown.dataset.countdownLabel = label;
  row.appendChild(countdown);
  row.appendChild(el('span', { className: 'event-time-absolute', text: ` (${formatAbsolute(unixSeconds)})` }));
  return row;
}
