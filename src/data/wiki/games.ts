/**
 * Per-game wiki configuration.
 *
 * Ported from the bot's `src/gachagremlin/wiki/games.py` (GachaGremlin repo),
 * which was itself ported from the three Claude skill scripts' config blocks.
 * SAR (TW/HK/MO) exists only in Genshin.
 */
import type { GameKey, Region } from '../../types.ts';

// Fandom 403s default bot-like User-Agents; browsers are unaffected (they
// can't set this header anyway). Node scripts (scripts/smoke.ts) must send
// a descriptive UA explicitly, same as the bot.
export const USER_AGENT = 'gachagremlin-web/1.0 (+https://github.com/Pulser132/gachagremlin-web)';

export interface ItemPoolSpec {
  templateName: string;
  topTierFeatured: string[];
  secondTierFeatured: string[];
}

export interface GameConfig {
  key: GameKey;
  label: string;
  host: string;
  indexPage: string;
  /**
   * The pages whose rendered HTML is the game's gacha-Banner listing (e.g.
   * Genshin's `Wish`). An empty array is the single switch that turns the
   * Banners tab off for a game — it drives the "not wired up yet" panel and
   * skips any network request.
   */
  bannerIndexPages: string[];
  /** Which listing walker applies: one table of category rows per page, or
   * one page per category rendered as a sequence of divs. Dispatched on
   * declaratively rather than by game key. */
  bannerIndexShape: 'table' | 'channelPages';
  /** The listing's Current section also carries rows from long-finished
   * versions (HSR), so Current rows under a version header whose date range
   * has passed are dropped. Off where Current is already only what's live. */
  dropEndedCurrentBanners: boolean;
  /** The per-Banner infobox template `parseInfobox` is called with. */
  bannerInfoboxTemplate: string;
  /** The per-Banner item-pool template and which of its fields hold the
   * Featured lists (top tier = 5★/S-rank, second tier = 4★/A-rank). */
  itemPool: ItemPoolSpec;
  /** Whether cards display the second-tier Featured line. False where that
   * slot is player-selected rather than a fixed rate-up. */
  showFeaturedSecondTier: boolean;
  /** Regional servers and their fixed UTC offsets (HoYoverse does not observe DST). */
  servers: Partial<Record<Region, number>>;
}

export const GAME_CONFIGS: Record<GameKey, GameConfig> = {
  genshin: {
    key: 'genshin',
    label: 'Genshin Impact',
    host: 'genshin-impact.fandom.com',
    indexPage: 'Event',
    bannerIndexPages: ['Wish'],
    bannerIndexShape: 'table',
    dropEndedCurrentBanners: false,
    bannerInfoboxTemplate: 'Wish',
    itemPool: {
      templateName: 'Wish Pool',
      topTierFeatured: ['character_5_F', 'weapon_5_F'],
      secondTierFeatured: ['character_4_F', 'weapon_4_F'],
    },
    showFeaturedSecondTier: true,
    servers: { America: -5, Europe: 1, Asia: 8, SAR: 8 },
  },
  hsr: {
    key: 'hsr',
    label: 'Honkai: Star Rail',
    host: 'honkai-star-rail.fandom.com',
    indexPage: 'Events',
    bannerIndexPages: ['Warp'],
    bannerIndexShape: 'table',
    dropEndedCurrentBanners: true,
    bannerInfoboxTemplate: 'Warp',
    itemPool: {
      templateName: 'Warp Pool',
      topTierFeatured: ['character_5_F', 'lightcone_5_F'],
      secondTierFeatured: ['character_4_F', 'lightcone_4_F'],
    },
    showFeaturedSecondTier: true,
    servers: { America: -5, Europe: 1, Asia: 8 },
  },
  zzz: {
    key: 'zzz',
    label: 'Zenless Zone Zero',
    host: 'zenless-zone-zero.fandom.com',
    indexPage: 'Event',
    // Banner listing not wired up yet (empty bannerIndexPages).
    bannerIndexPages: [],
    bannerIndexShape: 'channelPages',
    dropEndedCurrentBanners: false,
    bannerInfoboxTemplate: 'Signal Search Infobox',
    itemPool: {
      templateName: 'Signal Search Pool',
      topTierFeatured: ['agent_S_F', 'w-engine_S_F'],
      secondTierFeatured: ['agent_A_F', 'w-engine_A_F'],
    },
    showFeaturedSecondTier: false,
    servers: { America: -5, Europe: 1, Asia: 8 },
  },
};

export const GAME_KEYS: GameKey[] = ['genshin', 'hsr', 'zzz'];

export function getGame(key: GameKey): GameConfig {
  const config = GAME_CONFIGS[key];
  if (!config) {
    throw new Error(`unknown game ${key}; expected one of ${GAME_KEYS.join(', ')}`);
  }
  return config;
}

/** Whether `game` has a configured Banner listing page — the switch that
 * turns the Banners tab's real fetch on for it (see `GameConfig.bannerIndexPages`). */
export function hasBannerIndexPage(key: GameKey): boolean {
  return GAME_CONFIGS[key].bannerIndexPages.length > 0;
}
