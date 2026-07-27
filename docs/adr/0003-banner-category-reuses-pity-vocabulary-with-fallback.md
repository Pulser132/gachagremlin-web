# ADR-0003: A Banner category carries both a mapped Banner group key and the wiki's own label

## Status

Accepted (2026-07-27).

## Context

The wiki's `Wish` listing groups current/upcoming Banners under category rows
whose link title (e.g. "Character Event Wish", "Weapon Event Wish") happens to
match the `label` of a `BannerGroup` already defined in the pity config
(`src/data/wishes/banners.ts`) — the vocabulary the Wishes tab uses for pity
math. But that config is a hand-maintained, closed set, current as of
mid-2026. The wiki can and will list categories the config doesn't know about
(a new promotion type, a game not yet given pity math, a category name that
drifts from the config's wording).

## Decision

Section grouping on the Banners tab is read from the wiki's own category rows
at fetch time — never hardcoded to a fixed Character/Weapon pair, since
Genshin already has more than two Banner groups (they just don't all happen to
be current at once).

For each category row, look up `findBannerGroupByLabel(game, rowLabel)`
against the pity config:

- **Match** → the section carries that `BannerGroup`'s `key` and `label`. This
  is what makes "Character Event Wish" mean the same thing on the Banners tab
  and the Wishes tab.
- **No match** → the section still renders, keyed by a slug derived from the
  wiki's own row label, and labelled with that row label verbatim. A category
  the app doesn't recognize is never silently dropped.

Adding pity math for a new category (i.e. adding it to `GAME_BANNER_CONFIGS`)
is therefore an independent, unhurried config change — never a prerequisite
for a Banner appearing on the tab.

## Consequences

- The Banners tab and the Wishes tab can drift in which categories they know
  about without either one breaking: the Banners tab degrades to a plain
  label instead of failing closed.
- `findBannerGroupByLabel` is a new lookup (existing `findBannerGroup` looks
  up by raw `gacha_type`, not by display label) — a small, deliberate
  addition rather than overloading the existing function's signature.
- Test coverage must include one category that does *not* map to a known
  Banner group (a hand-edited fixture, since Genshin's currently-live
  categories all happen to map) — the fallback path is a first-class case,
  not a hypothetical.
