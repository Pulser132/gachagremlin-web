# GachaGremlin Web

A no-backend site that shows gacha-game event and pull data for Genshin Impact, Honkai:
Star Rail, and Zenless Zone Zero, fetched client-side from each game's public Fandom wiki
and from the player's own locally-imported pull history.

## Language

**Event**:
A time-limited in-game happening shown on the Events tab — login events, story quests,
web events — sourced from each wiki's generic `Event`/`Events` index page.
_Avoid_: Banner (a different wiki page family; see below)

**Banner**:
A single gacha promotion running for a fixed window, shown on the Banners tab. Identified
by its wiki page title plus start date (e.g. "Somnias a Luna/2026-07-21") — that dated
subpage is the live, currently-relevant Banner; the undated series name alone is not
enough to pin down which run is meant.
_Avoid_: Wish, Warp, Signal Search (the per-game names for the pull-history tracking
feature — see Wishes tab, below — not this concept), Event (unrelated wiki page family)

**Banner series**:
The undated, recurring name a Banner belongs to (e.g. "Somnias a Luna"), spanning every
past and future run of the same lineup.
_Avoid_: Banner (a series isn't itself a live promotion — only one of its dated runs is)

**Banner group**:
A named bucket of same-shaped Banners that share pity/guarantee rules (novice, standard,
character, weapon, chronicled, ...), independent of which specific Banner is currently
live. Fixed, closed set defined per game.
_Avoid_: Category (see Banner category, below — related but not the same thing)

**Banner category**:
The wiki's own label for a group of currently-running Banners (e.g. "Character Event",
"Weapon Event"), read fresh from the wiki on every fetch. Usually corresponds to a Banner
group's name, but the mapping isn't guaranteed — the wiki can list a category with no
matching Banner group (a brand-new promotion type not yet added to the pity-tracking
config), and that category is still shown rather than dropped.
_Avoid_: Banner group (the closed, pity-tracking set — a Banner category is open-ended and
wiki-driven)

**Featured item**:
The character or weapon whose drop rate is boosted on a specific Banner — what a player is
actually pulling for.
_Avoid_: Rate-up (in-game term, not used in this codebase), "5-star"/"4-star" alone (a
rarity, not the same thing — the standard pool also has 5-stars and 4-stars)

**Standard pool**:
The permanent, non-featured items every Banner in a group can also drop, shared across all
Banners in that group.
_Avoid_: Fallback pool, base pool

**Wishes tab** *(existing feature)*:
The pull-history/pity tracker, keyed off a player's own imported pull data and the Banner
group definitions. Distinct from the Banners tab: Wishes answers "where do I stand on
pity"; Banners answers "what's live right now and who's in it."
_Avoid_: Banners (see above — a different tab, a different data source)

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
