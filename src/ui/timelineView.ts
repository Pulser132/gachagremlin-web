import { applyHideRules } from '../data/hideRules.ts';
import { bannerHideKey, eventHideKey, loadHidePrefs } from '../data/eventPrefs.ts';
import { getGame } from '../data/wiki/games.ts';
import type { GameBanners, GameEvents, GameKey, Region } from '../types.ts';
import { applyBarColours, sessionColourSource, type ColourSource, type TintTarget } from './barColour.ts';
import { renderCountdownRow } from './countdown.ts';
import { renderEventCard } from './eventCard.ts';
import { DAY, KIND_LABELS, axisOffset, clockLabel, layoutTimeline, type TimelineBar, type TimelineLayout } from './timelineLayout.ts';

const LOOKBACK_DAYS = 7;
const PX_PER_DAY_DESKTOP = 30;
const PX_PER_DAY_PHONE = 18;
/** Where the now line sits on initial scroll, as a fraction of the viewport. */
const NOW_VIEWPORT_FRACTION = 0.15;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  return node;
}

/** What the player asked to hide from a bar's detail panel. */
export type HideRequest = (
  | { kind: 'event'; name: string }
  | { kind: 'banner'; title: string }
) & {
  /** Bar to focus after the re-render (next in tab order), or null for the scroller. */
  nextBarId: string | null;
  /** The bar being hidden, so an undo can focus it again. */
  barId: string;
};

/** The status bar for the most recent hide; the caller keeps it in memory. */
export interface HideStatus {
  text: string;
  /** Speak it: true only on the render straight after the hide. */
  announce: boolean;
  /** Absent when the hide added no rule, so there is nothing to undo. */
  onUndo?: () => void;
  onDismiss: () => void;
}

export interface TimelineViewOptions {
  /** Writes the hide rule and re-renders; without it the panel has no hide button. */
  onHide?: (request: HideRequest) => void;
  /** The status bar above the chart; the Timeline's only live region. */
  hideStatus?: HideStatus;
  /** Show gridlines and the now label in the visitor's timezone. */
  localTime?: boolean;
  /** IANA zone used in local mode; defaults to the browser's. */
  localTimeZone?: string;
  onLocalTimeChange?: (on: boolean) => void;
  /** Resolves a bar colour from art; injectable for tests. */
  colourSource?: ColourSource;
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** A date in the axis zone: the server's fixed offset, or the visitor's IANA zone. */
function formatZoned(unix: number, offsetHours: number, localTimeZone: string | undefined, withTime: boolean): string {
  const style = withTime ? ({ dateStyle: 'medium', timeStyle: 'short' } as const) : ({ dateStyle: 'medium' } as const);
  if (localTimeZone) return new Intl.DateTimeFormat(undefined, { ...style, timeZone: localTimeZone }).format(new Date(unix * 1000));
  return new Intl.DateTimeFormat(undefined, { ...style, timeZone: 'UTC' }).format(new Date((unix + offsetHours * 3600) * 1000));
}

/** Whole days left, rounded up so the text only changes once a day. */
function daysLeftText(start: number, end: number, now: number): string {
  if (now >= end) return 'ended';
  const days = Math.ceil(((now < start ? start : end) - now) / DAY);
  const unit = days === 1 ? 'day' : 'days';
  return now < start ? `starts in ${days} ${unit}` : `${days} ${unit} left`;
}

/** The bar's accessible name; the tick rewrites it only if this string changes. */
function barLabel(btn: HTMLElement, now: number, offset: number, localTimeZone: string | undefined): string {
  const start = Number(btn.dataset.start);
  const end = Number(btn.dataset.end);
  const verb = now < start ? 'starts' : 'ends';
  const date = formatZoned(now < start ? start : end, offset, localTimeZone, false);
  const cues = btn.dataset.cues ? `, ${btn.dataset.cues}` : '';
  return `${btn.dataset.head}, ${verb} ${date}, ${daysLeftText(start, end, now)}${cues}`;
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
  allEvents: GameEvents,
  allBanners: GameBanners | null,
  region: Region,
  nowMs: number = Date.now(),
  opts: TimelineViewOptions = {},
): HTMLElement {
  // Hide rules are read on every render so the Timeline tracks the Events tab.
  const { events, banners } = applyHideRules(allEvents, allBanners, loadHidePrefs(game));
  const localTimeZone = opts.localTime ? (opts.localTimeZone ?? browserTimeZone()) : null;
  const pxPerDay = isPhone() ? PX_PER_DAY_PHONE : PX_PER_DAY_DESKTOP;
  const offset = getGame(game).servers[region] ?? 0;
  const layout = layoutTimeline({
    events,
    banners,
    region,
    utcOffsetHours: offset,
    localTimeZone,
    now: Math.floor(nowMs / 1000),
    lookbackDays: LOOKBACK_DAYS,
    pxPerDay,
  });

  const hiddenKinds = hiddenBarKinds(allEvents, allBanners, layout, {
    region, utcOffsetHours: offset, localTimeZone, now: Math.floor(nowMs / 1000), lookbackDays: LOOKBACK_DAYS, pxPerDay,
  });

  const wrap = el('div', { className: 'timeline-view' });
  wrap.dataset.pxPerDay = String(pxPerDay);

  const sign = offset < 0 ? '-' : '+';
  const toolbar = el('div', { className: 'timeline-toolbar' });
  const toggle = el('label', { className: 'timeline-local-toggle' });
  const box = el('input');
  box.type = 'checkbox';
  box.checked = !!opts.localTime;
  box.addEventListener('change', () => opts.onLocalTimeChange?.(box.checked));
  toggle.append(box, ' Show as local time');
  toolbar.appendChild(toggle);
  toolbar.appendChild(
    el('p', {
      className: 'timeline-zone',
      text: localTimeZone ? `Local time: ${localTimeZone}` : `Server time: ${region} (UTC${sign}${Math.abs(offset)})`,
    }),
  );
  const nowBtn = el('button', { className: 'timeline-now-btn', text: 'Jump to now' });
  nowBtn.type = 'button';
  nowBtn.addEventListener('click', () => scrollTimelineToNow(wrap));
  toolbar.appendChild(nowBtn);
  wrap.appendChild(toolbar);

  if (opts.hideStatus) wrap.appendChild(renderHideStatus(opts.hideStatus));

  if (hiddenKinds.count > 0) {
    const tabs = hiddenKinds.events && hiddenKinds.banners ? 'Events or Banners' : hiddenKinds.events ? 'Events' : 'Banners';
    wrap.appendChild(
      el('p', {
        className: 'timeline-note timeline-hidden-note',
        text: `${hiddenKinds.count} items hidden. Un-hide them from the Hidden list on the ${tabs} tab.`,
      }),
    );
  }

  if (banners === null) {
    wrap.appendChild(el('p', { className: 'timeline-note', text: "Banners aren't available for this game yet" }));
  } else if (![...banners.current, ...banners.upcoming].some((s) => s.banners.length > 0)) {
    wrap.appendChild(el('p', { className: 'timeline-note', text: 'No banners are currently listed on the wiki.' }));
  }

  if (layout.lanes.length === 0) {
    wrap.appendChild(el('p', { className: 'empty', text: 'Nothing with known dates to show on the timeline.' }));
  } else {
    const panelHost = el('div', { className: 'timeline-panel-host' });
    const panel = createDetailPanel(panelHost, region, offset, localTimeZone ?? undefined, opts.onHide);
    const skip = el('a', { className: 'timeline-skip', text: 'Skip timeline' });
    skip.href = '#timeline-end';
    skip.addEventListener('click', (e) => {
      e.preventDefault();
      wrap.querySelector<HTMLElement>('.timeline-end')?.focus();
    });
    wrap.appendChild(skip);
    const nowSec = Math.floor(nowMs / 1000);
    const tintTargets: TintTarget[] = [];
    wrap.appendChild(
      renderScroller(layout, pxPerDay, (bar, btn) => panel.open(bar, btn), (btn) =>
        barLabel(btn, nowSec, offset, localTimeZone ?? undefined), tintTargets,
      ),
    );
    // Fire and forget: bars paint in their category colour first, then tint.
    void applyBarColours(tintTargets, opts.colourSource ?? sessionColourSource);
    wrap.appendChild(panelHost);
    const end = el('div', { className: 'timeline-end' });
    end.id = 'timeline-end';
    end.tabIndex = -1;
    wrap.appendChild(end);
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

  // What updateTimelineNow needs to move the now line without a re-layout.
  wrap.dataset.spanStart = String(layout.spanStart);
  wrap.dataset.utcOffsetHours = String(offset);
  if (localTimeZone) wrap.dataset.localTimeZone = localTimeZone;

  return wrap;
}

function renderHideStatus(status: HideStatus): HTMLElement {
  const bar = el('div', { className: 'timeline-hide-status' });
  bar.setAttribute('role', 'status');
  const text = el('span', { className: 'timeline-hide-status-text' });
  // A live region only speaks changes, so insert it empty and fill it once attached.
  if (status.announce) queueMicrotask(() => { text.textContent = status.text; });
  else text.textContent = status.text;
  bar.appendChild(text);
  if (status.onUndo) {
    const undo = el('button', { className: 'timeline-hide-undo', text: 'Undo' });
    undo.type = 'button';
    undo.addEventListener('click', status.onUndo);
    bar.appendChild(undo);
  }
  const dismiss = el('button', { className: 'timeline-hide-dismiss', text: 'Dismiss' });
  dismiss.type = 'button';
  dismiss.addEventListener('click', () => {
    const view = bar.closest<HTMLElement>('.timeline-view');
    status.onDismiss();
    bar.remove();
    // The focused button just left the DOM; keep focus inside the Timeline.
    if (view) focusTimelineBar(view, null);
  });
  bar.appendChild(dismiss);
  return bar;
}

/** The bar after `from` in start order that this hide leaves drawn (a hidden Event takes its reruns with it). */
function nextSurvivingBar(view: ParentNode | null, from: HTMLElement): HTMLElement | undefined {
  const byStart = (a: HTMLElement, b: HTMLElement) =>
    Number(a.dataset.start) - Number(b.dataset.start) ||
    Number(a.dataset.end) - Number(b.dataset.end) ||
    (a.dataset.barId ?? '').localeCompare(b.dataset.barId ?? '');
  const sorted = [...(view?.querySelectorAll<HTMLElement>('button.timeline-bar') ?? [])].sort(byStart);
  return sorted.slice(sorted.indexOf(from) + 1).find((b) => b.dataset.hideKey !== from.dataset.hideKey);
}

/** Counts bars the hide rules removed (those that would otherwise be drawn) and which kinds. */
function hiddenBarKinds(
  allEvents: GameEvents,
  allBanners: GameBanners | null,
  visible: TimelineLayout,
  input: Omit<Parameters<typeof layoutTimeline>[0], 'events' | 'banners'>,
): { count: number; events: boolean; banners: boolean } {
  const shown = new Set(visible.lanes.flatMap((l) => l.rows.flat().map((b) => b.id)));
  const out = { count: 0, events: false, banners: false };
  for (const lane of layoutTimeline({ ...input, events: allEvents, banners: allBanners }).lanes) {
    for (const bar of lane.rows.flat()) {
      if (shown.has(bar.id)) continue;
      out.count++;
      if (bar.kind === 'events') out.events = true;
      else out.banners = true;
    }
  }
  return out;
}

/** Focuses the bar with `barId`; falls back to the scroller, never `document.body`. */
export function focusTimelineBar(view: HTMLElement, barId: string | null): void {
  const bar = barId ? [...view.querySelectorAll<HTMLElement>('button.timeline-bar')].find((b) => b.dataset.barId === barId) : null;
  // With nothing left to draw there is no scroller; stay inside the view rather than fall to the body.
  const target =
    bar ??
    view.querySelector<HTMLElement>('.timeline-scroll') ??
    view.querySelector<HTMLElement>('.timeline-hide-status button, .timeline-local-toggle input');
  if (!target) return;
  // Focus must not move the scroll position the caller just restored; only reveal the bar if it is off-screen.
  target.focus({ preventScroll: true });
  const scroller = view.querySelector<HTMLElement>('.timeline-scroll');
  if (bar && scroller && scroller.clientWidth > 0) {
    const s = scroller.getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    if (r.right < s.left || r.left > s.right) bar.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }
}

/** Moves the now line and rewrites its HH:MM label (only if the text changed).
 * Driven once a minute by `app.ts`; deliberately not an aria-live region. */
export function updateTimelineNow(view: HTMLElement, nowMs: number): void {
  const nowLine = view.querySelector<HTMLElement>('.timeline-now');
  if (!nowLine) return;
  const now = Math.floor(nowMs / 1000);
  const pxPerDay = Number(view.dataset.pxPerDay);
  nowLine.style.left = `${((now - Number(view.dataset.spanStart)) / DAY) * pxPerDay}px`;
  const offsetAt = axisOffset(Number(view.dataset.utcOffsetHours), view.dataset.localTimeZone);
  const label = nowLine.querySelector<HTMLElement>('.timeline-now-label');
  const text = clockLabel(now, offsetAt);
  if (label && label.textContent !== text) label.textContent = text;
  const zone = view.dataset.localTimeZone;
  const hours = Number(view.dataset.utcOffsetHours);
  for (const btn of view.querySelectorAll<HTMLElement>('button.timeline-bar')) {
    const next = barLabel(btn, now, hours, zone);
    if (btn.getAttribute('aria-label') !== next) btn.setAttribute('aria-label', next);
  }
}

/** Scrolls so the now line sits ~15% in from the left. Call once the view is
 * attached; happy-dom/no-layout environments have zero widths and are no-ops. */
export function scrollTimelineToNow(view: HTMLElement): void {
  const scroller = view.querySelector<HTMLElement>('.timeline-scroll');
  const nowLine = view.querySelector<HTMLElement>('.timeline-now');
  if (!scroller || !nowLine) return;
  const nowPx = parseFloat(nowLine.style.left);
  const left = Math.max(0, nowPx - scroller.clientWidth * NOW_VIEWPORT_FRACTION);
  // No animation (PRD): an instant jump is also what reduced-motion asks for.
  scroller.scrollLeft = left;
}

function renderScroller(
  layout: TimelineLayout,
  pxPerDay: number,
  onOpen: (bar: TimelineBar, btn: HTMLElement) => void,
  labelFor: (btn: HTMLElement) => string,
  tintTargets: TintTarget[],
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
    if (tick.labelled) line.appendChild(el('span', { text: tick.label }));
    axis.appendChild(line);
  }
  canvas.appendChild(axis);

  const nowLine = el('div', { className: 'timeline-now' });
  nowLine.style.left = px(layout.nowX);
  nowLine.setAttribute('aria-hidden', 'true');
  nowLine.appendChild(el('span', { className: 'timeline-now-label', text: layout.nowLabel }));
  canvas.appendChild(nowLine);

  for (const lane of layout.lanes) {
    const group = el('div', { className: `timeline-lane timeline-lane-${lane.kind}` });
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', lane.label);
    group.appendChild(el('h2', { className: 'timeline-lane-header', text: lane.label }));
    // One flat container so DOM (tab) order is start time, not packed row.
    const bars = el('div', { className: 'timeline-lane-bars' });
    bars.style.setProperty('--rows', String(lane.rows.length));
    const placed = lane.rows.flatMap((row, rowIndex) => row.map((b) => ({ b, rowIndex })));
    placed.sort((a, c) => a.b.start - c.b.start || a.b.end - c.b.end || a.b.name.localeCompare(c.b.name));
    for (const { b, rowIndex } of placed) {
      const btn = renderBar(b, KIND_LABELS[lane.kind].singular, px(b.x), px(b.w), onOpen, labelFor);
      btn.style.setProperty('--row', String(rowIndex));
      tintTargets.push({ btn, url: b.imageUrl });
      bars.appendChild(btn);
      // Sibling, not child: the time left sits to the right of the bar, outside it.
      const chip = el('span', { className: 'timeline-bar-chip countdown' });
      chip.setAttribute('aria-hidden', 'true'); // the bar's accessible name already says it
      chip.style.left = `calc(${px(b.x + b.w)} + 0.375rem)`;
      chip.style.setProperty('--row', String(rowIndex));
      chip.dataset.deadline = String(b.upcoming ? b.start : b.end);
      chip.dataset.countdownLabel = b.upcoming ? 'starts in' : '';
      bars.appendChild(chip);
    }
    group.appendChild(bars);
    canvas.appendChild(group);
  }

  scroller.appendChild(canvas);
  return scroller;
}

function renderBar(
  b: TimelineBar,
  kind: string,
  left: string,
  width: string,
  onOpen: (bar: TimelineBar, btn: HTMLElement) => void,
  labelFor: (btn: HTMLElement) => string,
): HTMLElement {
  const btn = el('button', {
    className: `timeline-bar timeline-cat-${b.colourKey}${b.upcoming ? ' is-upcoming' : ''}${b.widened ? ' is-widened' : ''}${b.clampedLeft ? ' is-clamped-left' : ''}`,
  });
  btn.type = 'button';
  btn.style.left = left;
  btn.style.width = width;
  btn.dataset.barId = b.id;
  if (b.event) btn.dataset.hideKey = `event:${eventHideKey(b.event.name)}`;
  else if (b.banner) btn.dataset.hideKey = `banner:${bannerHideKey(b.banner.title)}`;
  btn.dataset.head = `${b.name}, ${kind}, ${b.category}`;
  btn.dataset.start = String(b.start);
  btn.dataset.end = String(b.end);
  const cues = [b.widened ? 'drawn wider than its real length' : '', b.clampedLeft ? 'began before the timeline window' : ''];
  btn.dataset.cues = cues.filter(Boolean).join(', ');
  btn.setAttribute('aria-label', labelFor(btn));

  btn.addEventListener('click', () => onOpen(b, btn));
  if (b.imageUrl) {
    // Decorative: the name and dates already carry the meaning. Dropped if it fails to load.
    const art = el('img', { className: 'timeline-bar-art' });
    art.alt = '';
    art.loading = 'lazy';
    art.referrerPolicy = 'no-referrer';
    art.addEventListener('error', () => art.remove());
    art.src = b.imageUrl;
    btn.appendChild(art);
  }
  btn.appendChild(el('span', { className: 'timeline-bar-label', text: b.name }));
  return btn;
}

/**
 * The bar detail panel. Opening moves focus into it; Escape or Close hides it
 * and returns focus to the bar that opened it. Shows the real dates, never the
 * widened drawn width.
 */
function createDetailPanel(
  host: HTMLElement,
  region: Region,
  offset: number,
  localTimeZone?: string,
  onHide?: (request: HideRequest) => void,
) {
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
    const zone = localTimeZone ?? `${region} server, UTC${sign}${Math.abs(offset)}`;

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
    if (onHide) {
      const hideBtn = el('button', { className: 'timeline-panel-hide' });
      hideBtn.type = 'button';
      let request: { kind: 'event'; name: string } | { kind: 'banner'; title: string } | null = null;
      if (bar.event) {
        hideBtn.textContent = `Hide ${bar.name} — all reruns`;
        request = { kind: 'event', name: bar.event.name };
      } else if (bar.banner) {
        hideBtn.textContent = 'Hide this banner';
        hideBtn.setAttribute('aria-label', `Hide ${bar.banner.title} — this run only`);
        request = { kind: 'banner', title: bar.banner.title };
      }
      if (request) {
        const req = request;
        hideBtn.addEventListener('click', () => {
          const next = nextSurvivingBar(host.parentElement, btn);
          panel?.remove();
          panel = null;
          origin = null;
          onHide({ ...req, nextBarId: next?.dataset.barId ?? null, barId: bar.id } as HideRequest);
        });
        p.appendChild(hideBtn);
      }
    }

    const dl = el('dl', { className: 'timeline-panel-facts' });
    const fact = (term: string, value: string) => {
      dl.appendChild(el('dt', { text: term }));
      dl.appendChild(el('dd', { text: value }));
    };
    fact('Type', `${KIND_LABELS[bar.kind].singular}, ${bar.category}`);
    fact('Starts', formatZoned(bar.start, offset, localTimeZone, true));
    fact('Ends', formatZoned(bar.end, offset, localTimeZone, true));
    fact('Times shown in', zone);
    if (bar.widened) fact('Note', 'Drawn wider than its real length so it is easy to tap; the dates above are exact.');
    if (bar.clampedLeft) fact('Note', 'Began before the start of the timeline window.');
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
