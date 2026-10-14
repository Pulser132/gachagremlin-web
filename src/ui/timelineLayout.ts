/**
 * Pure layout for the Timeline tab: current + upcoming Events and Banners in,
 * dated bars out. No DOM and no clock — `now` is injected, and positions are
 * fractions of the axis span so the view alone decides pixels.
 */
import { getGame } from '../data/wiki/games.ts';
import { wikiPageUrl } from '../data/wiki/fetch.ts';
import { categorizeEvent } from '../data/eventCategories.ts';
import type { BannerInfo, EventInfo, GameBanners, GameEvents, Region } from '../types.ts';
import { resolveRegionUnix } from './eventCard.ts';

export const DAY = 86400;
/** Axis never spans fewer days than this, however little is scheduled. */
export const MIN_SPAN_DAYS = 30;
/** Every bar is drawn at least this wide so short items stay tappable. */
export const MIN_BAR_PX = 44;
/** Horizontal room an axis "MM-DD" label needs; narrower days label every Nth gridline. */
export const TICK_LABEL_MIN_PX = 48;
/** Breathing room kept between two bars sharing a lane. */
const LANE_GAP_PX = 6;
/** Room kept to the right of every bar for its remaining-time chip ("starts in 12d 04h 05m"). */
export const CHIP_RESERVE_PX = 150;

export type TimelineKind = 'events' | 'banners';

/** Display names per kind: plural for lane headers, singular for labels. */
export const KIND_LABELS: Record<TimelineKind, { plural: string; singular: string }> = {
  events: { plural: 'Events', singular: 'Event' },
  banners: { plural: 'Banners', singular: 'Banner' },
};

export interface TimelineInput {
  events: GameEvents;
  /** `null` = this game has no banner data (the view shows a note). */
  banners: GameBanners | null;
  region: Region;
  /** Fixed UTC offset (hours) of the selected server; sets the day gridlines. */
  utcOffsetHours: number;
  /** IANA zone of the visitor. When set, gridlines and the now label use it
   * instead of the server offset; bar instants are unaffected. */
  localTimeZone?: string | null;
  /** Unix seconds. */
  now: number;
  lookbackDays: number;
  pxPerDay: number;
}

export interface TimelineTick {
  unix: number;
  /** Fraction of the span. */
  x: number;
  /** "MM-DD" in the axis zone. */
  label: string;
  /** False when the gridline is drawn but its label is dropped to avoid overlap. */
  labelled: boolean;
}

export interface TimelineBar {
  id: string;
  kind: TimelineKind;
  name: string;
  /** Text category: event category label or banner category label. */
  category: string;
  /** Class-friendly colour key (`ingame` | `web` | `other` | `banner`). */
  colourKey: string;
  /** Real dates for the chosen region, never the widened ones. */
  start: number;
  end: number;
  /** Fractions of the span. */
  x: number;
  w: number;
  /** Drawn wider than the real window to reach the minimum width. */
  widened: boolean;
  /** Began before the left edge; the view draws a "continues from before" notch. */
  clampedLeft: boolean;
  imageUrl: string | null;
  upcoming: boolean;
  wikiUrl: string;
  /** The source Event, so the detail panel can reuse the existing event card. */
  event: EventInfo | null;
  /** The source Banner, so the detail panel can hide that dated run. */
  banner: BannerInfo | null;
}

export interface TimelineLane {
  kind: TimelineKind;
  label: string;
  /** Packed rows; bars within a row never overlap. */
  rows: TimelineBar[][];
}

export interface TimelineTba {
  kind: TimelineKind;
  name: string;
  reason: string;
}

export interface TimelineLayout {
  spanStart: number;
  spanEnd: number;
  spanDays: number;
  ticks: TimelineTick[];
  nowX: number;
  /** "HH:MM" of `now` in the axis zone. */
  nowLabel: string;
  lanes: TimelineLane[];
  tba: TimelineTba[];
}

const EVENT_CATEGORY_LABEL: Record<string, string> = { ingame: 'In Game', web: 'Web', other: 'Other' };

interface Candidate {
  kind: TimelineKind;
  id: string;
  name: string;
  category: string;
  colourKey: string;
  imageUrl: string | null;
  upcoming: boolean;
  wikiUrl: string;
  event: EventInfo | null;
  banner: BannerInfo | null;
  start: number | null;
  end: number | null;
  fetchedCurrent: boolean;
}

function eventCandidate(ev: EventInfo, fetchedCurrent: boolean, region: Region): Candidate {
  const key = categorizeEvent(ev);
  return {
    kind: 'events',
    id: `event:${ev.game}:${ev.title}`,
    name: ev.name,
    category: EVENT_CATEGORY_LABEL[key],
    colourKey: key,
    imageUrl: ev.imageUrl,
    upcoming: !fetchedCurrent,
    wikiUrl: wikiPageUrl(getGame(ev.game).host, ev.title),
    event: ev,
    banner: null,
    start: resolveRegionUnix(ev.startUnix, region),
    end: resolveRegionUnix(ev.endUnix, region),
    fetchedCurrent,
  };
}

function bannerCandidate(b: BannerInfo, label: string, fetchedCurrent: boolean, region: Region): Candidate {
  return {
    kind: 'banners',
    id: `banner:${b.game}:${b.title}`,
    name: b.name,
    category: label,
    colourKey: 'banner',
    imageUrl: b.imageUrl,
    upcoming: !fetchedCurrent,
    wikiUrl: b.wikiUrl,
    event: null,
    banner: b,
    start: resolveRegionUnix(b.startUnix, region),
    end: resolveRegionUnix(b.endUnix, region),
    fetchedCurrent,
  };
}

function collect(input: TimelineInput): Candidate[] {
  const { events, banners, region } = input;
  const out: Candidate[] = [];
  for (const ev of events.current) out.push(eventCandidate(ev, true, region));
  for (const ev of events.upcoming) out.push(eventCandidate(ev, false, region));
  if (banners) {
    for (const s of banners.current) for (const b of s.banners) out.push(bannerCandidate(b, s.label, true, region));
    for (const s of banners.upcoming) for (const b of s.banners) out.push(bannerCandidate(b, s.label, false, region));
  }
  return out;
}

/** Why an item can't be drawn, or null when it can. */
function tbaReason(c: Candidate, now: number): string | null {
  if (c.start === null && c.end === null) return 'No dates announced';
  if (c.start === null || c.end === null) return 'Only one date announced';
  if (c.start >= c.end) return 'Dates look wrong';
  if (c.end < now) return c.fetchedCurrent ? 'End date looks out of date' : 'Dates look wrong';
  return null;
}

/** Seconds the IANA zone is ahead of UTC at `unix` (DST-aware). */
function zoneOffsetSeconds(timeZone: string, unix: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(unix * 1000));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) / 1000;
  return asUtc - Math.floor(unix);
}

/** Offset resolver for the axis zone: the local zone when given, else the fixed server offset. */
export function axisOffset(utcOffsetHours: number, localTimeZone?: string | null): (unix: number) => number {
  return localTimeZone ? (unix) => zoneOffsetSeconds(localTimeZone, unix) : () => utcOffsetHours * 3600;
}

/** "HH:MM" of `unix` in the axis zone. */
export function clockLabel(unix: number, offsetAt: (unix: number) => number): string {
  const d = new Date((unix + offsetAt(unix)) * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function dayLabel(wallUnix: number): string {
  const d = new Date(wallUnix * 1000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function packRows(bars: TimelineBar[], gapFraction: number): TimelineBar[][] {
  const rows: TimelineBar[][] = [];
  const rowEnds: number[] = [];
  const sorted = [...bars].sort((a, b) => a.start - b.start || a.end - b.end || a.name.localeCompare(b.name));
  for (const bar of sorted) {
    let i = rowEnds.findIndex((end) => end + gapFraction <= bar.x);
    if (i === -1) {
      i = rows.length;
      rows.push([]);
      rowEnds.push(0);
    }
    rows[i].push(bar);
    rowEnds[i] = bar.x + bar.w;
  }
  return rows;
}

export function layoutTimeline(input: TimelineInput): TimelineLayout {
  const { now, lookbackDays, pxPerDay, utcOffsetHours, localTimeZone } = input;
  const offsetAt = axisOffset(utcOffsetHours, localTimeZone);
  const spanStart = now - lookbackDays * DAY;

  const drawable: (Candidate & { start: number; end: number })[] = [];
  const tba: TimelineTba[] = [];
  for (const c of collect(input)) {
    const reason = tbaReason(c, now);
    if (reason) tba.push({ kind: c.kind, name: c.name, reason });
    else drawable.push(c as Candidate & { start: number; end: number });
  }

  const latestEnd = drawable.reduce((m, c) => Math.max(m, c.end), 0);
  // The last bar's chip sits past its right edge, so the axis runs far enough to hold it.
  const chipSeconds = (CHIP_RESERVE_PX / pxPerDay) * DAY;
  const spanEnd = Math.max(latestEnd + chipSeconds, spanStart + MIN_SPAN_DAYS * DAY);
  const span = spanEnd - spanStart;
  const spanDays = span / DAY;
  const minW = MIN_BAR_PX / (spanDays * pxPerDay);

  const bars: TimelineBar[] = drawable.map((c) => {
    const clampedLeft = c.start < spanStart;
    const x = (Math.max(c.start, spanStart) - spanStart) / span;
    const real = (c.end - Math.max(c.start, spanStart)) / span;
    const widened = real < minW;
    return {
      id: c.id,
      kind: c.kind,
      name: c.name,
      category: c.category,
      colourKey: c.colourKey,
      start: c.start,
      end: c.end,
      x,
      w: widened ? minW : real,
      widened,
      clampedLeft,
      imageUrl: c.imageUrl,
      upcoming: c.upcoming,
      wikiUrl: c.wikiUrl,
      event: c.event,
      banner: c.banner,
    };
  });

  const gap = (LANE_GAP_PX + CHIP_RESERVE_PX) / (spanDays * pxPerDay);
  const lanes: TimelineLane[] = [];
  for (const kind of ['events', 'banners'] as const) {
    const ofKind = bars.filter((b) => b.kind === kind);
    if (ofKind.length > 0) lanes.push({ kind, label: KIND_LABELS[kind].plural, rows: packRows(ofKind, gap) });
  }

  // Day gridlines at the axis zone's midnight (not the 04:00 reset). Walk
  // wall-clock days so DST-length days stay correct in a local zone.
  const ticks: TimelineTick[] = [];
  const labelEvery = Math.max(1, Math.ceil(TICK_LABEL_MIN_PX / pxPerDay));
  for (let wall = Math.ceil((spanStart + offsetAt(spanStart)) / DAY) * DAY; ; wall += DAY) {
    // `wall` is local midnight read as UTC; subtract the offset in force at that
    // midnight (found by a second pass) to get the real instant.
    const unix = wall - offsetAt(wall - offsetAt(wall));
    if (unix > spanEnd) break;
    const index = ticks.length;
    ticks.push({ unix, x: (unix - spanStart) / span, label: dayLabel(wall), labelled: index % labelEvery === 0 });
  }

  return { spanStart, spanEnd, spanDays, ticks, nowX: (now - spanStart) / span, nowLabel: clockLabel(now, offsetAt), lanes, tba };
}
