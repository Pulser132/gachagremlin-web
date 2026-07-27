# ADR-0002: The Banner listing page requires rendered HTML; per-Banner detail pages stay raw wikitext

## Status

Accepted (2026-07-27). See `docs/research/banner-feature-fandom-sourcing.md`
for the live verification this is based on.

## Context

Events already make exactly one API call shape: `action=parse&prop=wikitext`
against a page title. Banners need discovery of *which* Banner pages currently
exist before any per-Banner fetch can happen, and that discovery isn't a flat
list anywhere in wikitext.

Genshin's `Wish` page's `===Current Event Wishes===` / `===Upcoming Event
Wishes===` sections are generated at request time by a Lua module driven by a
`DynamicPageList` query (`{{Wish List|...}}` → `{{#invoke:Wish List|main|
wishes={{#DPL:...}}}}`). Fetching the page's raw wikitext
(`action=query&prop=revisions` or `action=parse&prop=wikitext`) returns only
this template invocation — never the resolved Banner names, since Lua/DPL
resolution happens server-side at render time, not in stored wikitext.

Two things were verified live before assuming a workaround was needed:

- `action=parse&prop=text` (server-rendered HTML, the same call
  `listEvents` already makes for the Event index) *does* return the resolved
  table of current/upcoming Banners, because MediaWiki's `parse` action
  renders Lua/DPL before returning HTML.
- Directly fetching the rendered page (or `robots.txt`) over plain HTTP is
  Cloudflare-gated (403, JS challenge) even with a browser `User-Agent`,
  confirming HTML-scraping the live page is not an available fallback either
  way — only `api.php` is reachable.

Per-Banner detail pages (e.g. `Somnias a Luna/2026-07-21`) are the opposite:
clean, flat wikitext — a `{{Wish|...}}` infobox and a separate `{{Wish
Pool|...}}` template, no Lua/DPL involved. `action=parse&prop=wikitext` works
unmodified, identically to how `showEvent` already fetches Event detail pages.

## Decision

A Banners fetch makes two different API call shapes, unlike Events which only
ever needs one:

1. **Listing**: `action=parse&prop=text` against the game's configured
   `bannerIndexPage` (Genshin: `Wish`), fetching the *whole* page once and
   slicing by heading id (`Current_Event_Wishes` / `Upcoming_Event_Wishes`) —
   the same technique `parseIndex` already uses for the Event index — rather
   than an extra `action=parse&prop=sections` round-trip to resolve a section
   number first.
2. **Per-Banner detail**: `action=parse&prop=wikitext` against each dated
   Banner title found in the listing, mirroring `showEvent`.

## Consequences

- No HTML-scraping fallback should ever be added for the listing page or any
  other rendered Fandom page — it is blocked at the Cloudflare layer, not a
  style preference this repo could relax later.
- The listing parser is a new function (table-of-category-rows shape),
  distinct from `parseIndex` (heading-anchored link list) — see the parsing
  section of the issue for why stretching `parseIndex` to cover both would
  serve neither shape well.
- Per-Banner page titles embed their start date and are therefore not
  guessable from the Banner series name alone — they must come from the
  listing page, which is the deeper reason the rendered-HTML call above is
  load-bearing rather than a convenience.
