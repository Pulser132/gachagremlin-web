import { getGame } from '../data/wiki/games.ts';
import type { GameBanners, GameEvents, GameKey, Region } from '../types.ts';
import { renderCountdownRow } from './countdown.ts';
import { renderEventCard } from './eventCard.ts';
import { KIND_LABELS, layoutTimeline, type TimelineBar, type TimelineLayout } from './timelineLayout.ts';

const LOOKBACK_DAYS = 7;
const PX_PER_DAY_DESKTOP = 30;
const PX_PER_DAY_PHONE = 18;
/** Where the now line sits on initial scroll, as a fraction of the viewport. */
const NOW_VIEWPORT_FRACTION = 0.15;
/** Below this drawn width the remaining-time chip is hidden. */
const CHIP_MIN_PX = 110;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  return node;
}

function isPhone(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches;
}

/**
 * Renders the Timeline tab for `game`. `banners === null` means the game has
 * no banner data; the view says so instead of silently omitting the lane.
 * `nowMs` is injected so the render is deterministic.
 */
export function renderTimelineView(
  game: GameKey,
  events: GameEvents,
  banners: GameBanners | null,
  region: Region,
  nowMs: number = Date.now(),
): HTMLElement {
  const pxPerDay = isPhone() ? PX_PER_DAY_PHONE : PX_PER_DAY_DESKTOP;
  const offset = getGame(game).servers[region] ?? 0;
  const layout = layoutTimeline({
    events,
    banners,
    region,
    utcOffsetHours: offset,
    now: Math.floor(nowMs / 1000),
    lookbackDays: LOOKBACK_DAYS,
    pxPerDay,
  });

  const wrap = el('div', { className: 'timeline-view' });
  wrap.dataset.pxPerDay = String(pxPerDay);

  const sign = offset < 0 ? '-' : '+';
  const toolbar = el('div', { className: 'timeline-toolbar' });
  toolbar.appendChild(el('p', { className: 'timeline-zone', text: `Server time: ${region} (UTC${sign}${Math.abs(offset)})` }));
  const nowBtn = el('button', { className: 'timeline-now-btn', text: 'Jump to now' });
  nowBtn.type = 'button';
  nowBtn.addEventListener('click', () => scrollTimelineToNow(wrap));
  toolbar.appendChild(nowBtn);
  wrap.appendChild(toolbar);

  if (banners === null) {
    wrap.appendChild(el('p', { className: 'timeline-note', text: "Banners aren't available for this game yet" }));
  } else if (![...banners.current, ...banners.upcoming].some((s) => s.banners.length > 0)) {
    wrap.appendChild(el('p', { className: 'timeline-note', text: 'No banners are currently listed on the wiki.' }));
  }

  if (layout.lanes.length === 0) {
    wrap.appendChild(el('p', { className: 'empty', text: 'Nothing with known dates to show on the timeline.' }));
  } else {
    const panelHost = el('div', { className: 'timeline-panel-host' });
    const panel = createDetailPanel(panelHost, region, offset);
    wrap.appendChild(renderScroller(layout, pxPerDay, (bar, btn) => panel.open(bar, btn)));
    wrap.appendChild(panelHost);
  }

  if (layout.tba.length > 0) {
    const tba = el('section', { className: 'timeline-tba' });
    tba.appendChild(el('h2', { text: 'Dates TBA' }));
    const list = el('ul');
    for (const item of layout.tba) {
      list.appendChild(el('li', { text: `${item.name} (${KIND_LABELS[item.kind].singular}) — ${item.reason}` }));
    }
    tba.appendChild(list);
    wrap.appendChild(tba);
  }

  return wrap;
}

/** Scrolls so the now line sits ~15% in from the left. Call once the view is
 * attached; happy-dom/no-layout environments have zero widths and are no-ops. */
export function scrollTimelineToNow(view: HTMLElement): void {
  const scroller = view.querySelector<HTMLElement>('.timeline-scroll');
  const nowLine = view.querySelector<HTMLElement>('.timeline-now');
  if (!scroller || !nowLine) return;
  const nowPx = parseFloat(nowLine.style.left);
  scroller.scrollLeft = Math.max(0, nowPx - scroller.clientWidth * NOW_VIEWPORT_FRACTION);
}

function renderScroller(
  layout: TimelineLayout,
  pxPerDay: number,
  onOpen: (bar: TimelineBar, btn: HTMLElement) => void,
): HTMLElement {
  const scroller = el('div', { className: 'timeline-scroll' });
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'region');
  scroller.setAttribute('aria-label', 'Timeline, scrolls horizontally');

  const spanPx = layout.spanDays * pxPerDay;
  const px = (fraction: number) => `${fraction * spanPx}px`;

  const canvas = el('div', { className: 'timeline-canvas' });
  canvas.style.width = `${spanPx}px`;

  const axis = el('div', { className: 'timeline-axis' });
  for (const tick of layout.ticks) {
    const line = el('div', { className: 'timeline-tick' });
    line.style.left = px(tick.x);
    line.appendChild(el('span', { text: tick.label }));
    axis.appendChild(line);
  }
  canvas.appendChild(axis);

  const nowLine = el('div', { className: 'timeline-now' });
  nowLine.style.left = px(layout.nowX);
  nowLine.setAttribute('aria-hidden', 'true');
  canvas.appendChild(nowLine);

  for (const lane of layout.lanes) {
    const group = el('div', { className: `timeline-lane timeline-lane-${lane.kind}` });
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', lane.label);
    group.appendChild(el('h2', { className: 'timeline-lane-header', text: lane.label }));
    for (const row of lane.rows) {
      const rowEl = el('div', { className: 'timeline-row' });
      for (const b of row) rowEl.appendChild(renderBar(b, KIND_LABELS[lane.kind].singular, px(b.x), px(b.w), b.w * spanPx, onOpen));
      group.appendChild(rowEl);
    }
    canvas.appendChild(group);
  }

  scroller.appendChild(canvas);
  return scroller;
}

function formatDay(unix: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(unix * 1000));
}

function renderBar(
  b: TimelineBar,
  kind: string,
  left: string,
  width: string,
  widthPx: number,
  onOpen: (bar: TimelineBar, btn: HTMLElement) => void,
): HTMLElement {
  const btn = el('button', {
    className: `timeline-bar timeline-cat-${b.colourKey}${b.upcoming ? ' is-upcoming' : ''}${b.widened ? ' is-widened' : ''}${b.clampedLeft ? ' is-clamped-left' : ''}`,
  });
  btn.type = 'button';
  btn.style.left = left;
  btn.style.width = width;
  btn.setAttribute(
    'aria-label',
    `${b.name}, ${kind}, ${b.category}, starts ${formatDay(b.start)}, ends ${formatDay(b.end)}`,
  );

  btn.addEventListener('click', () => onOpen(b, btn));
  btn.appendChild(el('span', { className: 'timeline-bar-label', text: b.name }));
  if (widthPx >= CHIP_MIN_PX) {
    const chip = el('span', { className: 'timeline-bar-chip countdown' });
    chip.dataset.deadline = String(b.upcoming ? b.start : b.end);
    chip.dataset.countdownLabel = b.upcoming ? 'starts in' : '';
    btn.appendChild(chip);
  }
  return btn;
}

/** Real start/end in the server's fixed-offset zone ("Oct 13, 2026, 4:00 AM"). */
function formatInZone(unix: number, offsetHours: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
    new Date((unix + offsetHours * 3600) * 1000),
  );
}

/**
 * The bar detail panel. Opening moves focus into it; Escape or Close hides it
 * and returns focus to the bar that opened it. Shows the real dates, never the
 * widened drawn width.
 */
function createDetailPanel(host: HTMLElement, region: Region, offset: number) {
  let origin: HTMLElement | null = null;
  let panel: HTMLElement | null = null;

  function close(): void {
    panel?.remove();
    panel = null;
    origin?.focus();
    origin = null;
  }

  function open(bar: TimelineBar, btn: HTMLElement): void {
    panel?.remove();
    origin = btn;
    const sign = offset < 0 ? '-' : '+';
    const zone = `${region} server, UTC${sign}${Math.abs(offset)}`;

    const p = el('section', { className: 'timeline-panel' });
    p.tabIndex = -1;
    p.setAttribute('role', 'region');
    p.setAttribute('aria-label', `Details: ${bar.name}`);
    p.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    });

    const head = el('div', { className: 'timeline-panel-head' });
    head.appendChild(el('h3', { text: bar.name }));
    const closeBtn = el('button', { className: 'timeline-panel-close', text: 'Close' });
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', close);
    head.appendChild(closeBtn);
    p.appendChild(head);

    const dl = el('dl', { className: 'timeline-panel-facts' });
    const fact = (term: string, value: string) => {
      dl.appendChild(el('dt', { text: term }));
      dl.appendChild(el('dd', { text: value }));
    };
    fact('Type', `${KIND_LABELS[bar.kind].singular}, ${bar.category}`);
    fact('Starts', formatInZone(bar.start, offset));
    fact('Ends', formatInZone(bar.end, offset));
    fact('Times shown in', zone);
    p.appendChild(dl);

    p.appendChild(
      bar.upcoming ? renderCountdownRow('starts in', bar.start) : renderCountdownRow('ends in', bar.end),
    );

    if (bar.event) p.appendChild(renderEventCard(bar.event, region));

    const link = el('a', { className: 'timeline-panel-wiki', text: 'Wiki page ↗' });
    link.href = bar.wikiUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    p.appendChild(link);

    panel = p;
    host.appendChild(p);
    p.focus();
  }

  return { open };
}
