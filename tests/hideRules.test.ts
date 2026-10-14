import { describe, expect, it } from 'vitest';
import { applyHideRules, type HidePrefs } from '../src/data/hideRules.ts';
import type { BannerInfo, EventInfo, GameBanners, GameEvents } from '../src/types.ts';

function ev(name: string, type = 'In-game'): EventInfo {
  return {
    game: 'genshin', title: name, name, type, group: '', status: 'active', globalTime: false,
    reward: '', rewardType: '', characters: [], description: '', hoyolabLinks: [], durationText: [],
    requirements: [], imageUrl: null, startWalltime: null, endWalltime: null, startUnix: null, endUnix: null,
  };
}
function bn(title: string): BannerInfo {
  return {
    game: 'genshin', title, name: title.split('/')[0], status: 'active', featured5Star: [], featured4Star: [],
    imageUrl: null, startUnix: null, endUnix: null, wikiUrl: 'https://x',
  };
}
const none: HidePrefs = { hiddenNames: [], hiddenCategories: [], hiddenBanners: [] };
const events = (current: EventInfo[], upcoming: EventInfo[] = []): GameEvents => ({ current, upcoming, fetchedAt: 0 });
const banners = (current: BannerInfo[], upcoming: BannerInfo[] = []): GameBanners => ({
  current: [{ key: 'c', label: 'C', banners: current }],
  upcoming: [{ key: 'c', label: 'C', banners: upcoming }],
  fetchedAt: 0,
});

describe('applyHideRules', () => {
  it('passes everything through with no rules', () => {
    const r = applyHideRules(events([ev('A')]), banners([bn('X/2026-01-01')]), none);
    expect(r.hiddenCount).toBe(0);
    expect(r.hiddenKinds).toEqual([]);
    expect(r.events.current).toHaveLength(1);
  });

  it('a name rule hides every rerun, current and upcoming', () => {
    const r = applyHideRules(
      events([ev('Battle: Chess')], [ev('Battle: Winds'), ev('Other')]),
      null,
      { ...none, hiddenNames: ['battle'] },
    );
    expect(r.events.current).toEqual([]);
    expect(r.events.upcoming.map((e) => e.name)).toEqual(['Other']);
    expect(r.hiddenCount).toBe(2);
    expect(r.hiddenKinds).toEqual(['event']);
  });

  it('a hidden section hides its events', () => {
    const r = applyHideRules(events([ev('A', 'Web'), ev('B', 'In-game')]), null, { ...none, hiddenCategories: ['web'] });
    expect(r.events.current.map((e) => e.name)).toEqual(['B']);
    expect(r.hiddenKinds).toEqual(['event']);
  });

  it('a banner rule hides one dated run, not the series', () => {
    const r = applyHideRules(events([]), banners([bn('Luna/2026-01-01')], [bn('Luna/2026-03-01')]), {
      ...none, hiddenBanners: ['luna/2026-01-01'],
    });
    expect(r.banners!.current[0].banners).toEqual([]);
    expect(r.banners!.upcoming[0].banners).toHaveLength(1);
    expect(r.hiddenCount).toBe(1);
    expect(r.hiddenKinds).toEqual(['banner']);
  });

  it('reports both kinds and a combined count', () => {
    const r = applyHideRules(events([ev('A')]), banners([bn('L/2026-01-01')]), {
      ...none, hiddenNames: ['a'], hiddenBanners: ['l/2026-01-01'],
    });
    expect(r.hiddenCount).toBe(2);
    expect(r.hiddenKinds).toEqual(['event', 'banner']);
  });

  it('keeps a null banner set null', () => {
    expect(applyHideRules(events([]), null, none).banners).toBeNull();
  });
});
