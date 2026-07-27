# ADR-0001: Banner data is its own on-demand `BannerSource`, not folded into `EventSource`

## Status

Accepted (2026-07-27).

## Context

The Banners tab (issue #22) needs live gacha-Banner data alongside the
existing Events tab. Both are sourced from the same Fandom wikis via the same
MediaWiki Action API client. The obvious shortcut is to extend `EventSource`
(`src/data/source.ts`) so one fetch call returns both Events and Banners.

## Decision

`BannerSource` is a new interface, parallel to `EventSource`, not an extension
of it:

```ts
export interface BannerSource {
  fetchBanners(game: GameKey): Promise<GameBanners>;
}
```

`WikiSource` implements both. Each is independently cached (`src/data/cache.ts`,
generalized in this same change — see the cache generalization decision in the
issue), independently failable, and independently deferrable.

## Consequences

- A Banner parse failure can never blank the Events tab, and vice versa —
  each source's error handling is scoped to its own fetch.
- Users who never open the Banners tab never pay its fetch cost: `app.ts`
  only calls `BannerSource.fetchBanners` when the Banners tab is actually
  opened, exactly like the Wishes tab pattern already established for
  fetch-avoidance.
- The future `BotApiSource` swap `EventSource`'s doc comment anticipates (a
  source reading the Discord bot's already-polled cache over HTTP instead of
  fetching Fandom directly) stays possible for Banners too — a second small
  interface to implement, not a widened one.
- Cost: two fetch entry points and two cache namespaces instead of one. Judged
  worth it because Events and Banners have different fetch shapes (ADR-0002)
  and different UI lifecycles (Banners tab fetches lazily; Events currently
  does not).
