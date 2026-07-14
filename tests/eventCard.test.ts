// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventKey, isReminded } from '../src/data/reminders.ts';
import { renderEventCard, resolveRegionUnix } from '../src/ui/eventCard.ts';
import type { EventInfo } from '../src/types.ts';

function makeEvent(overrides: Partial<EventInfo> = {}): EventInfo {
  return {
    game: 'genshin',
    title: 'Test Event (Event)',
    name: 'Test Event',
    type: 'In-Game',
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
    endUnix: { America: 1000, Europe: 1000, Asia: 1000, SAR: 1000 },
    ...overrides,
  };
}

describe('resolveRegionUnix', () => {
  it('returns the requested region when present', () => {
    expect(resolveRegionUnix({ America: 1, Europe: 2, Asia: 3 }, 'Europe')).toBe(2);
  });

  it('falls back to Asia when the region is absent (e.g. SAR on HSR/ZZZ)', () => {
    expect(resolveRegionUnix({ America: 1, Europe: 2, Asia: 3 }, 'SAR')).toBe(3);
  });

  it('falls back to any value when even Asia is absent', () => {
    expect(resolveRegionUnix({ America: 42 }, 'SAR')).toBe(42);
  });

  it('returns null for a null map', () => {
    expect(resolveRegionUnix(null, 'America')).toBeNull();
  });
});

describe('renderEventCard banner', () => {
  it('sets referrerPolicy to no-referrer on the banner image', () => {
    // Regression guard: Fandom's CDN hotlink-blocks any request whose
    // Referer isn't a fandom.com page, returning a 200 placeholder image
    // instead of an error — silently showing the wrong picture with no
    // visible failure. no-referrer is what makes the CDN serve the real
    // image; losing this attribute reintroduces that bug with no crash.
    const card = renderEventCard(makeEvent({ imageUrl: 'https://static.wikia.nocookie.net/foo.png' }), 'America');
    const banner = card.querySelector<HTMLImageElement>('.event-banner');
    expect(banner).not.toBeNull();
    expect(banner!.referrerPolicy).toBe('no-referrer');
    expect(banner!.alt).toBe('');
  });

  it('renders no banner element when the event has no image', () => {
    const card = renderEventCard(makeEvent({ imageUrl: null }), 'America');
    expect(card.querySelector('.event-banner')).toBeNull();
  });
});

describe('renderEventCard reminder bell', () => {
  beforeEach(() => localStorage.clear());

  it('shows a bell on upcoming/active events and toggles the subscription', () => {
    const onToggle = vi.fn();
    const ev = makeEvent({ status: 'upcoming', name: 'Furina Banner', type: 'Character Event Wish' });
    const card = renderEventCard(ev, 'America', onToggle);

    const bell = card.querySelector<HTMLButtonElement>('.event-reminder-bell');
    expect(bell).not.toBeNull();
    expect(bell!.getAttribute('aria-pressed')).toBe('false');

    bell!.click();
    expect(isReminded('genshin', eventKey(ev))).toBe(true);
    expect(bell!.getAttribute('aria-pressed')).toBe('true');
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows no bell on ended or unknown events', () => {
    expect(renderEventCard(makeEvent({ status: 'ended' }), 'America').querySelector('.event-reminder-bell')).toBeNull();
    expect(renderEventCard(makeEvent({ status: 'unknown' }), 'America').querySelector('.event-reminder-bell')).toBeNull();
  });
});
