import { describe, expect, it } from 'vitest';
import { resolveRegionUnix } from '../src/ui/eventCard.ts';

describe('resolveRegionUnix', () => {
  it('returns the requested region when present', () => {
    expect(resolveRegionUnix({ America: 1, Europe: 2, Asia: 3 }, 'Europe')).toBe(2);
  });

  it('falls back to Asia when the region is absent (e.g. SAR on HSR/ZZZ)', () => {
    expect(resolveRegionUnix({ America: 1, Europe: 2, Asia: 3 }, 'SAR')).toBe(3);
  });

  it('falls back to any value when even Asia is absent', () => {
    expect(resolveRegionUnix({ America: 42 }, 'SAR')).toBe(42);
  });

  it('returns null for a null map', () => {
    expect(resolveRegionUnix(null, 'America')).toBeNull();
  });
});
