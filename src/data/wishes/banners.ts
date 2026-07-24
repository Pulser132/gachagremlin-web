/**
 * Per-game banner-group configuration for pity/guarantee math.
 *
 * `bannerTypes` lists every raw API `gacha_type` (ZZZ: `real_gacha_type`)
 * folded into one group. Genshin's second concurrent character banner (400)
 * is folded into the main character-event group (301), per the plan's
 * decision log, since HoYoverse rarely runs the paired banners with
 * meaningfully different pity in practice. HSR's collaboration banners
 * (21/22) are kept as two separate groups — Collaboration Character Warp
 * and Collaboration Light Cone Warp — mirroring the regular character/light
 * cone split (11/12), since they draw from distinct item pools.
 *
 * `standardPool5Star` names the permanent-pool 5-star items for that game.
 * Pulling one of these on a `has5050` banner means the 50/50 was lost (the
 * next 5-star on that banner group is then guaranteed to be the limited
 * item) — this is the same heuristic every reference tracker uses, since
 * the API response carries no explicit "won/lost" flag.
 *
 * IMPORTANT: HoYoverse periodically adds new characters/light cones/agents
 * to the standard pool. These lists are current as of mid-2026 — verify
 * and update them if pity/guarantee results look wrong for a newer pull.
 */
import type { GameKey } from '../../types.ts';

export interface BannerGroup {
  key: string;
  label: string;
  bannerTypes: string[];
  hardPity: number;
  /** Whether this banner group has a 50/50-style standard/limited split. */
  has5050: boolean;
}

export interface GameBannerConfig {
  /** "Wishes" | "Warps" | "Signal Searches" */
  itemLabel: string;
  groups: BannerGroup[];
  standardPool5Star: string[];
}

export const GAME_BANNER_CONFIGS: Record<GameKey, GameBannerConfig> = {
  genshin: {
    itemLabel: 'Wishes',
    groups: [
      { key: 'novice', label: 'Beginners’ Wish', bannerTypes: ['100'], hardPity: 90, has5050: false },
      { key: 'standard', label: 'Wanderlust Invocation', bannerTypes: ['200'], hardPity: 90, has5050: false },
      { key: 'character', label: 'Character Event Wish', bannerTypes: ['301', '400'], hardPity: 90, has5050: true },
      { key: 'weapon', label: 'Weapon Event Wish', bannerTypes: ['302'], hardPity: 80, has5050: false },
      { key: 'chronicled', label: 'Chronicled Wish', bannerTypes: ['500'], hardPity: 90, has5050: false },
    ],
    standardPool5Star: [
      'Diluc',
      'Jean',
      'Keqing',
      'Mona',
      'Qiqi',
      'Tighnari',
      'Wolf’s Gravestone',
      'Skyward Pride',
      'Skyward Blade',
      'Skyward Spine',
      'Skyward Atlas',
      'Skyward Harp',
      'Amos’ Bow',
      'Aquila Favonia',
      'The Unforged',
      'Vortex Vanquisher',
      'Primordial Jade Winged-Spear',
      'Primordial Jade Cutter',
      'Lost Prayer to the Sacred Winds',
    ],
  },
  hsr: {
    itemLabel: 'Warps',
    groups: [
      { key: 'standard', label: 'Stellar Warp', bannerTypes: ['1'], hardPity: 90, has5050: false },
      { key: 'departure', label: 'Departure Warp', bannerTypes: ['2'], hardPity: 50, has5050: false },
      { key: 'character', label: 'Character Event Warp', bannerTypes: ['11'], hardPity: 90, has5050: true },
      { key: 'lightcone', label: 'Light Cone Event Warp', bannerTypes: ['12'], hardPity: 80, has5050: true },
      { key: 'collab-character', label: 'Collaboration Character Warp', bannerTypes: ['21'], hardPity: 90, has5050: true },
      { key: 'collab-lightcone', label: 'Collaboration Light Cone Warp', bannerTypes: ['22'], hardPity: 80, has5050: true },
    ],
    standardPool5Star: [
      'Bronya',
      'Clara',
      'Gepard',
      'Himeko',
      'Seele',
      'Welt',
      'Yanqing',
      'Night on the Milky Way',
      'But the Battle Isn’t Over',
      'In the Night',
      'Something Irreplaceable',
      'Time Waits for No One',
      'Sleep Like the Dead',
    ],
  },
  zzz: {
    itemLabel: 'Signal Searches',
    groups: [
      { key: 'standard', label: 'Standard Channel', bannerTypes: ['1'], hardPity: 90, has5050: false },
      { key: 'exclusive', label: 'Exclusive Channel', bannerTypes: ['2'], hardPity: 90, has5050: true },
      { key: 'wengine', label: 'W-Engine Channel', bannerTypes: ['3'], hardPity: 80, has5050: false },
      { key: 'bangboo', label: 'Bangboo Channel', bannerTypes: ['5'], hardPity: 80, has5050: false },
    ],
    standardPool5Star: [
      'Koleda',
      'Ben',
      'Nekomata',
      'Soldier 11',
      'Lycaon',
      'Grace',
      'Steel Cushion',
      'Fusion Compiler',
      'Weeping Cradle',
      'Steam Oven',
      'Static Mind',
    ],
  },
};

export function findBannerGroup(game: GameKey, bannerType: string): BannerGroup | undefined {
  return GAME_BANNER_CONFIGS[game].groups.find((g) => g.bannerTypes.includes(bannerType));
}
