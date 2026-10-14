// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusTimelineBar, renderTimelineView, type HideStatus } from '../src/ui/timelineView.ts';
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

const bars = (v: HTMLElement) => [...v.querySelectorAll<HTMLButtonElement>('button.timeline-bar')];
const key = 'gachagremlin:eventPrefs:genshin';

function mount(e: EventInfo[], onHide = vi.fn()) {
  const view = renderTimelineView('genshin', events(e), banners(), 'America', NOW_S * 1000, { onHide });
  document.body.innerHTML = '';
  document.body.appendChild(view);
  return { view, onHide };
}

afterEach(() => localStorage.clear());

describe('timeline hide button', () => {
  it('puts an Event hide button after Close, labelled for all reruns, and reports it', () => {
    const { view, onHide } = mount([ev('Ev', NOW_S, NOW_S + 5 * DAY)]);
    bars(view)[0].click();
    const buttons = [...view.querySelectorAll<HTMLButtonElement>('.timeline-panel button')];
    const hide = buttons.find((b) => b.classList.contains('timeline-panel-hide'))!;
    expect(hide.textContent).toBe('Hide Ev — all reruns');
    expect(buttons.indexOf(hide)).toBeGreaterThan(buttons.findIndex((b) => b.classList.contains('timeline-panel-close')));
    hide.click();
    expect(onHide).toHaveBeenCalledWith(expect.objectContaining({ kind: 'event', name: 'Ev' }));
  });

  it('labels a Banner hide as this run only, with the title in the accessible name', () => {
    const { view, onHide } = mount([ev('Ev', NOW_S, NOW_S + 5 * DAY)]);
    bars(view)[1].click();
    const hide = view.querySelector<HTMLButtonElement>('.timeline-panel-hide')!;
    expect(hide.textContent).toBe('Hide this banner');
    expect(hide.getAttribute('aria-label')).toBe('Hide Luna/x — this run only');
    hide.click();
    expect(onHide).toHaveBeenCalledWith(expect.objectContaining({ kind: 'banner', title: 'Luna/x' }));
  });

  it('has no hide button when no onHide is supplied', () => {
    const view = renderTimelineView('genshin', events([ev('Ev', NOW_S, NOW_S + DAY)]), null, 'America', NOW_S * 1000);
    bars(view)[0].click();
    expect(view.querySelector('.timeline-panel-hide')).toBeNull();
  });

  it('closes the panel and names the next bar in start order, else null', () => {
    const { view, onHide } = mount([ev('A', NOW_S, NOW_S + DAY), ev('B', NOW_S + DAY, NOW_S + 2 * DAY)]);
    const byName = (n: string) => bars(view).find((b) => b.textContent === n)!;
    byName('A').click();
    view.querySelector<HTMLButtonElement>('.timeline-panel-hide')!.click();
    expect(view.querySelector('.timeline-panel')).toBeNull();
    // Start order: A and the Luna banner both start now (A ends first), then B.
    expect(onHide.mock.calls[0][0].nextBarId).toBe(byName('Luna').dataset.barId);
    byName('B').click(); // last in start order
    view.querySelector<HTMLButtonElement>('.timeline-panel-hide')!.click();
    expect(onHide.mock.calls[1][0].nextBarId).toBeNull();
  });
});

describe('next bar after a hide', () => {
  it('follows start order and skips reruns the hide removes', () => {
    const { view, onHide } = mount([
      ev('Late', NOW_S + 14 * DAY, NOW_S + 15 * DAY),
      ev('Rerun', NOW_S + 11 * DAY, NOW_S + 12 * DAY),
      ev('Rerun', NOW_S + 12 * DAY, NOW_S + 13 * DAY),
      ev('Mid', NOW_S + 13 * DAY, NOW_S + 14 * DAY),
    ].map((e, i) => ({ ...e, title: `${e.name} ${i}` })));
    const first = bars(view).find((b) => b.dataset.start === String(NOW_S + 11 * DAY) && b.textContent === 'Rerun')!;
    first.click();
    view.querySelector<HTMLButtonElement>('.timeline-panel-hide')!.click();
    const next = bars(view).find((b) => b.dataset.barId === onHide.mock.calls[0][0].nextBarId)!;
    expect(next.textContent).toBe('Mid');
  });
});

describe('focusTimelineBar', () => {
  it('focuses the bar by id, else the scroller', () => {
    const { view } = mount([ev('A', NOW_S, NOW_S + DAY)]);
    focusTimelineBar(view, bars(view)[0].dataset.barId!);
    expect(document.activeElement).toBe(bars(view)[0]);
    focusTimelineBar(view, null);
    expect(document.activeElement).toBe(view.querySelector('.timeline-scroll'));
    focusTimelineBar(view, 'gone');
    expect(document.activeElement).toBe(view.querySelector('.timeline-scroll'));
  });
});

describe('hidden-count note', () => {
  it('is absent when nothing is hidden', () => {
    const { view } = mount([ev('Ev', NOW_S, NOW_S + DAY)]);
    expect(view.querySelector('.timeline-hidden-note')).toBeNull();
  });

  it('counts hidden rules, not bars, and names the right tab', () => {
    localStorage.setItem(key, JSON.stringify({ hiddenNames: ['ev'] }));
    let { view } = mount([ev('Ev', NOW_S, NOW_S + DAY), ev('Keep', NOW_S, NOW_S + DAY)]);
    expect(view.querySelector('.timeline-hidden-note')?.textContent).toBe(
      '1 item hidden. Un-hide them from the Hidden list on the Events tab.',
    );
    localStorage.setItem(key, JSON.stringify({ hiddenBanners: ['luna/x'] }));
    ({ view } = mount([ev('Keep', NOW_S, NOW_S + DAY)]));
    expect(view.querySelector('.timeline-hidden-note')?.textContent).toContain('on the Banners tab.');
    localStorage.setItem(key, JSON.stringify({ hiddenNames: ['ev'], hiddenBanners: ['luna/x'] }));
    ({ view } = mount([ev('Ev', NOW_S, NOW_S + DAY)]));
    expect(view.querySelector('.timeline-hidden-note')?.textContent).toBe(
      '2 items hidden. Un-hide them from the Hidden list on the Events or Banners tab.',
    );
    expect(view.querySelector('[aria-live],[role=status]')).toBeNull();
  });

  it('counts one rule once when it hides several reruns', () => {
    localStorage.setItem(key, JSON.stringify({ hiddenNames: ['ev'] }));
    const { view } = mount([ev('Ev', NOW_S, NOW_S + DAY), ev('Ev', NOW_S + 3 * DAY, NOW_S + 4 * DAY), ev('Ev', NOW_S + 6 * DAY, NOW_S + 7 * DAY)]);
    expect(view.querySelector('.timeline-hidden-note')?.textContent).toContain('1 item hidden.');
  });

  it('does not count hidden items that would not have drawn (undated)', () => {
    localStorage.setItem(key, JSON.stringify({ hiddenNames: ['mystery'] }));
    const { view } = mount([ev('Mystery', null, null)]);
    expect(view.querySelector('.timeline-hidden-note')).toBeNull();
  });
});

describe('hide status bar', () => {
  const status = (over: Partial<HideStatus> = {}): HideStatus => ({
    text: 'Hid Ev (all reruns).', announce: false, onUndo: vi.fn(), onDismiss: vi.fn(), ...over,
  });
  const mountWith = (hideStatus?: HideStatus) => {
    const view = renderTimelineView('genshin', events([ev('Ev', NOW_S, NOW_S + DAY)]), banners(), 'America', NOW_S * 1000, { hideStatus });
    document.body.innerHTML = '';
    document.body.appendChild(view);
    return view;
  };

  it('is absent with no status, and is the only live region when present', () => {
    expect(mountWith().querySelector('[role=status]')).toBeNull();
    const view = mountWith(status());
    expect(view.querySelectorAll('[role=status], [aria-live]')).toHaveLength(1);
    expect(view.querySelector('[role=status]')?.textContent).toContain('Hid Ev (all reruns).');
  });

  it('has keyboard-reachable Undo and Dismiss buttons that call back', () => {
    const s = status();
    const view = mountWith(s);
    const [undo, dismiss] = [...view.querySelectorAll<HTMLButtonElement>('[role=status] button')];
    expect([undo.textContent, dismiss.textContent]).toEqual(['Undo', 'Dismiss']);
    expect(undo.type).toBe('button');
    undo.click();
    expect(s.onUndo).toHaveBeenCalled();
    dismiss.click();
    expect(s.onDismiss).toHaveBeenCalled();
    expect(view.querySelector('[role=status]')).toBeNull();
    expect(document.activeElement).toBe(view.querySelector('.timeline-scroll'));
  });

  it('offers no Undo when the hide added no rule', () => {
    const view = mountWith(status({ onUndo: undefined }));
    expect([...view.querySelectorAll('[role=status] button')].map((b) => b.textContent)).toEqual(['Dismiss']);
  });

  it('fills an announced region after it is attached, so it is spoken', async () => {
    const view = mountWith(status({ announce: true }));
    const region = view.querySelector('[role=status]')!;
    expect(region.textContent).not.toContain('Hid Ev');
    await Promise.resolve();
    expect(region.textContent).toContain('Hid Ev (all reruns).');
  });

  it('keeps focus in the view when nothing is left to draw', () => {
    const view = renderTimelineView('genshin', events([]), null, 'America', NOW_S * 1000, { hideStatus: status() });
    document.body.innerHTML = '';
    document.body.appendChild(view);
    expect(view.querySelector('.timeline-scroll')).toBeNull();
    focusTimelineBar(view, null);
    expect(view.contains(document.activeElement)).toBe(true);
  });

  it('reports the hidden bar id on the hide request', () => {
    const { view, onHide } = mount([ev('Ev', NOW_S, NOW_S + 5 * DAY)]);
    bars(view)[0].click();
    view.querySelector<HTMLButtonElement>('.timeline-panel-hide')!.click();
    expect(onHide.mock.calls[0][0].barId).toBe(bars(view)[0].dataset.barId);
  });
});
