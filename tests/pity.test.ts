import { describe, expect, it } from 'vitest';
import { GAME_BANNER_CONFIGS, findBannerGroup } from '../src/data/wishes/banners.ts';
import { guaranteeState, pityAtEach5Star, pityCounts } from '../src/data/wishes/pity.ts';
import type { WishItem } from '../src/types.ts';

const characterGroup = findBannerGroup('genshin', '301')!;
const weaponGroup = findBannerGroup('genshin', '302')!;
const standardPool = GAME_BANNER_CONFIGS.genshin.standardPool5Star;

function item(id: string, bannerType: string, rank: '3' | '4' | '5', name = 'Test'): WishItem {
  return { id, bannerType, name, itemType: rank === '3' ? 'Weapon' : 'Character', rank, time: '2026-01-01 00:00:00' };
}

describe('pityCounts', () => {
  it('counts pulls since the last 5★ and 4★, ignoring other banner groups', () => {
    const items = [
      item('1', '301', '3'),
      item('2', '301', '3'),
      item('3', '301', '4'),
      item('4', '302', '5'), // different banner group — must not affect the count
      item('5', '301', '5'),
      item('6', '301', '3'),
      item('7', '301', '4'),
      item('8', '301', '3'),
    ];

    expect(pityCounts(items, characterGroup)).toEqual({ since5Star: 3, since4Star: 1, total: 7 });
  });

  it('folds Genshin bannerType 400 into the 301 character group', () => {
    const items = [item('1', '301', '3'), item('2', '400', '3'), item('3', '301', '4')];
    expect(pityCounts(items, characterGroup)).toEqual({ since5Star: 3, since4Star: 0, total: 3 });
  });

  it('returns zeros for an empty history', () => {
    expect(pityCounts([], characterGroup)).toEqual({ since5Star: 0, since4Star: 0, total: 0 });
  });
});

describe('guaranteeState', () => {
  it('is not guaranteed with no 5★ pulled yet', () => {
    const items = [item('1', '301', '3'), item('2', '301', '4')];
    expect(guaranteeState(items, characterGroup, standardPool)).toEqual({ guaranteed: false });
  });

  it('is guaranteed after losing the 50/50 (standard-pool 5★ landed)', () => {
    const items = [item('1', '301', '3'), item('2', '301', '5', 'Diluc')]; // Diluc is in the standard pool
    expect(guaranteeState(items, characterGroup, standardPool)).toEqual({ guaranteed: true });
  });

  it('resets after winning the 50/50 (non-standard 5★ landed)', () => {
    const items = [item('1', '301', '5', 'Diluc'), item('2', '301', '5', 'Furina')]; // Furina is limited
    expect(guaranteeState(items, characterGroup, standardPool)).toEqual({ guaranteed: false });
  });

  it('resets after the guarantee is consumed (limited 5★ landed after a loss)', () => {
    const items = [item('1', '301', '5', 'Diluc'), item('2', '301', '3'), item('3', '301', '5', 'Furina')];
    expect(guaranteeState(items, characterGroup, standardPool)).toEqual({ guaranteed: false });
  });

  it('does not apply to banner groups without a 50/50 split', () => {
    const items = [item('1', '302', '5', 'Diluc')];
    expect(guaranteeState(items, weaponGroup, standardPool)).toEqual({ guaranteed: false });
  });
});

describe('pityAtEach5Star', () => {
  it('maps each 5★ id to the pull count it took, counted from the previous 5★', () => {
    const items = [
      item('1', '301', '3'),
      item('2', '301', '3'),
      item('3', '301', '5', 'A'), // pity 3
      item('4', '301', '3'),
      item('5', '301', '5', 'B'), // pity 2
    ];
    const result = pityAtEach5Star(items, characterGroup);
    expect(result.get('3')).toBe(3);
    expect(result.get('5')).toBe(2);
    expect(result.size).toBe(2);
  });
});
