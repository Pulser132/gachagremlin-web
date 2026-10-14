import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeNewlines, parseBannerIndex } from '../src/data/wiki/parser.ts';
import { GAME_CONFIGS } from '../src/data/wiki/games.ts';
import { WikiSource } from '../src/data/wiki/wikiSource.ts';
import type { GameBanners } from '../src/types.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');

// Fixtures were saved via a Windows text-mode write, which can carry \r\n;
// normalize the same way fetch.ts normalizes live API responses (see
// tests/parser.test.ts's own `load`).
function load(name: string): string {
  return normalizeNewlines(readFileSync(join(FIXTURES, name), 'utf-8'));
}

const WISH_INDEX_HTML = load('genshin_wish_index.html');
const UNMAPPED_CATEGORY_HTML = load('genshin_wish_index_unmapped_category.html');

const WARP_INDEX_HTML = load('hsr_warp_index.html');

// HSR per-Banner wikitext, keyed by dated page title; fixture names are the
// title with spaces -> `_` and `/` -> `__`.
const HSR_WIKITEXT_BY_TITLE: Record<string, string> = Object.fromEntries(
  readdirSync(FIXTURES)
    .map((f) => /^hsr_(.+)__(\d{4}-\d{2}-\d{2})\.wikitext$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [`${m[1].replace(/_/g, ' ')}/${m[2]}`, load(m[0])]),
);

const EXCLUSIVE_INDEX_HTML = load('zzz_exclusive_channel_index.html');
const W_ENGINE_INDEX_HTML = load('zzz_w-engine_channel_index.html');
// HAND-EDITED variant of the Exclusive Channel listing: the Upcoming run cut
// down to a single Banner. A channel with exactly one concurrent Banner has
// never been seen live, so this shape is synthetic.
const EXCLUSIVE_SINGLE_UPCOMING_HTML = load('zzz_exclusive_channel_index_single_upcoming.html');

const ZZZ_WIKITEXT_BY_TITLE: Record<string, string> = Object.fromEntries(
  readdirSync(FIXTURES)
    .map((f) => /^zzz_(.+)__(\d{4}-\d{2}-\d{2})\.wikitext$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [`${m[1].replace(/_/g, ' ')}/${m[2]}`, load(m[0])]),
);

const WIKITEXT_BY_TITLE: Record<string, string> = {
  ...HSR_WIKITEXT_BY_TITLE,
  ...ZZZ_WIKITEXT_BY_TITLE,
  'Somnias a Luna/2026-07-21': load('genshin_Somnias_a_Luna__2026-07-21.wikitext'),
  'Reign of Serenity/2026-07-21': load('genshin_Reign_of_Serenity__2026-07-21.wikitext'),
  'Epitome Invocation/2026-07-21': load('genshin_Epitome_Invocation__2026-07-21.wikitext'),
  'Test Anniversary Banner/2026-07-01': load('genshin_Test_Anniversary_Banner__2026-07-01.wikitext'),
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

interface StubOptions {
  wishHtml?: string;
  warpHtml?: string;
  exclusiveHtml?: string;
  wEngineHtml?: string;
  /** Listing pages (by `page` param) whose fetch fails outright. */
  failingPages?: string[];
  /** Per-title overrides: a string replaces the default wikitext lookup, and
   * `null` simulates the wiki returning a parse error for that title. */
  wikitextOverrides?: Record<string, string | null>;
  /** When true, every imageinfo lookup resolves as "file missing" (the same
   * shape resolveImageUrl already treats as a non-throwing null result). */
  imagesUnresolvable?: boolean;
}

/** A fetch stub that answers by inspecting URL parameters, exactly like
 * `client.ts`'s `api()` builds them — mirroring the by-URL-parameter
 * stubbing convention in tests/images.test.ts and tests/cloudDrive.test.ts. */
function stubWikiFetch(opts: StubOptions = {}) {
  const calls: URL[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const action = url.searchParams.get('action');
    const page = url.searchParams.get('page');
    const prop = url.searchParams.get('prop');

    if (action === 'parse' && page === 'Wish' && prop === 'text') {
      return jsonResponse({ parse: { title: 'Wish', text: opts.wishHtml ?? WISH_INDEX_HTML } });
    }
    if (action === 'parse' && page === 'Warp' && prop === 'text') {
      return jsonResponse({ parse: { title: 'Warp', text: opts.warpHtml ?? WARP_INDEX_HTML } });
    }

    if (action === 'parse' && prop === 'text' && page && opts.failingPages?.includes(page)) {
      return new Response('boom', { status: 500 });
    }
    if (action === 'parse' && page === 'Exclusive Channel' && prop === 'text') {
      return jsonResponse({ parse: { title: page, text: opts.exclusiveHtml ?? EXCLUSIVE_INDEX_HTML } });
    }
    if (action === 'parse' && page === 'W-Engine Channel' && prop === 'text') {
      return jsonResponse({ parse: { title: page, text: opts.wEngineHtml ?? W_ENGINE_INDEX_HTML } });
    }

    if (action === 'parse' && prop === 'wikitext' && page) {
      const override = opts.wikitextOverrides?.[page];
      if (override === null) {
        return jsonResponse({ error: { info: `no such page "${page}"` } });
      }
      const wikitext = override ?? WIKITEXT_BY_TITLE[page];
      if (wikitext === undefined) throw new Error(`no fixture wikitext for page ${JSON.stringify(page)}`);
      return jsonResponse({ parse: { title: page, wikitext } });
    }

    if (action === 'query' && url.searchParams.get('prop') === 'imageinfo') {
      if (opts.imagesUnresolvable) {
        return jsonResponse({ query: { pages: [{ missing: true }] } });
      }
      const titles = url.searchParams.get('titles') ?? '';
      const filename = titles.replace(/^File:/, '');
      return jsonResponse({
        query: {
          pages: [{ imageinfo: [{ thumburl: `https://static.wikia.nocookie.net/resolved/${encodeURIComponent(filename)}` }] }],
        },
      });
    }

    throw new Error(`unexpected fetch call: ${url.toString()}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('WikiSource.fetchBanners', () => {
  it('groups current Banners under wiki category order, nested in the wiki order', async () => {
    stubWikiFetch();
    const banners = await new WikiSource().fetchBanners('genshin');

    expect(banners.current.map((s) => s.label)).toEqual(['Character Event Wish', 'Weapon Event Wish']);
    expect(banners.current[0].banners.map((b) => b.title)).toEqual([
      'Somnias a Luna/2026-07-21',
      'Reign of Serenity/2026-07-21',
    ]);
    expect(banners.current[1].banners.map((b) => b.title)).toEqual(['Epitome Invocation/2026-07-21']);
  });

  it('extracts Featured 5★/4★ lists without leaking standard-pool items', async () => {
    stubWikiFetch();
    const banners = await new WikiSource().fetchBanners('genshin');

    const somnias = banners.current[0].banners[0];
    expect(somnias.featured5Star).toEqual(['Columbina']);
    expect(somnias.featured4Star).toEqual(['Jahoda', 'Ororon', 'Sethos']);
    // Standard-pool-only items (e.g. "Diluc", present in character_5) must
    // never appear in either Featured list.
    expect(somnias.featured5Star).not.toContain('Diluc');
    expect(somnias.featured4Star).not.toContain('Diluc');

    const epitome = banners.current[1].banners[0];
    expect(epitome.featured5Star).toEqual(["Nocturne's Curtain Call", 'Engulfing Lightning']);
  });

  it('resolves start/end to per-region instants with all four Genshin regions present', async () => {
    stubWikiFetch();
    const banners = await new WikiSource().fetchBanners('genshin');

    const somnias = banners.current[0].banners[0];
    expect(Object.keys(somnias.startUnix ?? {}).sort()).toEqual(['America', 'Asia', 'Europe', 'SAR']);
    expect(Object.keys(somnias.endUnix ?? {}).sort()).toEqual(['America', 'Asia', 'Europe', 'SAR']);
    // 2026-08-11 14:59:59 wall-clock, Asia is UTC+8.
    expect(somnias.endUnix?.Asia).toBe(Date.UTC(2026, 7, 11, 6, 59) / 1000);
  });

  it('marks a Banner already past its end as ended', async () => {
    stubWikiFetch();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z')); // well after every region's end time

    const banners = await new WikiSource().fetchBanners('genshin');

    for (const section of banners.current) {
      for (const banner of section.banners) {
        expect(banner.status).toBe('ended');
      }
    }
  });

  it('drops a Banner whose detail fetch fails while its sibling in the same category survives', async () => {
    stubWikiFetch({ wikitextOverrides: { 'Reign of Serenity/2026-07-21': null } });

    const banners = await new WikiSource().fetchBanners('genshin');

    const characterSection = banners.current.find((s) => s.label === 'Character Event Wish');
    expect(characterSection?.banners.map((b) => b.title)).toEqual(['Somnias a Luna/2026-07-21']);
    // The other category is untouched by the failure.
    expect(banners.current.find((s) => s.label === 'Weapon Event Wish')?.banners).toHaveLength(1);
  });

  it('drops a whole category when every Banner listed under it fails to fetch', async () => {
    stubWikiFetch({ wikitextOverrides: { 'Epitome Invocation/2026-07-21': null } });

    const banners = await new WikiSource().fetchBanners('genshin');

    expect(banners.current.map((s) => s.label)).toEqual(['Character Event Wish']);
  });

  it('carries a matched Banner group\'s key/label for a mapped category', async () => {
    stubWikiFetch();
    const banners = await new WikiSource().fetchBanners('genshin');

    expect(banners.current[0]).toMatchObject({ key: 'character', label: 'Character Event Wish' });
    expect(banners.current[1]).toMatchObject({ key: 'weapon', label: 'Weapon Event Wish' });
  });

  it('renders a category with no matching Banner group under the wiki\'s own label', async () => {
    stubWikiFetch({ wishHtml: UNMAPPED_CATEGORY_HTML });
    const banners = await new WikiSource().fetchBanners('genshin');

    const unmapped = banners.current.find((s) => s.label === 'Anniversary Wish');
    expect(unmapped).toBeDefined();
    expect(unmapped!.key).toBe('anniversary-wish'); // slugified fallback, not a pity-config key
    expect(unmapped!.banners[0].title).toBe('Test Anniversary Banner/2026-07-01');
    expect(unmapped!.banners[0].featured5Star).toEqual(['Test Featured Five']);
  });

  it('yields an empty result for an empty Upcoming section, not an error', async () => {
    stubWikiFetch();
    const banners = await new WikiSource().fetchBanners('genshin');

    expect(banners.upcoming).toEqual([]);
  });

  it('falls back to the listing thumbnail when a Banner\'s own image resolution fails', async () => {
    stubWikiFetch({ imagesUnresolvable: true });
    const banners: GameBanners = await new WikiSource().fetchBanners('genshin');

    const somnias = banners.current[0].banners[0];
    expect(somnias.imageUrl).toBe(
      'https://static.wikia.nocookie.net/gensin-impact/images/4/4f/Somnias_a_Luna_2026-07-21.png/revision/latest/scale-to-width-down/250?cb=20260716130344',
    );
  });

  it('only requests api.php URLs, always with the anonymous-CORS origin parameter', async () => {
    const { calls } = stubWikiFetch();
    await new WikiSource().fetchBanners('genshin');

    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) {
      expect(url.pathname).toBe('/api.php');
      expect(url.searchParams.get('origin')).toBe('*');
    }
  });

  it('reads hyphenated item-pool field names (regression: they used to be silently skipped)', async () => {
    const genshin = GAME_CONFIGS.genshin;
    const original = genshin.itemPool;
    // Config-driven: point the top tier at a hyphenated field, as ZZZ's
    // `w-engine_S_F` will be.
    genshin.itemPool = { ...original, topTierFeatured: ['w-engine_S_F'], secondTierFeatured: [] };
    try {
      const somnias = WIKITEXT_BY_TITLE['Somnias a Luna/2026-07-21'].replace(
        '|character_5_F = Columbina',
        '|w-engine_S_F = Hyphen Blade; Hyphen Bow',
      );
      stubWikiFetch({ wikitextOverrides: { 'Somnias a Luna/2026-07-21': somnias } });
      const banners = await new WikiSource().fetchBanners('genshin');

      expect(banners.current[0].banners[0].featured5Star).toEqual(['Hyphen Blade', 'Hyphen Bow']);
    } finally {
      genshin.itemPool = original;
    }
  });

  it('returns empty sections with no network request for a game with no configured banner page', async () => {
    const zzz = GAME_CONFIGS.zzz;
    const original = zzz.bannerIndexPages;
    zzz.bannerIndexPages = [];
    try {
      const { fetchMock } = stubWikiFetch();
      const banners = await new WikiSource().fetchBanners('zzz');

      expect(banners).toMatchObject({ current: [], upcoming: [] });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      zzz.bannerIndexPages = original;
    }
  });
});

describe('WikiSource.fetchBanners (HSR)', () => {
  beforeEach(() => {
    // The fixture's version blocks run to Oct 21 / Nov 10 2026; ended-block
    // dropping is judged against this day.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T12:00:00'));
  });

  it('groups Warp Banners by the category from the wiki, in wiki order, with Banners nested', async () => {
    stubWikiFetch();
    const banners = await new WikiSource().fetchBanners('hsr');

    expect(banners.current.map((s) => s.label)).toEqual([
      'Character Event Warp',
      'Light Cone Event Warp',
      'Character Collaboration Warp',
      'Light Cone Collaboration Warp',
    ]);
    expect(banners.current[0].banners.map((b) => b.title)).toEqual([
      'An Ocean in a Pearl/2026-09-28',
      'The Demoiselle in Charge/2026-09-28',
    ]);
    expect(banners.current[1].banners.map((b) => b.title)).toEqual([
      'Brilliant Fixation/2026-09-28',
      'Bygone Reminiscence/2026-09-28',
    ]);
  });

  it('drops rows from a version block whose date range has passed, keeping open-ended collabs', async () => {
    stubWikiFetch();
    vi.setSystemTime(new Date('2026-10-25T12:00:00')); // after the Sep 28 - Oct 21 block ended
    const banners = await new WikiSource().fetchBanners('hsr');

    expect(banners.current[0].banners.map((b) => b.title)).toEqual(['An Ocean in a Pearl/2026-09-28']);
    expect(banners.current.map((s) => s.label)).toContain('Character Collaboration Warp');
  });

  it('requests the Warp listing page and nothing outside api.php', async () => {
    const { calls } = stubWikiFetch();
    await new WikiSource().fetchBanners('hsr');

    const listing = calls.filter((u) => u.searchParams.get('prop') === 'text');
    expect(listing.map((u) => u.searchParams.get('page'))).toEqual(['Warp']);
    for (const url of calls) {
      expect(url.pathname).toBe('/api.php');
      expect(url.searchParams.get('origin')).toBe('*');
    }
  });

  it('reads the real thumbnail from data-src when src is a lazy-load data: URI', async () => {
    stubWikiFetch({ imagesUnresolvable: true });
    const banners = await new WikiSource().fetchBanners('hsr');

    const ocean = banners.current[0].banners[0];
    expect(ocean.imageUrl).toMatch(/^https:\/\/static\.wikia\.nocookie\.net\/.*An_Ocean_in_a_Pearl_2026-09-28\.png/);
  });

  it('populates Light Cone featured lists without leaking standard-pool fields', async () => {
    stubWikiFetch();
    const banners = await new WikiSource().fetchBanners('hsr');

    const brilliant = banners.current[1].banners[0];
    expect(brilliant.featured5Star).toEqual(['Colors for Tomorrow']);
    expect(brilliant.featured4Star).toEqual(['Post-Op Conversation', 'Planetary Rendezvous', 'Boundless Choreo']);
  });

  it('shows a collaboration Banner with no end date as unknown with a null end, under the wiki label', async () => {
    stubWikiFetch();
    const banners = await new WikiSource().fetchBanners('hsr');

    const collab = banners.current.find((s) => s.label === 'Character Collaboration Warp');
    expect(collab).toBeDefined();
    expect(collab!.key).toBe('character-collaboration-warp'); // unmapped -> slugified fallback
    const enuma = collab!.banners.find((b) => b.title === 'Of the Beginning, Enuma Elish/2026-07-24')!;
    expect(enuma.featured5Star).toEqual(['Gilgamesh']);
    expect(enuma.status).toBe('unknown');
    expect(enuma.endUnix).toBeNull();
  });

  it('lists Upcoming Banners whose art is not uploaded yet, with no thumbnail', async () => {
    stubWikiFetch({ imagesUnresolvable: true });
    const banners = await new WikiSource().fetchBanners('hsr');

    expect(banners.upcoming.map((s) => s.label)).toEqual(['Character Event Warp', 'Light Cone Event Warp']);
    const blade = banners.upcoming[0].banners[0];
    expect(blade.title).toBe('Now I Am Become Blade/2026-10-21');
    expect(blade.featured5Star).toEqual(['Mortenax Blade']);
    expect(blade.imageUrl).toBeNull();
  });
});

describe('parseBannerIndex version-block filtering', () => {
  const row = (label: string, title: string) =>
    `<tr><td><a href="/wiki/${label}" title="${label}">${label}</a></td><td><div><a href="/wiki/${title}" title="${title}">${title}</a></div></td></tr>`;
  const header = (text: string) => `<tr><th colspan="2"><a href="/wiki/Version/1" title="Version/1">Version 1</a>: ${text}</th></tr>`;
  const page = (current: string, upcoming = '') =>
    `<h3 id="Current_Event_Warps">Current</h3><table><tbody>${current}</tbody></table>` +
    `<h3 id="Upcoming_Event_Warps">Upcoming</h3><table><tbody>${upcoming}</tbody></table>`;
  const now = new Date('2026-10-13T12:00:00');
  const titles = (cats: { banners: { title: string }[] }[]) => cats.flatMap((c) => c.banners.map((b) => b.title));

  it('returns only the current version block, not an older ended one', () => {
    const html = page(
      header('September 28, 2026 &#8212; November 10, 2026') + row('Character Event Warp', 'Now/2026-09-28') +
        header('May 1, 2026 &#8212; June 12, 2026') + row('Character Event Warp', 'Old/2026-05-01'),
    );
    expect(titles(parseBannerIndex(html, now).current)).toEqual(['Now/2026-09-28']);
  });

  it('keeps rows under a header whose dates do not parse', () => {
    const html = page(header('Since July 11, 2025 (Indefinite)') + row('Character Collaboration Warp', 'Collab/2025-07-11'));
    expect(titles(parseBannerIndex(html, now).current)).toEqual(['Collab/2025-07-11']);
  });

  it('never filters Upcoming', () => {
    const html = page('', header('May 1, 2026 &#8212; June 12, 2026') + row('Character Event Warp', 'Old/2026-05-01'));
    expect(titles(parseBannerIndex(html, now).upcoming)).toEqual(['Old/2026-05-01']);
  });
});

describe('WikiSource.fetchBanners (ZZZ)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
  });

  const titles = (sections: { banners: { title: string }[] }[]) => sections.map((s) => s.banners.map((b) => b.title));
  const POOL_TEXT = ZZZ_WIKITEXT_BY_TITLE['Cindernight Respite/2026-09-30'];
  const upcomingOverrides = Object.fromEntries(
    [
      'Answers in the Wind/2026-11-11',
      'Graceful Gale/2026-10-21',
      'Into the Flames of Life/2026-10-21',
      'Outlier of Prodigies/2026-11-11',
      'Chief Sidekick/2026-11-11',
      'Incarcerating Grip/2026-11-11',
      'Joyau Dore/2026-10-21',
      'Plume of Rebirth/2026-10-21',
    ].map((t) => [t, POOL_TEXT]),
  );

  it('fetches both channel pages and merges them, Exclusive then W-Engine', async () => {
    const { calls } = stubWikiFetch({ wikitextOverrides: upcomingOverrides });
    const banners = await new WikiSource().fetchBanners('zzz');

    const listingPages = calls
      .filter((u) => u.searchParams.get('prop') === 'text')
      .map((u) => u.searchParams.get('page'));
    expect(listingPages).toEqual(['Exclusive Channel', 'W-Engine Channel']);

    expect(banners.current.map((s) => s.label)).toEqual(['Exclusive Channel', 'W-Engine Channel']);
    expect(titles(banners.current)).toEqual([
      ['Cindernight Respite/2026-09-30', 'Cold Rain Wanes in the Night/2026-09-30'],
      ['Crimson Moon Casket/2026-09-30', 'Frostfall Sickle/2026-09-30'],
    ]);
  });

  it('gathers Upcoming across both channels, grouped by channel', async () => {
    stubWikiFetch({ wikitextOverrides: upcomingOverrides });
    const banners = await new WikiSource().fetchBanners('zzz');

    expect(banners.upcoming.map((s) => s.label)).toEqual(['Exclusive Channel', 'W-Engine Channel']);
    expect(titles(banners.upcoming)[0]).toEqual([
      'Answers in the Wind/2026-11-11',
      'Graceful Gale/2026-10-21',
      'Into the Flames of Life/2026-10-21',
      'Outlier of Prodigies/2026-11-11',
    ]);
    expect(titles(banners.upcoming)[1]).toHaveLength(4);
  });

  it('reads top-tier agent and hyphenated W-Engine Featured fields, ignoring standard-pool and B-rank fields', async () => {
    stubWikiFetch({ wikitextOverrides: upcomingOverrides });
    const banners = await new WikiSource().fetchBanners('zzz');

    const agent = banners.current[0].banners[0];
    expect(agent.featured5Star).toEqual(['Roxy Ifrita Pryce']);
    expect(agent.featured4Star).toEqual(['Corin Wickes', 'Billy Kid']);

    const wEngine = banners.current[1].banners[0];
    expect(wEngine.featured5Star).toEqual(['Crimson Moon Casket']);
    expect(wEngine.featured4Star).toEqual(['Housekeeper', 'Starlight Engine Replica']);
  });

  it('resolves art from the infobox filename (the listing has no thumbnail)', async () => {
    stubWikiFetch({ wikitextOverrides: upcomingOverrides });
    const banners = await new WikiSource().fetchBanners('zzz');

    expect(banners.current[0].banners[0].imageUrl).toBe(
      'https://static.wikia.nocookie.net/resolved/Cindernight%20Respite%202026-09-30.png',
    );
  });

  it('renders a Banner with no image when the art cannot be resolved', async () => {
    stubWikiFetch({ imagesUnresolvable: true, wikitextOverrides: upcomingOverrides });
    const banners = await new WikiSource().fetchBanners('zzz');

    const banner = banners.current[0].banners[0];
    expect(banner.imageUrl).toBeNull();
    expect(banner.name).toBe('Cindernight Respite');
    expect(banner.endUnix).not.toBeNull();
  });

  it('parses a single concurrent Banner under a run label (hand-edited fixture)', async () => {
    stubWikiFetch({ exclusiveHtml: EXCLUSIVE_SINGLE_UPCOMING_HTML, wikitextOverrides: upcomingOverrides });
    const banners = await new WikiSource().fetchBanners('zzz');

    expect(titles(banners.upcoming)[0]).toEqual(['Answers in the Wind/2026-11-11']);
    expect(titles(banners.current)[0]).toEqual([
      'Cindernight Respite/2026-09-30',
      'Cold Rain Wanes in the Night/2026-09-30',
    ]);
  });

  it('keeps the other channel when one channel page fails to fetch', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
    stubWikiFetch({ failingPages: ['Exclusive Channel'], wikitextOverrides: upcomingOverrides });
    const pending = new WikiSource().fetchBanners('zzz');
    await vi.runAllTimersAsync(); // client.ts retries once after a 1s delay
    const banners = await pending;

    expect(banners.current.map((s) => s.label)).toEqual(['W-Engine Channel']);
    expect(banners.upcoming.map((s) => s.label)).toEqual(['W-Engine Channel']);
  });

  it('drops only a Banner whose detail fetch fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubWikiFetch({ wikitextOverrides: { ...upcomingOverrides, 'Cindernight Respite/2026-09-30': null } });
    const banners = await new WikiSource().fetchBanners('zzz');

    expect(titles(banners.current)[0]).toEqual(['Cold Rain Wanes in the Night/2026-09-30']);
    expect(titles(banners.current)[1]).toHaveLength(2);
  });
});
