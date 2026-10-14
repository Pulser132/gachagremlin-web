// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderTimelineView, updateTimelineNow } from '../src/ui/timelineView.ts';
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

  it('draws every gridline but labels only some at narrow day widths', () => {
    const view = renderTimelineView('genshin', events([ev('Ev', NOW_S, NOW_S + 5 * DAY)]), null, 'America', NOW_S * 1000);
    const ticks = [...view.querySelectorAll('.timeline-tick')];
    const labelled = ticks.filter((t) => t.querySelector('span'));
    expect(ticks.length).toBeGreaterThan(labelled.length);
    expect(labelled.length).toBeLessThan(ticks.length);
    expect(labelled.length).toBeGreaterThan(0);
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

  it('puts the remaining-time chip beside every bar, not inside it', () => {
    const view = renderTimelineView(
      'genshin',
      events([ev('Tiny', NOW_S, NOW_S + 3600), ev('Long', NOW_S, NOW_S + 10 * DAY)]),
      null,
      'America',
      NOW_S * 1000,
    );
    const [tiny, long] = [...view.querySelectorAll('button.timeline-bar')];
    expect(view.querySelectorAll('.timeline-bar-chip')).toHaveLength(2);
    expect(view.querySelector('button.timeline-bar .timeline-bar-chip')).toBeNull();
    expect(tiny.querySelector('.timeline-bar-label')?.textContent).toBe('Tiny');
    expect(tiny.classList.contains('is-widened')).toBe(true);
    expect(long.classList.contains('is-widened')).toBe(false);
  });

  it('notes an empty banner listing on a game that has banner data wired', () => {
    const empty: GameBanners = { current: [], upcoming: [], fetchedAt: 0 };
    const view = renderTimelineView('zzz', events([ev('Ev', NOW_S, NOW_S + DAY)]), empty, 'America', NOW_S * 1000);
    expect(view.querySelector('.timeline-note')?.textContent).toBe('No banners are currently listed on the wiki.');
  });

  describe('detail panel', () => {
    function mount(e: EventInfo[] = [ev('Ev', NOW_S, NOW_S + 5 * DAY)]) {
      const view = renderTimelineView('genshin', events(e), banners(), 'America', NOW_S * 1000);
      document.body.innerHTML = '';
      document.body.appendChild(view);
      return view;
    }
    const bars = (v: HTMLElement) => [...v.querySelectorAll<HTMLButtonElement>('button.timeline-bar')];

    it('opens on click with real dates, remaining time, category and wiki link', () => {
      const view = mount([ev('Tiny', NOW_S, NOW_S + 3600)]); // 1h: drawn widened
      bars(view)[0].click();
      const panel = view.querySelector('.timeline-panel')!;
      expect(panel.textContent).toContain('Tiny');
      expect(panel.textContent).toContain('In Game');
      expect(panel.querySelector('[data-deadline]')?.getAttribute('data-deadline')).toBe(String(NOW_S + 3600));
      expect(panel.querySelector<HTMLAnchorElement>('a.timeline-panel-wiki')?.href).toContain('genshin-impact.fandom.com');
      // Real window is 1h, not the widened drawn width.
      const dd = [...panel.querySelectorAll('dd')].map((d) => d.textContent);
      expect(dd[1]).not.toBe(dd[2]);
    });

    it('reaches the existing event card for Events but not Banners', () => {
      const view = mount();
      bars(view)[0].click();
      expect(view.querySelector('.timeline-panel .event-card')).not.toBeNull();
      bars(view)[1].click();
      expect(view.querySelector('.timeline-panel .event-card')).toBeNull();
      expect(view.querySelector<HTMLAnchorElement>('a.timeline-panel-wiki')?.href).toBe('https://x/');
      expect(view.querySelectorAll('.timeline-panel')).toHaveLength(1);
    });

    it('moves focus into the panel and returns it to the bar on Escape', () => {
      const view = mount();
      const bar = bars(view)[0];
      bar.focus();
      bar.click();
      const panel = view.querySelector<HTMLElement>('.timeline-panel')!;
      expect(document.activeElement).toBe(panel);
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(view.querySelector('.timeline-panel')).toBeNull();
      expect(document.activeElement).toBe(bar);
    });

    it('returns focus to the bar via the Close button', () => {
      const view = mount();
      const bar = bars(view)[0];
      bar.click();
      view.querySelector<HTMLButtonElement>('.timeline-panel-close')!.click();
      expect(document.activeElement).toBe(bar);
    });
  });
});

describe('accessibility', () => {
  const render = (e: EventInfo[], b: GameBanners | null = null, opts = {}) =>
    renderTimelineView('genshin', events(e), b, 'America', NOW_S * 1000, opts);

  it('names each bar with name, kind, category, date in the chosen zone and days left', () => {
    const view = render([ev('Ev', NOW_S, NOW_S + 5 * DAY)]);
    const label = view.querySelector('button.timeline-bar')!.getAttribute('aria-label')!;
    expect(label).toMatch(/^Ev, Event, In Game, ends .+, 5 days left$/);
    const tokyo = render([ev('Ev', NOW_S, NOW_S + 3 * 3600)], null, { localTime: true, localTimeZone: 'Asia/Tokyo' });
    expect(tokyo.querySelector('button.timeline-bar')!.getAttribute('aria-label')).toContain('Apr 11, 1970');
    const server = render([ev('Ev', NOW_S, NOW_S + 3 * 3600)]);
    expect(server.querySelector('button.timeline-bar')!.getAttribute('aria-label')).toContain('Apr 10, 1970');
  });

  it('says "starts in" for upcoming bars', () => {
    const view = render([ev('Soon', NOW_S + 3 * DAY, NOW_S + 8 * DAY)]);
    expect(view.querySelector('button.timeline-bar')!.getAttribute('aria-label')).toMatch(/starts .+, starts in 3 days$/);
  });

  it('carries text cues for wider-than-real and continues-from-before', () => {
    const view = render([ev('Tiny', NOW_S, NOW_S + 3600), ev('Old', NOW_S - 20 * DAY, NOW_S + 3 * DAY)]);
    const [old, tiny] = [...view.querySelectorAll('button.timeline-bar')].sort((a) =>
      a.getAttribute('aria-label')!.startsWith('Old') ? -1 : 1,
    );
    expect(tiny.getAttribute('aria-label')).toContain('drawn wider than its real length');
    expect(old.getAttribute('aria-label')).toContain('began before the timeline window');
    (tiny as HTMLElement).click();
    expect(view.querySelector('.timeline-panel')!.textContent).toContain('Drawn wider than its real length');
  });

  it('orders bars within a lane by start time, with lanes in order', () => {
    const view = render(
      [ev('Late', NOW_S + 4 * DAY, NOW_S + 9 * DAY), ev('Early', NOW_S, NOW_S + 10 * DAY), ev('Mid', NOW_S + 2 * DAY, NOW_S + 3 * DAY)],
      banners(),
    );
    const names = [...view.querySelectorAll('button.timeline-bar .timeline-bar-label')].map((n) => n.textContent);
    expect(names).toEqual(['Early', 'Mid', 'Late', 'Luna']);
  });

  it('puts a skip link before the chart that moves focus past it', () => {
    const view = render([ev('Ev', NOW_S, NOW_S + DAY)]);
    document.body.innerHTML = '';
    document.body.appendChild(view);
    const skip = view.querySelector<HTMLAnchorElement>('a.timeline-skip')!;
    expect(skip.compareDocumentPosition(view.querySelector('.timeline-scroll')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    skip.click();
    expect(document.activeElement).toBe(view.querySelector('.timeline-end'));
  });

  it('labels each lane as a group and names the scroller', () => {
    const view = render([ev('Ev', NOW_S, NOW_S + DAY)], banners());
    const groups = [...view.querySelectorAll('[role="group"]')];
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Events', 'Banners']);
    expect(view.querySelector('.timeline-scroll')!.getAttribute('aria-label')).toBeTruthy();
  });

  it('rewrites a bar label on the tick only when its text changes', () => {
    const view = render([ev('Ev', NOW_S, NOW_S + 5 * DAY)]);
    const btn = view.querySelector('button.timeline-bar')!;
    const original = btn.setAttribute.bind(btn);
    let writes = 0;
    btn.setAttribute = (name: string, value: string) => {
      writes++;
      original(name, value);
    };
    updateTimelineNow(view, (NOW_S + 60) * 1000);
    expect(writes).toBe(0);
    expect(btn.getAttribute('aria-label')).toMatch(/5 days left/);
    updateTimelineNow(view, (NOW_S + DAY + 60) * 1000);
    expect(btn.getAttribute('aria-label')).toMatch(/4 days left/);
  });

  it('renders Dates TBA as plain text', () => {
    const view = render([ev('Mystery', null, null)]);
    expect(view.querySelector('.timeline-tba button, .timeline-tba [tabindex]')).toBeNull();
  });
});

describe('local time controls', () => {
  const render = (opts = {}) =>
    renderTimelineView('genshin', events([ev('Ev', NOW_S, NOW_S + 5 * DAY)]), null, 'America', NOW_S * 1000, opts);

  it('defaults to server time with the toggle off', () => {
    const view = render();
    expect(view.querySelector<HTMLInputElement>('.timeline-local-toggle input')!.checked).toBe(false);
    expect(view.querySelector('.timeline-zone')?.textContent).toBe('Server time: America (UTC-5)');
  });

  it('names the browser zone in local mode and calls back on toggle', () => {
    let got: boolean | null = null;
    const view = render({ localTime: true, localTimeZone: 'Asia/Tokyo', onLocalTimeChange: (v: boolean) => (got = v) });
    expect(view.querySelector('.timeline-zone')?.textContent).toBe('Local time: Asia/Tokyo');
    const box = view.querySelector<HTMLInputElement>('.timeline-local-toggle input')!;
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(got).toBe(false);
  });

  it('labels the now line in the active zone and moves it on the minute tick', () => {
    const view = render({ localTime: true, localTimeZone: 'Asia/Tokyo' });
    const line = view.querySelector<HTMLElement>('.timeline-now')!;
    expect(line.querySelector('.timeline-now-label')?.textContent).toBe('09:00');
    const before = parseFloat(line.style.left);
    updateTimelineNow(view, (NOW_S + 3600) * 1000);
    expect(line.querySelector('.timeline-now-label')?.textContent).toBe('10:00');
    expect(parseFloat(line.style.left)).toBeGreaterThan(before);
    expect(view.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });

  it('keeps the tick out of any live region', () => {
    const view = render();
    expect(view.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });

  it('has a keyboard-reachable Jump to now button', () => {
    const btn = render().querySelector<HTMLButtonElement>('.timeline-now-btn')!;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe('Jump to now');
  });

  it('tints a bar from its art and leaves bars whose colour fails on the category colour', async () => {
    const withArt = { ...ev('Art', NOW_S, NOW_S + 5 * DAY), imageUrl: 'https://img/art.png' };
    const broken = { ...ev('Broken', NOW_S, NOW_S + 5 * DAY), imageUrl: 'https://img/bad.png' };
    const colourSource = async (url: string | null) => (url === 'https://img/art.png' ? { bg: '#aa3333', text: '#ffffff' } : null);
    const view = renderTimelineView('genshin', events([withArt, broken]), null, 'America', NOW_S * 1000, { colourSource });
    await new Promise((r) => setTimeout(r, 0));
    const byName = (n: string) =>
      [...view.querySelectorAll<HTMLElement>('button.timeline-bar')].find((b) => b.textContent?.startsWith(n))!;
    expect(byName('Art').style.backgroundColor).not.toBe('');
    expect(byName('Art').style.color).not.toBe('');
    expect(byName('Broken').style.backgroundColor).toBe('');
  });

  it('puts the art inside the bar as a decorative image, and drops it if it fails to load', () => {
    const withArt = { ...ev('Art', NOW_S, NOW_S + 5 * DAY), imageUrl: 'https://img/art.png' };
    const view = renderTimelineView('genshin', events([withArt, ev('Plain', NOW_S, NOW_S + 5 * DAY)]), null, 'America', NOW_S * 1000, {
      colourSource: async () => null,
    });
    const bars = [...view.querySelectorAll<HTMLElement>('button.timeline-bar')];
    const art = bars[0].querySelector<HTMLImageElement>('img.timeline-bar-art')!;
    expect(art.getAttribute('src')).toBe('https://img/art.png');
    expect(art.alt).toBe('');
    expect(bars[1].querySelector('img')).toBeNull();
    art.dispatchEvent(new Event('error'));
    expect(bars[0].querySelector('img')).toBeNull();
  });
});
