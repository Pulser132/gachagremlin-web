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
