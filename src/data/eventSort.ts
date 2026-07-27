/**
 * Pure sort orders for the Events tab. DOM-free — `resolveRegionUnix` is a
 * pure helper despite living in ui/. `wikiIndex` is the event's position in
 * `[...current, ...upcoming]`, which IS wiki order: the index page lists
 * Current then Upcoming.
 */
import type { EventInfo, EventStatus, Region } from '../types.ts';
import { resolveRegionUnix } from '../ui/eventCard.ts';

export type EventSortOrder = 'wiki' | 'time' | 'name';

export const DEFAULT_EVENT_SORT: EventSortOrder = 'wiki';

export function isEventSortOrder(value: unknown): value is EventSortOrder {
  return value === 'wiki' || value === 'time' || value === 'name';
}

export interface SortableEvent {
  ev: EventInfo;
  wikiIndex: number;
}

const STATUS_RANK: Record<EventStatus, number> = { active: 0, upcoming: 1, ended: 2, unknown: 3 };

/** The instant that matters for `time` order, and which way it sorts:
 * active → end ascending (most urgent first), upcoming → start ascending,
 * ended → end DESCENDING (most recently ended first), unknown → no time. */
function timeKey(ev: EventInfo, region: Region): { value: number | null; dir: 1 | -1 } {
  switch (ev.status) {
    case 'active':
      return { value: resolveRegionUnix(ev.endUnix, region), dir: 1 };
    case 'upcoming':
      return { value: resolveRegionUnix(ev.startUnix, region), dir: 1 };
    case 'ended':
      return { value: resolveRegionUnix(ev.endUnix, region), dir: -1 };
    default:
      return { value: null, dir: 1 };
  }
}

function byName(a: SortableEvent, b: SortableEvent): number {
  return a.ev.name.localeCompare(b.ev.name) || a.wikiIndex - b.wikiIndex;
}

function byTime(a: SortableEvent, b: SortableEvent, region: Region): number {
  const rank = STATUS_RANK[a.ev.status] - STATUS_RANK[b.ev.status];
  if (rank !== 0) return rank;
  const ka = timeKey(a.ev, region);
  const kb = timeKey(b.ev, region);
  if (ka.value !== kb.value) {
    // Missing times sink to the bottom of their status rank.
    if (ka.value === null) return 1;
    if (kb.value === null) return -1;
    return (ka.value - kb.value) * ka.dir;
  }
  return byName(a, b);
}

/** Returns a new array; the input is not mutated. */
export function sortEvents(items: SortableEvent[], order: EventSortOrder, region: Region): SortableEvent[] {
  const sorted = [...items];
  switch (order) {
    case 'name':
      sorted.sort(byName);
      break;
    case 'time':
      sorted.sort((a, b) => byTime(a, b, region));
      break;
    default:
      sorted.sort((a, b) => a.wikiIndex - b.wikiIndex);
  }
  return sorted;
}
