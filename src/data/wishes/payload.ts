/**
 * Validates a pasted import payload before it touches storage. Errors are
 * plain strings meant to be shown verbatim in the import dialog.
 */
import type { GameKey, WishItem, WishPayload } from '../../types.ts';

export type ParseResult = { ok: true; payload: WishPayload } | { ok: false; error: string };

const GAME_KEYS: GameKey[] = ['genshin', 'hsr', 'zzz'];
const VALID_RANKS = new Set(['3', '4', '5']);

function isWishItem(value: unknown): value is WishItem {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.bannerType === 'string' &&
    v.bannerType.length > 0 &&
    typeof v.name === 'string' &&
    typeof v.itemType === 'string' &&
    typeof v.rank === 'string' &&
    VALID_RANKS.has(v.rank) &&
    typeof v.time === 'string'
  );
}

export function parsePayload(text: string, expectedGame: GameKey): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: 'That doesn’t look like valid JSON. Make sure you pasted the entire clipboard contents.',
    };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'The pasted data isn’t a wish import payload.' };
  }
  const v = raw as Record<string, unknown>;

  if (typeof v.game !== 'string' || !GAME_KEYS.includes(v.game as GameKey)) {
    return { ok: false, error: 'Missing or unrecognized "game" field in the pasted data.' };
  }
  if (v.game !== expectedGame) {
    return {
      ok: false,
      error: `This payload is for ${v.game}, not ${expectedGame}. Run the matching import script and paste its output here.`,
    };
  }
  if (typeof v.uid !== 'string' || v.uid.length === 0) {
    return { ok: false, error: 'Missing "uid" field in the pasted data.' };
  }
  if (typeof v.region !== 'string') {
    return { ok: false, error: 'Missing "region" field in the pasted data.' };
  }
  if (typeof v.exportedAt !== 'number') {
    return { ok: false, error: 'Missing "exportedAt" field in the pasted data.' };
  }
  if (!Array.isArray(v.items) || v.items.length === 0) {
    return {
      ok: false,
      error: 'No pulls found in the pasted data. Make sure you opened your history in-game before running the script.',
    };
  }
  if (!v.items.every(isWishItem)) {
    return { ok: false, error: 'One or more pulls in the pasted data are malformed.' };
  }

  return {
    ok: true,
    payload: {
      game: v.game as GameKey,
      uid: v.uid,
      region: v.region,
      exportedAt: v.exportedAt,
      items: v.items as WishItem[],
    },
  };
}
