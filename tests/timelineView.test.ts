// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderTimelineView } from '../src/ui/timelineView.ts';
import type { BannerInfo, EventInfo, GameBanners, GameEvents, RegionUnix } from '../src/types.ts';

const DAY = 86400;
const NOW_S = 100 * DAY;
const all = (n: number): RegionUnix => ({ America: n, Europe: n, Asia: n, SAR: n });

function ev(name: string, start: number | null, end: number | null): EventInfo {
  return {
    game: 'genshin', title: name, name, type: 'In-game', group: '', status: 'active', globalTime: false,
    reward: '', rewardType: '', characters: [], description: '', hoyolabLinks: [], durationText: [],
    requirements: [], imageUrl: null, startWalltime: null, endWalltime: null,
    startUnix: start === null ? null : all(start), endUnix: end === null ? null : all(end),
  };
}

const events = (current: EventInfo[]): GameEvents => ({ current, upcoming: [], fetchedAt: 0 });

function banners(): GameBanners {
  const b: BannerInfo = {
    game: 'genshin', title: 'Luna/x', name: 'Luna', status: 'active', featured5Star: [], featured4Star: [],
    imageUrl: null, startUnix: all(NOW_S), endUnix: all(NOW_S + 10 * DAY), wikiUrl: 'https://x',
  };
  return { current: [{ key: 'character', label: 'Character Event Wish', banners: [b] }], upcoming: [], fetchedAt: 0 };
}

describe('renderTimelineView', () => {
  it('renders a button per dated Event and Banner, Events lane first', () => {
    const view = renderTimelineView('genshin', events([ev('Ev', NOW_S, NOW_S + 5 * DAY)]), banners(), 'America', NOW_S * 1000);
    const buttons = [...view.querySelectorAll('button.timeline-bar')];
    expect(buttons.map((b) => b.querySelector('.timeline-bar-label')?.textContent)).toEqual(['Ev', 'Luna']);
    expect(view.querySelectorAll('.timeline-lane-header')[0].textContent).toBe('Events');
    expect(buttons[0].getAttribute('aria-label')).toContain('Ev');
  });

  it('lists undated items under Dates TBA', () => {
    const view = renderTimelineView('genshin', events([ev('Mystery', null, null)]), banners(), 'America', NOW_S * 1000);
    expect(view.querySelector('.timeline-tba')?.textContent).toContain('Mystery');
  });

  it('shows the missing-banner note when the game has no banner data', () => {
    const view = renderTimelineView('hsr', events([ev('Ev', NOW_S, NOW_S + DAY)]), null, 'America', NOW_S * 1000);
    expect(view.querySelector('.timeline-note')?.textContent).toBe("Banners aren't available for this game yet");
  });

  it('moves bars when the region changes, from the same data', () => {
    const e = ev('Ev', 0, 0);
    e.startUnix = { America: NOW_S + 2 * DAY, Europe: NOW_S + DAY, Asia: NOW_S, SAR: NOW_S };
    e.endUnix = all(NOW_S + 9 * DAY);
    const data = events([e]);
    const left = (r: 'America' | 'Asia') =>
      renderTimelineView('genshin', data, null, r, NOW_S * 1000).querySelector<HTMLElement>('button.timeline-bar')!.style.left;
    expect(left('America')).not.toBe(left('Asia'));
  });

  it('makes the scroller focusable', () => {
    const view = renderTimelineView('genshin', events([ev('Ev', NOW_S, NOW_S + DAY)]), null, 'America', NOW_S * 1000);
    expect(view.querySelector('.timeline-scroll')?.getAttribute('tabindex')).toBe('0');
  });

  it('flags a bar that began before the window as continuing from before', () => {
    const view = renderTimelineView('genshin', events([ev('Old', NOW_S - 20 * DAY, NOW_S + 3 * DAY)]), null, 'America', NOW_S * 1000);
    expect(view.querySelector('button.timeline-bar')?.classList.contains('is-clamped-left')).toBe(true);
  });

  it('notes an empty banner listing on a game that has banner data wired', () => {
    const empty: GameBanners = { current: [], upcoming: [], fetchedAt: 0 };
    const view = renderTimelineView('zzz', events([ev('Ev', NOW_S, NOW_S + DAY)]), empty, 'America', NOW_S * 1000);
    expect(view.querySelector('.timeline-note')?.textContent).toBe('No banners are currently listed on the wiki.');
  });
});
