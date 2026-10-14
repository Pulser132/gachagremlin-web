import { describe, expect, it } from 'vitest';
import { layoutTimeline, MIN_BAR_PX, type TimelineInput } from '../src/ui/timelineLayout.ts';
import type { BannerInfo, EventInfo, GameBanners, GameEvents, RegionUnix } from '../src/types.ts';

const DAY = 86400;
// Day 100 (UTC), 10:00.
const NOW = 100 * DAY + 10 * 3600;

const all = (n: number): RegionUnix => ({ America: n, Europe: n, Asia: n, SAR: n });

function ev(name: string, start: number | null, end: number | null, over: Partial<EventInfo> = {}): EventInfo {
  return {
    game: 'genshin', title: name, name, type: 'In-game', group: '', status: 'active', globalTime: false,
    reward: '', rewardType: '', characters: [], description: '', hoyolabLinks: [], durationText: [],
    requirements: [], imageUrl: null, startWalltime: null, endWalltime: null,
    startUnix: start === null ? null : all(start), endUnix: end === null ? null : all(end),
    ...over,
  };
}

function bn(name: string, start: number, end: number): BannerInfo {
  return {
    game: 'genshin', title: `${name}/x`, name, status: 'active', featured5Star: [], featured4Star: [],
    imageUrl: null, startUnix: all(start), endUnix: all(end), wikiUrl: 'https://x',
  };
}

function input(over: Partial<TimelineInput> & { cur?: EventInfo[]; up?: EventInfo[] } = {}): TimelineInput {
  const events: GameEvents = { current: over.cur ?? [], upcoming: over.up ?? [], fetchedAt: 0 };
  return { events, banners: null, region: 'America', utcOffsetHours: 0, now: NOW, lookbackDays: 7, pxPerDay: 30, ...over };
}

describe('layoutTimeline span and now line', () => {
  it('spans now-7d to a 30 day minimum when little is scheduled', () => {
    const out = layoutTimeline(input({ cur: [ev('A', NOW, NOW + 2 * DAY)] }));
    expect(out.spanStart).toBe(NOW - 7 * DAY);
    expect(out.spanEnd).toBe(NOW - 7 * DAY + 30 * DAY);
    expect(out.nowX).toBeCloseTo(7 / 30);
  });

  it('extends to the latest end when it is past the minimum', () => {
    const out = layoutTimeline(input({ cur: [ev('A', NOW, NOW + 40 * DAY)] }));
    expect(out.spanEnd).toBe(NOW + 40 * DAY);
    expect(out.spanDays).toBe(47);
  });

  it('puts gridlines on server midnight for the region offset', () => {
    // spanStart = day 93 10:00 UTC. UTC midnight next = day 94 00:00; for UTC-5 it is day 94 05:00 UTC.
    const utc = layoutTimeline(input());
    expect(utc.ticks[0].unix).toBe(94 * DAY);
    const america = layoutTimeline(input({ utcOffsetHours: -5 }));
    expect(america.ticks[0].unix).toBe(94 * DAY + 5 * 3600);
    const asia = layoutTimeline(input({ utcOffsetHours: 8 }));
    expect(asia.ticks[0].unix).toBe(93 * DAY + 16 * 3600);
    expect(asia.ticks[1].unix - asia.ticks[0].unix).toBe(DAY);
    expect(utc.ticks[0].x).toBeCloseTo((94 * DAY - utc.spanStart) / (30 * DAY));
  });

  it('puts Europe (UTC+1) gridlines on its midnight and nowX is region-independent', () => {
    const eu = layoutTimeline(input({ utcOffsetHours: 1 }));
    expect(eu.ticks[0].unix).toBe(93 * DAY + 23 * 3600);
    expect(eu.nowX).toBeCloseTo(7 / 30);
  });

  it('labels ticks with the date in the axis zone', () => {
    const out = layoutTimeline(input({ utcOffsetHours: 8 }));
    // 93*86400 + 16h UTC is day 94 00:00 in UTC+8; day 94 of 1970 = April 5.
    expect(out.ticks[0].label).toBe('04-05');
  });

  it('moves bars with the region without needing new data', () => {
    const e = ev('A', 0, 0, {
      startUnix: { America: NOW + 5 * 3600, Europe: NOW, Asia: NOW - 3600 },
      endUnix: { America: NOW + DAY, Europe: NOW + DAY, Asia: NOW + DAY },
    });
    const am = layoutTimeline(input({ cur: [e], region: 'America' }));
    const eu = layoutTimeline(input({ cur: [e], region: 'Europe' }));
    expect(am.lanes[0].rows[0][0].start).toBe(NOW + 5 * 3600);
    expect(eu.lanes[0].rows[0][0].start).toBe(NOW);
  });
});

describe('layoutTimeline data trust', () => {
  it('draws only start < end; everything else goes to Dates TBA', () => {
    const out = layoutTimeline(
      input({
        cur: [
          ev('ok', NOW, NOW + DAY),
          ev('nulls', null, null),
          ev('half-start', NOW, null),
          ev('half-end', null, NOW + DAY),
          ev('degenerate', NOW, NOW),
          ev('reversed', NOW + DAY, NOW),
        ],
      }),
    );
    expect(out.lanes[0].rows.flat().map((b) => b.name)).toEqual(['ok']);
    expect(out.tba.map((t) => t.name).sort()).toEqual(['degenerate', 'half-end', 'half-start', 'nulls', 'reversed']);
  });

  it('sends a stale current item (end before now) to Dates TBA', () => {
    const out = layoutTimeline(input({ cur: [ev('stale', NOW - 3 * DAY, NOW - DAY)] }));
    expect(out.lanes).toEqual([]);
    expect(out.tba).toEqual([{ kind: 'events', name: 'stale', reason: expect.any(String) }]);
  });

  it('carries banners in their own lane after events', () => {
    const banners: GameBanners = {
      current: [{ key: 'character', label: 'Character Event Wish', banners: [bn('Luna', NOW, NOW + 10 * DAY)] }],
      upcoming: [],
      fetchedAt: 0,
    };
    const out = layoutTimeline(input({ cur: [ev('A', NOW, NOW + DAY)], banners }));
    expect(out.lanes.map((l) => l.kind)).toEqual(['events', 'banners']);
    expect(out.lanes[1].rows[0][0].category).toBe('Character Event Wish');
  });
});

describe('layoutTimeline bars and lanes', () => {
  it('clamps an item that began before the window to the left edge', () => {
    const out = layoutTimeline(input({ cur: [ev('old', NOW - 20 * DAY, NOW + 3 * DAY)] }));
    const bar = out.lanes[0].rows[0][0];
    expect(bar.clampedLeft).toBe(true);
    expect(bar.x).toBe(0);
    expect(bar.start).toBe(NOW - 20 * DAY);
    expect(bar.w).toBeCloseTo(10 / 30);
  });

  it('widens a short bar to the minimum width and flags it', () => {
    const out = layoutTimeline(input({ cur: [ev('blip', NOW, NOW + 3600)] }));
    const bar = out.lanes[0].rows[0][0];
    expect(bar.widened).toBe(true);
    expect(bar.w * out.spanDays * 30).toBeCloseTo(MIN_BAR_PX);
    expect(bar.end).toBe(NOW + 3600);
  });

  it('packs overlapping bars into separate rows and reuses a row once free', () => {
    const out = layoutTimeline(
      input({
        cur: [
          ev('A', NOW, NOW + 5 * DAY),
          ev('B', NOW + 2 * DAY, NOW + 8 * DAY),
          ev('C', NOW + 6 * DAY, NOW + 9 * DAY),
        ],
      }),
    );
    const rows = out.lanes[0].rows.map((r) => r.map((b) => b.name));
    expect(rows).toEqual([['A', 'C'], ['B']]);
  });

  it('uses the drawn (widened) width when packing', () => {
    // A is 1h long but drawn 44px (~1.5 days) wide, so B starting 1 day later cannot share its row.
    const out = layoutTimeline(input({ cur: [ev('A', NOW, NOW + 3600), ev('B', NOW + DAY, NOW + 3 * DAY)] }));
    expect(out.lanes[0].rows).toHaveLength(2);
  });

  it('marks upcoming items', () => {
    const out = layoutTimeline(input({ up: [ev('soon', NOW + DAY, NOW + 4 * DAY)] }));
    expect(out.lanes[0].rows[0][0].upcoming).toBe(true);
  });
});
