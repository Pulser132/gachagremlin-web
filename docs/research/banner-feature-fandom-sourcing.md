# Banner feature: can the existing MediaWiki-API approach source it?

*Researched 2026-07-27, against the live `genshin-impact.fandom.com` and the live repo.*

## Question

The site currently pulls Events data client-side via the public MediaWiki Action
API (`api.php?...&origin=*`, no key, no proxy, no backend -- see
`src/data/wiki/client.ts`). The user wants a new "banners" feature (banner name,
artwork, and featured-character pool for the current/upcoming Genshin Impact
gacha banners). Their proposed source is the Genshin Fandom wiki: an overview
page with "Character Event"/"Weapon Event" listings linking to per-banner
subpages (e.g. `Somnias_a_Luna/2026-07-21`) that hold the item pool.

**Does the same MediaWiki-API pattern this site already uses for Events drive
this too, or does some part of it require scraping rendered HTML?**

## Answer

**Yes -- fully driven by the MediaWiki Action API, no HTML scraping of live
rendered pages needed, for all four pieces (listing/discovery, title, image,
character pool).** But it needs two different API calls depending on the page,
mirroring a split the codebase's Events fetcher already has:

- The **overview/listing page** (`Wish`) does *not* expose banner names in its
  raw wikitext -- the "Current"/"Upcoming" sections are generated at request time
  by a Lua module + DynamicPageList query. Getting the list requires
  `action=parse&prop=text` (server-side-rendered HTML fragment from the API,
  with Lua/DPL already resolved) -- exactly the call `listEvents` in
  `src/data/wiki/fetch.ts:35` already makes for the Events index. A new parser
  sibling to `parseIndex` is needed because the output shape is a `<table>`
  of banner-type rows with `<img>` tags carrying already-resolved CDN thumbnail
  URLs, not a heading-anchored list of `<a title=...>` links.
- The **per-banner subpage** (`Somnias_a_Luna/2026-07-21`) *does* expose
  everything cleanly in raw wikitext via `action=parse&prop=wikitext` -- a
  `{{Wish|...}}` infobox (name, bare image filename, type, start/end,
  preceding/succeeding banner links) and a separate `{{Wish Pool|...}}`
  template with semicolon-delimited character lists, structurally the same
  shape `parseInfobox` in `src/data/wiki/parser.ts:87` already parses for
  `{{Event}}`/`{{Event Infobox}}`. `resolveImageUrl` (`client.ts:55`) resolves
  the infobox's bare filename exactly as it does today for events -- verified
  byte-for-byte identical CDN URL between the imageinfo call and the URL
  already embedded in the rendered listing table.

Directly fetching the rendered wiki pages (or `robots.txt`) with a plain HTTP
client is blocked by a Cloudflare bot challenge (`403`, "Just a moment..."
interstitial) -- confirming HTML scraping of live pages is not a viable
fallback here even if it were wanted. Only `api.php` calls succeed. This is the
same asymmetry the existing client.ts comment already documents for
bot-UA blocking, just enforced one layer further out (Cloudflare, not
MediaWiki itself).

## Findings

All fetched live, 2026-07-27, via `curl -A "<browser UA>" https://genshin-impact.fandom.com/...`
(default/no-UA curl and WebFetch both got Cloudflare-blocked; a browser
User-Agent on `api.php` was required and sufficient -- direct page/HTML
fetches stayed blocked even with a browser UA).

1. **Overview page found**: `https://genshin-impact.fandom.com/wiki/Wish`.
   Its own wikitext (`https://genshin-impact.fandom.com/api.php?action=parse&page=Wish&prop=wikitext&format=json&formatversion=2`)
   contains `===Current Event Wishes===` followed by `{{Wish List|no_past=1|no_upcoming=1|no_headers=1}}`
   and `===Upcoming Event Wishes===` followed by `{{Wish List|no_past=1|no_current=1|no_headers=1}}` --
   confirming the section headings the user described exist, but the banner
   data itself is not inline text.
   - Not literally a click-to-switch "tab" widget -- `{{CustomTabs}}` at the
     top of the page controls Overview/List/History/Featured/Probabilities/Gallery
     (different, page-level tabs). "Character Event" and "Weapon Event" are
     **rows in a table** under "Current Event Wishes", not separate tab panes.
     Functionally the same data the user wants, just a different DOM shape
     than literally described.

2. **Listing mechanism is Lua + DPL, not flat wikitext.**
   `https://genshin-impact.fandom.com/api.php?action=parse&page=Template:Wish_List&prop=wikitext&format=json&formatversion=2`
   returned (trimmed):
   ```
   <includeonly>{{#invoke:Wish List|main|wishes={{#DPL:
   |namespace=|category=Wish|uses=Template:Wish
   |notcategory=Recurring Wishes|notcategory=Permanent Wishes
   |mode=userformat|ordermethod=sortkey
   ...}}}}</includeonly>
   ```
   So `action=query&prop=revisions` (raw wikitext) on `Wish` can never yield
   the current banner list -- it only contains the template invocation.

3. **But `action=parse&prop=text` resolves the Lua/DPL server-side into clean
   HTML**, same as this site's existing `listEvents` call does for the Event
   index. Confirmed by fetching section 3 ("Current Event Wishes", found via
   `action=parse&page=Wish&prop=sections&format=json`) at
   `https://genshin-impact.fandom.com/api.php?action=parse&page=Wish&prop=text&section=3&format=json&formatversion=2`.
   Returned (trimmed), one row of a `<table class="wikitable thc tdc1">`:
   ```html
   <tr><td><a href="/wiki/Character_Event_Wish">Character Event</a></td>
   <td><div class="wish-banners"><div><a href="/wiki/Somnias_a_Luna/2026-07-21">
   <img alt="Somnias a Luna 2026-07-21"
        src="https://static.wikia.nocookie.net/gensin-impact/images/4/4f/Somnias_a_Luna_2026-07-21.png/revision/latest/scale-to-width-down/250?cb=20260716130344" />
   </a><br/><a href="/wiki/Somnias_a_Luna/2026-07-21">Somnias a Luna</a></div>
   <div>... "Reign of Serenity" ...</div></div></td></tr>
   <tr><td><a href="/wiki/Weapon_Event_Wish">Weapon Event</a></td>
   <td>... "Epitome Invocation" ...</td></tr>
   ```
   This single API call yields, per current banner: type (Character/Weapon
   Event), banner name, the per-banner subpage URL, and an **already-resolved,
   pre-sized (250px) CDN thumbnail URL** -- no separate `imageinfo` round-trip
   needed for the listing view itself.
   - Section 4 ("Upcoming Event Wishes") at the same call with `section=4`
     returned only `<p>There is no information available on upcoming Event
     Wishes.</p>` -- confirming (independently of the Obsidian note, same
     result) that Genshin's wiki has zero upcoming-banner data published
     right now, not a fetch/parsing failure on my end.

4. **Per-banner subpage is clean structured wikitext.**
   `https://genshin-impact.fandom.com/api.php?action=parse&page=Somnias_a_Luna/2026-07-21&prop=wikitext&format=json&formatversion=2`
   returned a `{{Wish|...}}` infobox:
   ```
   {{Wish
   |name        = Somnias a Luna 2026-07-21
   |image       = Somnias a Luna 2026-07-21.png
   |type        = Character Event
   |time_start  = 2026-07-21 18:00:00
   |time_end    = 2026-08-11 14:59:59
   |link        = https://genshin.hoyoverse.com/en/news/detail/165236
   |preceding   = To the Looking-Glass the Mademoiselle Said/2026-07-01
   |alongside   = Reign of Serenity/2026-07-21
   |alongside2  = Epitome Invocation/2026-07-21
   }}
   ```
   and, separately, the item pool exactly as the user's worked example
   predicted:
   ```
   {{Wish Pool
   |character_5_F = Columbina
   |character_4_F = Jahoda; Ororon; Sethos
   |character_5   = Dehya; Diluc; Jean; Keqing; Mona; Qiqi; Tighnari; Yumemizuki Mizuki
   |character_4   = Aino; Barbara; Beidou; ... (full standard-pool list)
   |weapon_4      = Dragon's Bane; Eye of Perception; ...
   |weapon_3      = Black Tassel; ...
   }}
   ```
   `character_5_F`/`character_4_F` are the *featured* items (what the banner
   feature actually wants); `character_5`/`character_4`/`weapon_*` are the
   shared standard-pool fallback items also present on every character
   banner. Semicolon-delimited, same convention `EventInfo.characters`
   parsing already uses in `src/data/wiki/fetch.ts:71-74`.

5. **Image resolution matches the existing pattern byte-for-byte.**
   `https://genshin-impact.fandom.com/api.php?action=query&titles=File:Somnias%20a%20Luna%202026-07-21.png&prop=imageinfo&iiprop=url&iiurlwidth=250&format=json&formatversion=2`
   returned
   `thumburl: https://static.wikia.nocookie.net/gensin-impact/images/4/4f/Somnias_a_Luna_2026-07-21.png/revision/latest/scale-to-width-down/250?cb=20260716130344`
   -- identical to the URL already embedded in the listing table's `<img src>`
   in finding 3. Confirms `resolveImageUrl` (`src/data/wiki/client.ts:55-73`)
   works unmodified against the `{{Wish}}` infobox's `image` field.

6. **robots.txt and direct page fetches are Cloudflare-gated; the API is not.**
   `curl` (default UA) against `https://genshin-impact.fandom.com/wiki/Wish`
   and `.../robots.txt` both returned HTTP 403 with a Cloudflare "Just a
   moment..." JS-challenge page body, even with a realistic browser
   `User-Agent` header set. Every `api.php` call above succeeded (HTTP 200)
   with the same browser UA. WebFetch (this environment's own fetch tool)
   also failed on all five URLs tried (HTTP 402, tool-side issue, not
   Fandom's) -- `curl` was used as the fallback and is what all citations
   above are based on. **Net effect: this repo's existing avoidance of
   scraping rendered Fandom HTML isn't just a style choice -- direct fetches
   of rendered pages are actively blocked, while `api.php` is not.**
   `robots.txt` itself could not be read (blocked the same way), so its
   content is unverified either way -- see Gaps below.

7. **Banner-discovery beyond "what's on the Wish page right now"**:
   `https://genshin-impact.fandom.com/api.php?action=query&list=categorymembers&cmtitle=Category:Wish&cmlimit=20&format=json&formatversion=2`
   returns every historical banner-series and banner-occurrence page (oldest
   first, e.g. `Ballad in Goblets/2020-09-28`), confirming a full historical
   index exists via `Category:Wish` -- but it is not filtered or sorted by
   "current" vs. "upcoming", so it's a fallback/archive source, not a
   substitute for the `Wish` page's own Current/Upcoming sections (finding 3)
   for the "what's live right now" question.

## Gaps / open questions

- `robots.txt` content is unverified -- every attempt (curl default, curl with
  browser UA, WebFetch) hit the same Cloudflare interstitial as the rendered
  wiki pages. Since the feature as scoped only needs `api.php` (which is
  reachable), this gap doesn't block feasibility, but it means the "does
  Fandom's robots.txt say anything about API vs. scraping access" sub-question
  from the task brief is genuinely open, not just deprioritized.
- WebFetch (the environment's fetch tool) returned HTTP 402 "Payment
  Required" on every URL in this investigation, including plain `api.php`
  JSON endpoints that `curl` fetched successfully seconds later -- an
  environment/tool-quota issue unrelated to Fandom, noted in case it affects
  reproducibility of these exact calls by someone re-running them the same
  way.
- Only the currently-live Genshin Character/Weapon Event Wish banner was
  checked end-to-end. The Obsidian note (below) separately checked HSR and
  ZZZ equivalents and found real per-game differences (HSR pre-publishes the
  next banner's full lineup for "designated"/rerun-selector banners; ZZZ
  publishes the 5-star ~2 days ahead of the 4-stars) -- those weren't
  re-verified here since the task scope is Genshin-first, but they mean the
  "Wish"-page approach validated here won't port to HSR/ZZZ unchanged (their
  overview pages are `Warp` and `Exclusive Channel`, different template
  families, not verified in this pass).
- Did not verify whether `{{Wish List}}`'s DPL query ever surfaces more than
  one upcoming entry at a time when the wiki does have upcoming data (Genshin
  currently has zero, so section 4's *shape* when non-empty is untested here).

## Existing Obsidian notes

`D:\Users\Nickolai Snytkine\Documents\Obsidian\Gachagremlin Ideas\Banners.md`
already has substantial research dated the same day (2026-07-27) as this
investigation, done against the live repo and live wikis. Summary, so this
doc doesn't duplicate or quietly contradict it:

- **Feature framing**: large banner art for the limited 5-star, small
  portraits for featured 4-stars, a remaining-time section, upcoming banners
  shown with a placeholder when 4-stars aren't public yet, all under each
  game's tab bar alongside Events/Wishes.
- **What's reusable as-is**: `src/data/wiki/times.ts` for countdowns;
  `src/data/wishes/banners.ts`'s existing banner-group definitions (Genshin's
  `bannerTypes: ['301','400']` etc.) as the "what counts as one banner"
  identity, rather than inventing new labels; `resolveImageUrl` for the
  banner's own splash image (this doc's finding 5 independently confirms
  this call site works); an HSR-only Fandom-CDN portrait derivation in
  `src/data/wishes/portraits/config.ts` (no network call needed once you have
  a name) -- Genshin/ZZZ have no portrait config yet, a separate prerequisite
  from the banner-fetch work.
- **What's missing**: `GAME_CONFIGS[*].indexPage` (`src/data/wiki/games.ts`)
  only points at each wiki's generic Event index -- gacha-banner pages
  (`Wish`/`Warp`/`Exclusive Channel`) are "a structurally separate page family
  on all three wikis" needing a new fetch path; `EventInfo.characters` is
  *not* banner data despite the coincidental name overlap (it's a general
  "NPCs involved in this story event" field, verified against non-wish
  fixtures); a new infobox parser is needed because live banner pages use a
  template layout described in the note as `{{Item Pool}}`-style (this doc
  found the template is actually named `{{Wish Pool}}` for Genshin
  specifically) rather than `{{Event}}`; a new `BannerSource` mirroring
  `EventSource`/`WikiSource` is the suggested seam; `src/ui/app.ts`'s
  `ViewMode`/`VIEWS` array is where a third `'banners'` tab slots in.
- **"4-star lineup revealed late" cross-game check**: confirmed hardest for
  Genshin ("no information available on upcoming Event Wishes" -- this doc's
  finding 3 independently reproduces this exact same string today), partially
  contradicted for HSR (rerun-selector banners get pre-published dates +
  4-stars three weeks out), confirmed almost exactly as expected for ZZZ
  (S-rank known ~2 days ahead, A-ranks not).
- **Open risks flagged there**: no stable "current banners" index page exists
  on any wiki the way `Event`/`Events` does (each hand-lists via
  differently-shaped tables/prose) -- this doc's findings 1-3 partially
  narrow that specifically for Genshin's `Wish` page (it does have
  consistently-`id`'d `Current_Event_Wishes`/`Upcoming_Event_Wishes` headings,
  just table-shaped rather than list-shaped, and resolvable via the same
  `prop=text` mechanism `listEvents` already uses); per-occurrence page
  titles aren't guessable without first knowing the start date (confirmed
  here too -- the subpage title literally embeds `time_start`'s date);
  Genshin's Character Event Wish-2 can occasionally run a second, different
  concurrent banner; portrait coverage gap for Genshin/ZZZ.
- **A parallel investigation into game8.co as an alternative/supplementary
  source** concluded it's not viable for automated fetching (no CORS headers
  confirmed live, and its ToU explicitly bars reuse/republishing) -- not
  re-verified in this pass since it's out of scope (this doc only investigated
  the Fandom/MediaWiki-API question per the task brief), but flagged here so
  it isn't independently rediscovered.

## Recommendation

The existing `src/data/wiki/` module is the right place to extend, following
the same three-layer split it already has for Events:

- **`src/data/wiki/client.ts`**: no changes needed. `api()` and
  `resolveImageUrl()` work unmodified against `Wish`/`Somnias_a_Luna/...`-style
  pages (findings 3, 5 above use them exactly as-is).
- **`src/data/wiki/parser.ts`**: needs a **new** function alongside
  `parseIndex` (not a reuse of it) to walk the `<table class="wikitable
  thc...">` shape from `action=parse&prop=text` on `Wish`'s Current/Upcoming
  sections and pull out `{type, name, href, imgSrc}` per banner -- the DOM
  shape (table rows with nested `<div class="wish-banners">`) is different
  enough from the Event index's heading-anchored `<a title=...>` list that
  `parseIndex` itself shouldn't be stretched to cover both. Also needs a
  sibling to `parseInfobox` for the `{{Wish|...}}` template name (currently
  hardcoded to match `Event`/`Event Infobox` only, `parser.ts:88`), plus a
  new parser for `{{Wish Pool|...}}`'s `character_5_F`/`character_4_F`/etc.
  fields (semicolon-split, same convention already used for
  `EventInfo.characters` in `fetch.ts:71-74`).
- **`src/data/wiki/games.ts`**: needs a second per-game page reference (e.g.
  `wishPage: 'Wish'`) alongside the existing `indexPage`, since banners are
  confirmed to live on a wholly separate page family, not a variant of the
  Event index.
- **`src/data/wiki/fetch.ts`**: needs a new `listBanners`/`showBanner` pair
  mirroring `listEvents`/`showEvent` (`fetch.ts:33-87`) -- same
  `action=parse&prop=text` then `action=parse&prop=wikitext` two-call shape
  already used there, just pointed at the new parser functions.
- **`src/data/source.ts` / `src/data/wiki/wikiSource.ts`**: the `EventSource`
  interface (`source.ts:10-12`) and its `WikiSource` implementer are the
  pattern to mirror for a `BannerSource`, so the new feature inherits the
  existing caching/stale-data wrapper (`src/data/cache.ts`) and the
  `src/ui/app.ts` view-switching machinery the Obsidian note already
  identified, rather than building a parallel fetch stack.
