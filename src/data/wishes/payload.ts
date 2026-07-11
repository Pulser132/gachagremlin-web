/**
 * Validates a pasted import payload before it touches storage. Errors are
 * plain strings meant to be shown verbatim in the import dialog.
 */
import { looksLikePaimonMoeLocalData, parsePaimonMoeLocalData } from './paimonMoe.ts';
import { parseUigfPayload, type ParseManyResult } from './uigf.ts';
import { GAME_CONFIGS } from '../wiki/games.ts';
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

/**
 * Accepts GachaGremlin's own clipboard payload (from public/import/*.ps1),
 * a UIGF v4 export from another tracker, or a paimon.moe local-data
 * backup — auto-detected, so there's no format picker in the dialog. A
 * UIGF or paimon.moe file can hold multiple accounts, so this always
 * returns an array — length 1 for the native format.
 *
 * paimon.moe local-data backups only ever contain Genshin data, and
 * GachaGremlin doesn't yet understand Star Rail Station's or stardb.gg's
 * own (non-UIGF) backup formats — see src/data/wishes/paimonMoe.ts.
 */
export function parseAnyImport(rawText: string, expectedGame: GameKey): ParseManyResult {
  // PowerShell's `Set-Content -Encoding UTF8` (the encoding the import
  // scripts use to write their temp file) always writes a UTF-8 BOM on
  // Windows PowerShell 5.1, which JSON.parse rejects outright. Strip it
  // defensively here rather than relying on every source to omit it.
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // The import scripts now copy a file *path* to the clipboard rather
    // than the file contents — a very plausible paste target is this
    // textarea instead of the "Choose File" picker. Give a specific hint
    // rather than the generic "not valid JSON" message in that case.
    if (/^(?:[A-Za-z]:\\|\\\\)\S+\.json$/.test(text.trim())) {
      return {
        ok: false,
        error: 'That looks like a file path, not the file itself. Click "Choose File" below, paste the path into the file picker, and select it there instead.',
      };
    }
    return {
      ok: false,
      error: 'That doesn’t look like valid JSON. Make sure you pasted or uploaded the entire file.',
    };
  }

  if (looksLikePaimonMoeLocalData(raw)) {
    if (expectedGame !== 'genshin') {
      return {
        ok: false,
        error: `This looks like a paimon.moe backup, which only contains Genshin data. Importing ${GAME_CONFIGS[expectedGame].label} history from another tracker's own backup format isn't supported yet — a UIGF export will still work if that tracker offers one.`,
      };
    }
    return parsePaimonMoeLocalData(text);
  }

  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && 'info' in raw) {
    return parseUigfPayload(text, expectedGame);
  }

  const result = parsePayload(text, expectedGame);
  if (!result.ok) return result;
  return { ok: true, payloads: [result.payload] };
}
