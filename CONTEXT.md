# GachaGremlin Web — Domain Glossary

Single-context repo. This is the one `CONTEXT.md`; see `docs/adr/` for decisions.

## Vocabulary

- **Event** — a time-boxed in-game happening (story quest, web event, login
  event) sourced from a game's Fandom wiki Event index. See `EventInfo`.
- **Banner** — one gacha promotion run, identified by its wiki page title,
  which embeds the start date (e.g. `Somnias a Luna/2026-07-21`). A Banner has
  its own splash art, Featured items, and a start/end time. See `BannerInfo`.
- **Banner series** — the undated name shared by every run of a recurring
  Banner (e.g. "Somnias a Luna"). Displayed on cards; not itself fetchable —
  the dated Banner title is what's fetched and linked to.
- **Banner group** — the pity/guarantee bucket a Banner belongs to, defined in
  the pity config (`src/data/wishes/banners.ts`, `BannerGroup`), e.g.
  "Character Event Wish". Shared vocabulary between the Wishes tab (pity math)
  and the Banners tab (live listing) — see ADR-0003.
- **Banner category** — the section label the wiki's own listing page groups
  current/upcoming Banners under (e.g. "Character Event Wish", "Weapon Event
  Wish"). When a category's label matches a Banner group's label, the section
  carries that group's key; otherwise it renders under the wiki's own label
  with a derived key. See ADR-0003.
- **Featured item** — the rate-boosted 5★ (front and centre) or 4★ items on a
  Banner, parsed from the per-Banner page's item-pool template's `*_F` fields.
- **Standard pool** — the permanent-pool items also biddable on a Banner,
  parsed into the model but not displayed in v1 (identical across every
  Banner in a group).

## Where things live

- `src/data/wiki/` — MediaWiki Action API client, per-game config, wikitext/
  HTML parsing, wall-clock → per-region time conversion. Shared by Events and
  Banners.
- `src/data/source.ts` — `EventSource` / `BannerSource`: the fetch-layer seam
  a future bot-backed source could implement instead of `WikiSource`.
- `src/data/cache.ts` — generic localStorage TTL cache wrapping either source,
  namespaced by storage prefix.
- `src/data/wishes/banners.ts` — per-game Banner group / pity config, the
  vocabulary Banner categories reuse (ADR-0003).
- `src/ui/` — pure `data → DOM` render functions (`eventCard.ts`,
  `wishesView.ts`, `bannersView.ts`) driven by `app.ts`, which owns fetching,
  caching, and view-switching state.
