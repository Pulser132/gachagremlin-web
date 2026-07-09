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

export interface GameConfig {
  key: GameKey;
  label: string;
  host: string;
  indexPage: string;
  /** Regional servers and their fixed UTC offsets (HoYoverse does not observe DST). */
  servers: Partial<Record<Region, number>>;
}

export const GAME_CONFIGS: Record<GameKey, GameConfig> = {
  genshin: {
    key: 'genshin',
    label: 'Genshin Impact',
    host: 'genshin-impact.fandom.com',
    indexPage: 'Event',
    servers: { America: -5, Europe: 1, Asia: 8, SAR: 8 },
  },
  hsr: {
    key: 'hsr',
    label: 'Honkai: Star Rail',
    host: 'honkai-star-rail.fandom.com',
    indexPage: 'Events',
    servers: { America: -5, Europe: 1, Asia: 8 },
  },
  zzz: {
    key: 'zzz',
    label: 'Zenless Zone Zero',
    host: 'zenless-zone-zero.fandom.com',
    indexPage: 'Event',
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
