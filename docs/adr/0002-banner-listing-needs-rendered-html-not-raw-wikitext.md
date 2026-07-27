# Fetching the current-Banner listing requires the MediaWiki API's rendered-HTML mode, not raw wikitext

Events' fetch gets away with one API call shape per page: raw wikitext
(`action=query&prop=revisions`) is enough, because the Event index's Current/Upcoming
sections are plain wiki links under heading anchors. We assumed Banners would work the
same way and confirmed live that it doesn't.

Genshin's `Wish` overview page's "Current Event Wishes"/"Upcoming Event Wishes" sections
are not flat wikitext — they're generated server-side by a Lua module driven by a
DynamicPageList query (`{{#invoke:Wish List|main|wishes={{#DPL:...}}}}`). Fetching that
page's raw wikitext returns only the template invocation, never the actual banner names.
Directly fetching the rendered page over plain HTTP isn't a fallback either — it's
Cloudflare-gated (403, JS challenge) even with a browser User-Agent, confirming this
repo's API-only approach is enforced, not just a style choice.

The listing is only recoverable via `action=parse&prop=text`, which asks the API to
resolve the Lua/DPL server-side and hand back the finished HTML — the same call `listEvents`
already makes for the Event index, just returning a different DOM shape (a `<table>` of
category rows, not a heading-anchored link list). Each per-Banner detail page, by contrast,
*is* plain wikitext (`action=parse&prop=wikitext`) — a `{{Wish|...}}` infobox plus a
`{{Wish Pool|...}}` template, no Lua/DPL involved. So a single Banners fetch needs two
different API call shapes depending on which page it's hitting, where Events only ever
needed one.
