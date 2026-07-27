# Banners are fetched by a separate, on-demand BannerSource, not bundled into EventSource

Events are fetched today through one `EventSource.fetchEvents(game)` call, wrapped by a
30-minute `cachedSource`. When designing the Banners feature we considered folding banner
data into that same call — `GameEvents` growing a `banners` field — versus introducing a
parallel `BannerSource` (mirroring `EventSource`'s shape) with its own cache, fetched only
when the Banners tab is actually opened.

We chose the parallel-source approach. Events and Banners are independently cacheable and
independently failable — a Banner-page parse failure shouldn't be able to blank out the
Events tab or vice versa — and bundling them would mean paying the Banners fetch cost
(itself two API calls per game; see ADR-0002) on every load, even for users who never open
that tab. `EventSource` already exists specifically as a swappable seam (its own doc
comment anticipates a future `BotApiSource`), so mirroring it for a second, independently
cacheable, independently deferrable data shape is the same pattern, not a new one.
