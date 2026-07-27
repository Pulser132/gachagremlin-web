import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeNewlines } from '../src/data/wiki/parser.ts';
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

const WIKITEXT_BY_TITLE: Record<string, string> = {
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

  it('returns empty sections with no network request for a game with no configured banner page', async () => {
    const { fetchMock } = stubWikiFetch();
    const banners = await new WikiSource().fetchBanners('hsr');

    expect(banners).toMatchObject({ current: [], upcoming: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
