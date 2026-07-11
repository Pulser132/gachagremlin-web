import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dedupeCrossSource } from '../src/data/wishes/dedupe.ts';
import { getActiveAccount, importPayload } from '../src/data/wishes/store.ts';
import type { WishAccount, WishItem, WishPayload } from '../src/types.ts';

// Same in-memory Storage stand-in used by tests/cache.test.ts and
// tests/wishStore.test.ts.
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

// '2026-01-01 00:00:00' parsed as UTC = 1767225600 — the epoch prefix a
// synthetic id for that time embeds.
const TIME = '2026-01-01 00:00:00';
const EPOCH = '1767225600';

function item(id: string, overrides: Partial<WishItem> = {}): WishItem {
  return { id, bannerType: '301', name: 'Sandrone', itemType: 'Character', rank: '5', time: TIME, ...overrides };
}

/** Real HoYoverse-style id: day-boundary epoch prefix (≠ the pull's exact
 * second) + server sequence, 19 digits. */
const realId = (seq: string) => `1767139200${seq.padStart(9, '0')}`;
/** Current deterministic synthetic scheme: epoch + 3-digit banner code + seq. */
const synNewId = (seq: string, code = '301') => `${EPOCH}${code}${seq.padStart(6, '0')}`;
/** Legacy synthetic scheme: epoch + zero-padded file-wide counter. */
const synOldId = (counter: string) => `${EPOCH}${counter.padStart(9, '0')}`;

describe('dedupeCrossSource', () => {
  it('collapses the same pull imported once with a synthetic id and once with a real id', () => {
    const result = dedupeCrossSource([item(synNewId('0')), item(realId('42'))]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(realId('42')); // real API id wins
  });

  it('collapses legacy-scheme synthetic ids against real ids too', () => {
    const result = dedupeCrossSource([item(synOldId('1234')), item(realId('42'))]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(realId('42'));
  });

  it('keeps legitimate same-second duplicates from a single source', () => {
    // Two Favonius Swords landing in one 10-pull: same content, same
    // second, both real ids — genuinely two pulls.
    const twins = [
      item(realId('42'), { name: 'Favonius Sword', rank: '4', itemType: 'Weapon' }),
      item(realId('43'), { name: 'Favonius Sword', rank: '4', itemType: 'Weapon' }),
    ];
    expect(dedupeCrossSource(twins)).toHaveLength(2);
  });

  it('collapses pairwise when both sources report the same legitimate duplicates', () => {
    // Two real copies + two synthetic copies of the same content = two
    // physical pulls reported by two sources. Keep the two real ones.
    const result = dedupeCrossSource([
      item(realId('42'), { name: 'Favonius Sword', rank: '4' }),
      item(realId('43'), { name: 'Favonius Sword', rank: '4' }),
      item(synNewId('0'), { name: 'Favonius Sword', rank: '4' }),
      item(synNewId('1'), { name: 'Favonius Sword', rank: '4' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.id.startsWith('1767139200'))).toBe(true);
  });

  it('keeps the larger partition when one source saw more pulls than the other', () => {
    const result = dedupeCrossSource([
      item(realId('42'), { name: 'Favonius Sword', rank: '4' }),
      item(synNewId('0'), { name: 'Favonius Sword', rank: '4' }),
      item(synNewId('1'), { name: 'Favonius Sword', rank: '4' }),
    ]);
    expect(result).toHaveLength(2); // the synthetic pair is the fuller record
  });

  it('does not conflate different items, times, banners, or ranks', () => {
    const distinct = [
      item(synNewId('0')),
      item(realId('42'), { name: 'Columbina' }), // different item
      item(realId('43'), { time: '2026-01-01 00:00:01' }), // different second
      item(realId('44'), { bannerType: '400' }), // different banner
    ];
    expect(dedupeCrossSource(distinct)).toHaveLength(4);
  });

  it('returns the input array untouched when there is nothing to collapse', () => {
    const items = [item(realId('42')), item(realId('43'), { name: 'Columbina' })];
    expect(dedupeCrossSource(items)).toBe(items);
  });
});

function payload(items: WishItem[]): WishPayload {
  return { game: 'genshin', uid: '630164299', region: 'America', exportedAt: 1000, items };
}

describe('cross-source dedupe in the store', () => {
  it('importing the script payload after a backup import does not duplicate the overlap', () => {
    importPayload(payload([item(synNewId('0'))])); // backup first
    const merged = importPayload(payload([item(realId('42'))])); // then the PS script

    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].id).toBe(realId('42'));
  });

  it('repairs an already-duplicated stored account on read, and persists the repair', () => {
    // Simulate an account polluted before the fix existed: same Sandrone
    // pull stored under both a legacy synthetic id and its real id.
    const polluted: WishAccount = {
      uid: '630164299',
      region: 'America',
      items: [item(synOldId('639')), item(realId('42'))],
      updatedAt: 1000,
    };
    localStorage.setItem('gachagremlin:wishes:genshin:630164299', JSON.stringify(polluted));
    localStorage.setItem('gachagremlin:wishes:genshin:activeUid', '630164299');

    const account = getActiveAccount('genshin');
    expect(account?.items).toHaveLength(1);
    expect(account?.items[0].id).toBe(realId('42'));

    // The repair must be persisted, not recomputed on every read.
    const stored = JSON.parse(localStorage.getItem('gachagremlin:wishes:genshin:630164299')!) as WishAccount;
    expect(stored.items).toHaveLength(1);
  });
});
