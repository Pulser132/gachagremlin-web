import { describe, expect, it } from 'vitest';
import { isEventSortOrder, sortEvents, type SortableEvent } from '../src/data/eventSort.ts';
import type { EventInfo, EventStatus, RegionUnix } from '../src/types.ts';

function makeEvent(overrides: Partial<EventInfo> = {}): EventInfo {
  return {
    game: 'genshin',
    title: 'Test',
    name: 'Test Event',
    type: '',
    group: '',
    status: 'active',
    globalTime: false,
    reward: '',
    rewardType: '',
    characters: [],
    description: '',
    hoyolabLinks: [],
    durationText: [],
    requirements: [],
    imageUrl: null,
    startWalltime: null,
    endWalltime: null,
    startUnix: null,
    endUnix: null,
    ...overrides,
  };
}

function unix(seconds: number): RegionUnix {
  return { America: seconds };
}

let counter = 0;
function item(
  name: string,
  status: EventStatus,
  times: { start?: number; end?: number } = {},
  wikiIndex = counter++,
): SortableEvent {
  return {
    ev: makeEvent({
      name,
      status,
      startUnix: times.start !== undefined ? unix(times.start) : null,
      endUnix: times.end !== undefined ? unix(times.end) : null,
    }),
    wikiIndex,
  };
}

function names(items: SortableEvent[]): string[] {
  return items.map((i) => i.ev.name);
}

describe('wiki order', () => {
  it('sorts by wikiIndex and does not mutate the input', () => {
    const input = [item('B', 'active', {}, 2), item('A', 'active', {}, 0), item('C', 'ended', {}, 1)];
    const sorted = sortEvents(input, 'wiki', 'America');
    expect(names(sorted)).toEqual(['A', 'C', 'B']);
    expect(names(input)).toEqual(['B', 'A', 'C']);
  });
});

describe('name order', () => {
  it('interleaves statuses alphabetically with wikiIndex tiebreak', () => {
    const dupA = item('Alpha', 'ended', {}, 5);
    const dupB = item('Alpha', 'active', {}, 1);
    const sorted = sortEvents([item('Zeta', 'active'), dupA, item('beta', 'upcoming'), dupB], 'name', 'America');
    expect(names(sorted)).toEqual(['Alpha', 'Alpha', 'beta', 'Zeta']);
    expect(sorted[0]).toBe(dupB); // lower wikiIndex first among equal names
  });
});

describe('time order', () => {
  it('ranks statuses active < upcoming < ended < unknown', () => {
    const sorted = sortEvents(
      [item('U', 'unknown'), item('E', 'ended', { end: 10 }), item('Up', 'upcoming', { start: 5 }), item('A', 'active', { end: 20 })],
      'time',
      'America',
    );
    expect(names(sorted)).toEqual(['A', 'Up', 'E', 'U']);
  });

  it('orders active by soonest end and upcoming by soonest start', () => {
    const sorted = sortEvents(
      [
        item('active-late', 'active', { end: 300 }),
        item('active-soon', 'active', { end: 100 }),
        item('up-late', 'upcoming', { start: 900 }),
        item('up-soon', 'upcoming', { start: 400 }),
      ],
      'time',
      'America',
    );
    expect(names(sorted)).toEqual(['active-soon', 'active-late', 'up-soon', 'up-late']);
  });

  it('orders ended by most recently ended first', () => {
    const sorted = sortEvents(
      [item('ended-old', 'ended', { end: 100 }), item('ended-recent', 'ended', { end: 500 })],
      'time',
      'America',
    );
    expect(names(sorted)).toEqual(['ended-recent', 'ended-old']);
  });

  it('sinks missing times to the bottom of their status rank', () => {
    const sorted = sortEvents(
      [
        item('active-no-end', 'active'),
        item('active-timed', 'active', { end: 50 }),
        item('up-no-start', 'upcoming', { end: 60 }),
        item('up-timed', 'upcoming', { start: 10, end: 60 }),
      ],
      'time',
      'America',
    );
    expect(names(sorted)).toEqual(['active-timed', 'active-no-end', 'up-timed', 'up-no-start']);
  });

  it('breaks time ties by name then wikiIndex', () => {
    const first = item('Same', 'active', { end: 100 }, 0);
    const second = item('Same', 'active', { end: 100 }, 9);
    const sorted = sortEvents([second, item('Also', 'active', { end: 100 }), first], 'time', 'America');
    expect(names(sorted)).toEqual(['Also', 'Same', 'Same']);
    expect(sorted[1]).toBe(first);
  });
});

describe('isEventSortOrder', () => {
  it('accepts the three orders and rejects junk', () => {
    expect(isEventSortOrder('wiki')).toBe(true);
    expect(isEventSortOrder('time')).toBe(true);
    expect(isEventSortOrder('name')).toBe(true);
    expect(isEventSortOrder('bogus')).toBe(false);
    expect(isEventSortOrder(null)).toBe(false);
  });
});
