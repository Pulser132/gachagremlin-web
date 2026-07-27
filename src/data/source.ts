import type { GameBanners, GameEvents, GameKey } from '../types.ts';

/**
 * Abstracts where event data comes from. `WikiSource` (data/wiki/wikiSource.ts)
 * is the only implementation in v1 — it fetches the Fandom wikis directly
 * from the browser. A future `BotApiSource` could implement this same
 * interface to read the Discord bot's already-polled SQLite cache over
 * HTTP instead, without any UI code changing.
 */
export interface EventSource {
  fetchEvents(game: GameKey): Promise<GameEvents>;
}

/**
 * Abstracts where Banner data comes from — parallel to `EventSource`, not an
 * extension of it (see ADR-0001). `WikiSource` implements both, but a Banner
 * parse failure must never be able to affect the Events tab or vice versa.
 */
export interface BannerSource {
  fetchBanners(game: GameKey): Promise<GameBanners>;
}
