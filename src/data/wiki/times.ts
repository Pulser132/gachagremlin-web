/**
 * Wall-clock -> per-region Unix conversion and event time classification.
 *
 * Ported from the bot's `src/gachagremlin/wiki/times.py` (GachaGremlin
 * repo). In-game events end at the SAME wall-clock time on every server, so
 * one (Y,M,D,h,m) tuple becomes a different Unix instant per region by
 * applying that region's fixed UTC offset. Web/login events instead usually
 * run on ONE global timestamp — `isGlobalTime` flags those from the event
 * type.
 */
import type { Region, RegionUnix } from '../../types.ts';

export type Walltime = [year: number, month: number, day: number, hour: number, minute: number];

// Event `type` values that usually mean one global timestamp instead of
// per-server wall-clock times (heuristic — verify against Duration wording).
const GLOBAL_TYPE_HINTS = ['web', 'login', 'community', 'in-person', 'special'];

const DATETIME_RE = /(\d{4})[/-](\d{2})[/-](\d{2})\s+(\d{2}):(\d{2})/g;

/**
 * Convert a wall-clock time in a fixed UTC offset zone to Unix seconds.
 * `Date.UTC` normalizes out-of-range fields (e.g. hour - offset going
 * negative rolls back a day), so no manual date-rollover logic is needed.
 */
export function toUnix(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  offsetHours: number,
): number {
  return Math.floor(Date.UTC(y, mo - 1, d, h - offsetHours, mi) / 1000);
}

export function perServer(
  walltime: Walltime | null,
  servers: Partial<Record<Region, number>>,
): RegionUnix | null {
  if (!walltime) return null;
  const [y, mo, d, h, mi] = walltime;
  const out: RegionUnix = {};
  for (const [region, offset] of Object.entries(servers) as [Region, number][]) {
    out[region] = toUnix(y, mo, d, h, mi, offset);
  }
  return out;
}

function matchWalltime(text: string): Walltime | null {
  const m = new RegExp(DATETIME_RE.source).exec(text);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
}

/**
 * Return [start, end] as wall-clock component tuples.
 *
 * Prefer the human-readable Duration line (matches the in-game display);
 * fall back to the infobox time_start/time_end fields. The offset stored
 * with those fields is ignored on purpose: each server's own offset is
 * applied later in perServer().
 */
export function findWalltimes(
  fields: Record<string, string>,
  durationBullets: string[],
): [Walltime | null, Walltime | null] {
  const text = durationBullets.join(' ');
  const displayed: Walltime[] = [];
  for (const m of text.matchAll(new RegExp(DATETIME_RE.source, 'g'))) {
    displayed.push([Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])]);
  }

  let start: Walltime | null = null;
  let end: Walltime | null = null;
  if (displayed.length >= 2) {
    start = displayed[0];
    end = displayed[displayed.length - 1];
  } else if (displayed.length === 1) {
    end = displayed[0];
  }

  if (start === null) {
    start = matchWalltime(fields.time_start ?? '');
  }
  if (end === null) {
    end = matchWalltime(fields.time_end ?? '');
  }
  return [start, end];
}

export function isGlobalTime(eventType: string): boolean {
  const t = (eventType ?? '').toLowerCase();
  return GLOBAL_TYPE_HINTS.some((hint) => t.includes(hint));
}

/**
 * Global-time events run on ONE instant everywhere, but `perServer` still
 * applied each region's offset arithmetic to the walltime (a faithful port
 * of the bot's `times.py`, which has the same raw per-region numbers). The
 * bot corrects this at its DB-write layer (`db/store.py::_region_columns`),
 * writing the Asia/UTC+8 value — the convention HoYo campaigns quote — into
 * every region column. This site has no DB, so `wikiSource.ts` calls this
 * as the equivalent ingestion-time correction.
 */
export function normalizeGlobalRegionUnix(unix: RegionUnix | null): RegionUnix | null {
  if (!unix) return unix;
  const canonical = unix.Asia ?? Object.values(unix)[0];
  if (canonical === undefined) return unix;
  const out: RegionUnix = {};
  for (const region of Object.keys(unix) as Region[]) {
    out[region] = canonical;
  }
  return out;
}

/** 'ended' once the LAST server finishes; 'upcoming' until the FIRST starts. */
export function statusOf(
  startUnix: RegionUnix | null,
  endUnix: RegionUnix | null,
  now: number,
): 'active' | 'upcoming' | 'ended' | 'unknown' {
  if (!endUnix || Object.keys(endUnix).length === 0) return 'unknown';
  const endValues = Object.values(endUnix) as number[];
  if (now > Math.max(...endValues)) return 'ended';
  if (startUnix && Object.keys(startUnix).length > 0) {
    const startValues = Object.values(startUnix) as number[];
    if (now < Math.min(...startValues)) return 'upcoming';
  }
  return 'active';
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const DAY_RANGE_RE = /^\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*[—–-]\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*$/;

/** A calendar day as a sortable YYYYMMDD number, or null for a bad month. */
function dayKey(month: string, day: string, year: string): number | null {
  const m = MONTHS.indexOf(month.toLowerCase());
  return m === -1 ? null : Number(year) * 10000 + (m + 1) * 100 + Number(day);
}

/**
 * Whether `now` falls inside a day-level date range such as
 * "August 26, 2026 — September 12, 2026" (long month names, em/en dash or
 * hyphen, any whitespace), start and end both inclusive. Returns null when
 * the text isn't that shape, so callers can fail open.
 */
export function dayRangeContains(text: string, now: Date): boolean | null {
  const m = DAY_RANGE_RE.exec(text.replace(/\s+/g, ' '));
  if (!m) return null;
  const start = dayKey(m[1], m[2], m[3]);
  const end = dayKey(m[4], m[5], m[6]);
  if (start === null || end === null) return null;
  const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  return start <= today && today <= end;
}
