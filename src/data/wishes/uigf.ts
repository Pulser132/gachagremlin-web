/**
 * Converts a UIGF v4 export (the community interchange format supported by
 * paimon.moe, Star Rail Station, stardb.gg, and most other trackers) into
 * GachaGremlin's own WishPayload shape, so players who already have a
 * history file from one of those sites can import it directly instead of
 * re-running the PowerShell script.
 *
 * Spec: https://uigf.org/en/standards/uigf.html — one file can hold
 * multiple accounts of the same game (each `list` entry keyed by uid), so
 * this returns one WishPayload per account rather than a single payload.
 */
import { GAME_CONFIGS } from '../wiki/games.ts';
import type { GameKey, WishItem, WishPayload } from '../../types.ts';

export type ParseManyResult = { ok: true; payloads: WishPayload[] } | { ok: false; error: string };

const SECTION_KEY: Record<GameKey, 'hk4e' | 'hkrpg' | 'nap'> = {
  genshin: 'hk4e',
  hsr: 'hkrpg',
  zzz: 'nap',
};

const VALID_RANKS = new Set(['3', '4', '5']);

function toStringField(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * UIGF documents rank_type as "the rank of the item, returned by MiHoYo
 * API" — i.e. passed through raw, not normalized. ZZZ's raw API uses
 * rank_type 2/3/4 (B/A/S rank) instead of the 3/4/5-star scale Genshin/HSR
 * use, so a UIGF nap record needs the same remap public/import/zzz.ps1
 * applies, kept in sync with it deliberately.
 */
function normalizeRank(game: GameKey, rawRank: string): string | null {
  if (game !== 'zzz') {
    return VALID_RANKS.has(rawRank) ? rawRank : null;
  }
  switch (rawRank) {
    case '2':
      return '3';
    case '3':
      return '4';
    case '4':
      return '5';
    default:
      return null;
  }
}

type ConvertedRecord = WishItem | 'missing-name' | 'missing-rank' | 'invalid';

function convertRecord(game: GameKey, rec: unknown): ConvertedRecord {
  if (typeof rec !== 'object' || rec === null) return 'invalid';
  const r = rec as Record<string, unknown>;

  const id = toStringField(r.id);
  const bannerType = toStringField(r.gacha_type);
  const time = toStringField(r.time);
  if (!id || !bannerType || !time) return 'invalid';

  // Optional per the UIGF spec, but GachaGremlin needs both to render
  // history and compute pity — real exports from all three reference sites
  // include them, so this only rejects genuinely stripped-down files.
  const name = toStringField(r.name);
  if (!name) return 'missing-name';

  const rawRank = toStringField(r.rank_type);
  if (!rawRank) return 'missing-rank';
  const rank = normalizeRank(game, rawRank);
  if (!rank) return 'invalid';

  const itemType = toStringField(r.item_type) ?? '';

  return { id, bannerType, name, itemType, rank, time };
}

export function parseUigfPayload(text: string, expectedGame: GameKey): ParseManyResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That doesn’t look like valid JSON.' };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'This doesn’t look like a UIGF export file.' };
  }
  const v = raw as Record<string, unknown>;

  const info = v.info;
  if (typeof info !== 'object' || info === null) {
    return { ok: false, error: 'This doesn’t look like a UIGF export file (missing "info").' };
  }
  const infoObj = info as Record<string, unknown>;

  const version = infoObj.version;
  if (typeof version !== 'string' || !version.startsWith('v4')) {
    const found = typeof version === 'string' ? version : 'an unrecognized version';
    return {
      ok: false,
      error: `GachaGremlin supports UIGF v4 exports; this file reports ${found}. Try re-exporting from the newest version of the source site.`,
    };
  }

  const exportedAtRaw = infoObj.export_timestamp;
  const exportedAt =
    typeof exportedAtRaw === 'number'
      ? exportedAtRaw
      : typeof exportedAtRaw === 'string' && !Number.isNaN(Number(exportedAtRaw))
        ? Number(exportedAtRaw)
        : Math.floor(Date.now() / 1000);

  const gameLabel = GAME_CONFIGS[expectedGame].label;
  const sectionKey = SECTION_KEY[expectedGame];
  const section = v[sectionKey];
  if (!Array.isArray(section) || section.length === 0) {
    return { ok: false, error: `This file has no ${gameLabel} data in it.` };
  }

  const payloads: WishPayload[] = [];
  for (const accountRaw of section) {
    if (typeof accountRaw !== 'object' || accountRaw === null) continue;
    const account = accountRaw as Record<string, unknown>;
    const uid = toStringField(account.uid);
    const list = account.list;
    if (!uid || !Array.isArray(list) || list.length === 0) continue;

    const items: WishItem[] = [];
    for (const rec of list) {
      const converted = convertRecord(expectedGame, rec);
      if (converted === 'missing-name') {
        return {
          ok: false,
          error:
            'This file is missing item names, which GachaGremlin needs to show your pull history. Try a different export option on the source site, if available.',
        };
      }
      if (converted === 'missing-rank') {
        return {
          ok: false,
          error:
            'This file is missing rarity data, which GachaGremlin needs to calculate pity. Try a different export option on the source site, if available.',
        };
      }
      if (converted === 'invalid') {
        return { ok: false, error: 'One or more pulls in this file are malformed.' };
      }
      items.push(converted);
    }

    const region = typeof account.lang === 'string' ? account.lang : '';
    payloads.push({ game: expectedGame, uid, region, exportedAt, items });
  }

  if (payloads.length === 0) {
    return { ok: false, error: `No pulls found for ${gameLabel} in this file.` };
  }

  return { ok: true, payloads };
}
