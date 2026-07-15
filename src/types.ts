export type GameKey = 'genshin' | 'hsr' | 'zzz';

export type Region = 'America' | 'Europe' | 'Asia' | 'SAR';

export type EventStatus = 'active' | 'upcoming' | 'ended' | 'unknown';

/** Per-region Unix seconds. Genshin has all four keys; HSR/ZZZ omit SAR. */
export type RegionUnix = Partial<Record<Region, number>>;

export interface EventInfo {
  game: GameKey;
  title: string;
  name: string;
  type: string;
  group: string;
  status: EventStatus;
  /** true: one global timestamp applies to every region, not per-server times. */
  globalTime: boolean;
  reward: string;
  rewardType: string;
  characters: string[];
  description: string;
  hoyolabLinks: string[];
  durationText: string[];
  requirements: string[];
  /** Banner image URL from the wiki infobox, or null if it has none / it couldn't be resolved. */
  imageUrl: string | null;
  /** "YYYY-MM-DD HH:MM" server-local wall-clock, or null if unknown/version-gated. */
  startWalltime: string | null;
  endWalltime: string | null;
  startUnix: RegionUnix | null;
  endUnix: RegionUnix | null;
}

export interface GameEvents {
  current: EventInfo[];
  upcoming: EventInfo[];
  fetchedAt: number;
  /** true when this data is stale (served from cache after a failed refetch). */
  stale?: boolean;
}

/**
 * A single pull, as returned by the HoYoverse gacha log API. Field names and
 * types mirror the API response (all strings) so the import scripts can pass
 * items through with no transformation.
 */
export interface WishItem {
  /** Unique, monotonically increasing id. Too large for `Number` — compare
   * by length then lexicographically. */
  id: string;
  /** The item's own `gacha_type` (ZZZ: the queried `real_gacha_type`). */
  bannerType: string;
  name: string;
  itemType: string;
  /** "3" | "4" | "5" */
  rank: string;
  /** "YYYY-MM-DD HH:MM:SS" server-local wall-clock. */
  time: string;
}

/** The JSON payload the PowerShell import scripts copy to the clipboard. */
export interface WishPayload {
  game: GameKey;
  uid: string;
  region: string;
  exportedAt: number;
  /** Ascending by id. */
  items: WishItem[];
}

/** A stored, merged pull history for one uid, keyed by game. */
export interface WishAccount {
  uid: string;
  region: string;
  /** Ascending by id. */
  items: WishItem[];
  updatedAt: number;
  /** Optional user-set label ("Main", "Alt") shown alongside the uid in the
   * account switcher. Preserved across re-imports. */
  nickname?: string;
  /** When `nickname` was last set, so a merge can resolve competing renames
   * last-write-wins (see restoreAccount). Deliberately separate from
   * `updatedAt`, which means "last imported pulls" and is shown to the user
   * as such — renaming must not make the UI claim a re-import. Absent on
   * accounts stored before this existed, and on accounts never renamed. */
  nicknameUpdatedAt?: number;
}
