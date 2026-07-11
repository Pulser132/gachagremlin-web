/**
 * Converts a paimon.moe "local data" backup (paimon.moe's own Settings ->
 * Export Local Data feature) into GachaGremlin's WishPayload shape. This is
 * NOT the UIGF format — it's paimon.moe's internal save-data shape: each
 * banner's pulls are stored by item slug (e.g. "hu_tao"), with no per-pull
 * id, display name, or rarity of its own. Converting therefore needs two
 * things the raw file doesn't provide:
 *
 *   1. A slug -> {name, rarity} lookup (paimonMoeItems.ts, extracted from
 *      paimon.moe's own open-source item database).
 *   2. A synthesized, sortable id — GachaGremlin's WishItem.id doubles as
 *      the sort/dedupe key everywhere (see store.ts's compareIds), but
 *      paimon.moe's pull records carry no id at all, only a timestamp.
 *
 * Genshin only. paimon.moe doesn't track Star Rail or Zenless Zone Zero, and
 * GachaGremlin doesn't yet understand Star Rail Station's or stardb.gg's
 * own (non-UIGF) backup formats — importing those games from another
 * tracker's site-specific backup, as opposed to a UIGF export, is not
 * implemented yet.
 */
import { PAIMON_MOE_CHARACTERS, PAIMON_MOE_WEAPONS } from './paimonMoeItems.ts';
import type { ParseManyResult } from './uigf.ts';
import type { WishItem } from '../../types.ts';

const BANNER_KEYS = [
  'wish-counter-beginners',
  'wish-counter-standard',
  'wish-counter-character-event',
  'wish-counter-weapon-event',
  'wish-counter-chronicled',
];

const VALID_RARITIES = new Set([3, 4, 5]);

/** Cheap shape check used by the format dispatcher before committing to a
 * full parse — a paimon.moe backup always has a top-level "wish-uid" plus
 * at least one "wish-counter-*" key. */
export function looksLikePaimonMoeLocalData(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const v = raw as Record<string, unknown>;
  if (!('wish-uid' in v)) return false;
  return BANNER_KEYS.some((key) => key in v);
}

/**
 * Naive local timestamp -> epoch seconds. paimon.moe pull times, like every
 * other format GachaGremlin reads, carry no timezone marker; this is used
 * purely to build sortable synthetic ids (below) and to recognize them
 * again (dedupe.ts) — never shown to the user, never compared against a
 * real timezone.
 */
export function toEpochSeconds(time: string): number {
  const ms = Date.parse(`${time.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

export function parsePaimonMoeLocalData(text: string): ParseManyResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That doesn’t look like valid JSON.' };
  }

  if (!looksLikePaimonMoeLocalData(raw)) {
    return { ok: false, error: 'This doesn’t look like a paimon.moe local-data backup.' };
  }
  const v = raw as Record<string, unknown>;

  const rawUid = v['wish-uid'];
  const uid = typeof rawUid === 'string' ? rawUid : typeof rawUid === 'number' ? String(rawUid) : null;
  if (!uid) {
    return { ok: false, error: 'This file is missing a "wish-uid".' };
  }

  const region = typeof v.server === 'string' ? v.server : '';
  const exportedAtRaw = v['update-time'];
  const parsedExportedAt = typeof exportedAtRaw === 'string' ? Date.parse(exportedAtRaw) : NaN;
  const exportedAt = Number.isNaN(parsedExportedAt) ? Math.floor(Date.now() / 1000) : Math.floor(parsedExportedAt / 1000);

  const items: WishItem[] = [];
  const unknownIds = new Set<string>();
  const seqByBannerSecond = new Map<string, number>();

  for (const bannerKey of BANNER_KEYS) {
    const counterObj = v[bannerKey];
    if (typeof counterObj !== 'object' || counterObj === null) continue;
    const pulls = (counterObj as Record<string, unknown>).pulls;
    if (!Array.isArray(pulls)) continue;

    for (const rec of pulls) {
      if (typeof rec !== 'object' || rec === null) continue;
      const r = rec as Record<string, unknown>;
      const { type, id, code, time } = r;
      if (typeof id !== 'string' || typeof time !== 'string') continue;
      if (typeof code !== 'string' && typeof code !== 'number') continue;

      const db = type === 'character' ? PAIMON_MOE_CHARACTERS : type === 'weapon' ? PAIMON_MOE_WEAPONS : null;
      const entry = db ? db[id] : undefined;
      if (!entry || !VALID_RARITIES.has(entry.rarity)) {
        unknownIds.add(id);
        continue;
      }

      // No real pull id exists in this format — synthesize one: 10-digit
      // epoch second + 3-digit banner code + 6-digit sequence within that
      // (banner, second) group. 19 digits total, so it sorts correctly
      // alongside real HoYoverse API ids (compareIds sorts by length
      // first). Critically, this is DETERMINISTIC per pull: banner history
      // is append-only, so a pull's (banner, second, position-in-second)
      // never changes across re-exports — re-importing an updated backup
      // regenerates identical ids and dedupes cleanly. An earlier scheme
      // used one file-wide running counter, which shifted every later
      // banner's ids whenever an earlier banner gained pulls, duplicating
      // history on re-import. dedupe.ts's classifier relies on this exact
      // layout — keep the two in sync.
      const epochPart = String(toEpochSeconds(time)).padStart(10, '0');
      const codePart = String(code).padStart(3, '0').slice(-3);
      const seqKey = `${codePart}|${epochPart}`;
      const seq = seqByBannerSecond.get(seqKey) ?? 0;
      seqByBannerSecond.set(seqKey, seq + 1);
      const syntheticId = `${epochPart}${codePart}${String(seq).padStart(6, '0')}`;

      items.push({
        id: syntheticId,
        bannerType: String(code),
        name: entry.name,
        itemType: type === 'character' ? 'Character' : 'Weapon',
        rank: String(entry.rarity),
        time,
      });
    }
  }

  if (unknownIds.size > 0) {
    const sample = [...unknownIds][0];
    return {
      ok: false,
      error: `This file references ${unknownIds.size} item(s) GachaGremlin doesn't recognize yet (e.g. "${sample}"). It may be a newer paimon.moe export than GachaGremlin's built-in item list covers.`,
    };
  }

  if (items.length === 0) {
    return { ok: false, error: 'No wishes were found in this file.' };
  }

  return { ok: true, payloads: [{ game: 'genshin', uid, region, exportedAt, items }] };
}
