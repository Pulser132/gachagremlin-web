// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderBannersView } from '../src/ui/bannersView.ts';
import type { BannerCategorySection, BannerInfo, GameBanners } from '../src/types.ts';

function makeBanner(overrides: Partial<BannerInfo> = {}): BannerInfo {
  return {
    game: 'genshin',
    title: 'Somnias a Luna/2026-07-21',
    name: 'Somnias a Luna',
    status: 'active',
    featured5Star: ['Columbina'],
    featured4Star: ['Jahoda', 'Ororon', 'Sethos'],
    imageUrl: 'https://static.wikia.nocookie.net/somnias.png',
    startUnix: { America: 1000, Europe: 1000, Asia: 1000, SAR: 1000 },
    endUnix: { America: 2000, Europe: 2000, Asia: 3000, SAR: 2000 },
    wikiUrl: 'https://genshin-impact.fandom.com/wiki/Somnias_a_Luna/2026-07-21',
    ...overrides,
  };
}

function makeSection(overrides: Partial<BannerCategorySection> = {}): BannerCategorySection {
  return { key: 'character', label: 'Character Event Wish', banners: [makeBanner()], ...overrides };
}

function makeGameBanners(overrides: Partial<GameBanners> = {}): GameBanners {
  return { current: [makeSection()], upcoming: [], fetchedAt: 1_000_000, ...overrides };
}

describe('renderBannersView category sections', () => {
  it('renders one heading per category, in payload order, with cards nested under it', () => {
    const banners = makeGameBanners({
      current: [
        makeSection({ label: 'Character Event Wish', banners: [makeBanner({ title: 'a' })] }),
        makeSection({ label: 'Weapon Event Wish', banners: [makeBanner({ title: 'b' }), makeBanner({ title: 'c' })] }),
      ],
    });
    const view = renderBannersView('genshin', banners, 'America');

    const sections = view.querySelectorAll('.banner-category-section');
    expect(sections).toHaveLength(2);
    expect(sections[0].querySelector('h2')?.textContent).toBe('Character Event Wish');
    expect(sections[0].querySelectorAll('.event-card')).toHaveLength(1);
    expect(sections[1].querySelector('h2')?.textContent).toBe('Weapon Event Wish');
    expect(sections[1].querySelectorAll('.event-card')).toHaveLength(2);
  });
});

describe('renderBannersView card content', () => {
  it('shows the series name, Featured 5★, Featured 4★, and art', () => {
    const view = renderBannersView('genshin', makeGameBanners(), 'America');
    const card = view.querySelector('.event-card')!;

    expect(card.querySelector('.event-name')?.textContent).toBe('Somnias a Luna');
    expect(card.querySelector('.banner-featured-5')?.textContent).toContain('Columbina');
    expect(card.querySelector('.banner-featured-4')?.textContent).toContain('Jahoda');
    const art = card.querySelector<HTMLImageElement>('.banner-live-art');
    expect(art).not.toBeNull();
    expect(art!.src).toBe('https://static.wikia.nocookie.net/somnias.png');
  });

  it('gives the art meaningful alt text (unlike the decorative Event card art)', () => {
    const view = renderBannersView('genshin', makeGameBanners(), 'America');
    const art = view.querySelector<HTMLImageElement>('.banner-live-art')!;
    expect(art.alt).toContain('Somnias a Luna');
  });

  it('renders no art element when the Banner has no image', () => {
    const banners = makeGameBanners({ current: [makeSection({ banners: [makeBanner({ imageUrl: null })] })] });
    const view = renderBannersView('genshin', banners, 'America');
    expect(view.querySelector('.banner-live-art')).toBeNull();
  });

  it('links out to the Banner\'s own wiki page', () => {
    const view = renderBannersView('genshin', makeGameBanners(), 'America');
    const link = view.querySelector<HTMLAnchorElement>('.event-link a')!;
    expect(link.href).toBe('https://genshin-impact.fandom.com/wiki/Somnias_a_Luna/2026-07-21');
  });
});

describe('renderBannersView countdowns', () => {
  it('carries the deadline for the selected region and changes when the region changes', () => {
    const banners = makeGameBanners();
    const americaView = renderBannersView('genshin', banners, 'America');
    expect(americaView.querySelector<HTMLElement>('.countdown')?.dataset.deadline).toBe('2000');

    const asiaView = renderBannersView('genshin', banners, 'Asia');
    expect(asiaView.querySelector<HTMLElement>('.countdown')?.dataset.deadline).toBe('3000');
  });

  it('renders "not announced" copy instead of a countdown when the end time is missing', () => {
    const banners = makeGameBanners({
      current: [makeSection({ banners: [makeBanner({ status: 'unknown', endUnix: null })] })],
    });
    const view = renderBannersView('genshin', banners, 'America');
    expect(view.querySelector('.countdown')).toBeNull();
    expect(view.querySelector('.event-times-missing')?.textContent).toMatch(/not announced/i);
  });

  it('visibly marks an ended Banner instead of showing a countdown', () => {
    const banners = makeGameBanners({ current: [makeSection({ banners: [makeBanner({ status: 'ended' })] })] });
    const view = renderBannersView('genshin', banners, 'America');

    expect(view.querySelector('.event-status-badge')?.textContent).toBe('ended');
    expect(view.querySelector('.countdown')).toBeNull();
    expect(view.querySelector('.banner-live-ended')?.textContent).toBe('Ended');
  });
});

describe('renderBannersView empty and upcoming states', () => {
  it('renders an empty state, not blank chrome, when nothing is current or upcoming', () => {
    const view = renderBannersView('genshin', makeGameBanners({ current: [], upcoming: [] }), 'America');
    expect(view.querySelector('.empty')).not.toBeNull();
    expect(view.textContent).toMatch(/no banners/i);
  });

  it('renders no Upcoming section when upcoming is empty (Genshin\'s normal state)', () => {
    const view = renderBannersView('genshin', makeGameBanners({ upcoming: [] }), 'America');
    expect(view.querySelector('.banners-upcoming')).toBeNull();
  });

  it('renders an Upcoming section, with its own headings, when non-empty', () => {
    const banners = makeGameBanners({
      upcoming: [makeSection({ label: 'Character Event Wish', banners: [makeBanner({ status: 'upcoming' })] })],
    });
    const view = renderBannersView('genshin', banners, 'America');
    const upcoming = view.querySelector('.banners-upcoming');
    expect(upcoming).not.toBeNull();
    expect(upcoming!.querySelector('h2')?.textContent).toBe('Upcoming');
    expect(upcoming!.querySelector('.banner-category-section h3')?.textContent).toBe('Character Event Wish');
  });
});

describe('renderBannersView unsupported game panel', () => {
  it('renders a "not wired up yet" panel when passed null banners', () => {
    const view = renderBannersView('hsr', null, 'Asia');
    expect(view.querySelector('.banners-unsupported')).not.toBeNull();
    expect(view.textContent).toMatch(/honkai.*star.*rail.*isn't wired up yet/i);
  });
});
