import { describe, expect, it } from 'vitest';
import { relativeAge } from '../src/ui/relativeAge.ts';

const NOW = 1_786_400_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeAge', () => {
  it.each([
    [0, 'just now'],
    [30_000, 'just now'],
    [MIN, '1m ago'],
    [59 * MIN, '59m ago'],
    [HOUR, '1h ago'],
    [2 * HOUR + 40 * MIN, '2h ago'],
    [23 * HOUR, '23h ago'],
    [DAY, '1d ago'],
    [6 * DAY + 23 * HOUR, '6d ago'],
    [7 * DAY, '1w ago'],
    [20 * DAY, '2w ago'],
    [30 * DAY, '1mo ago'],
    [200 * DAY, '6mo ago'],
    [365 * DAY, '1y ago'],
    [800 * DAY, '2y ago'],
  ])('%d ms old reads %s', (age, expected) => {
    expect(relativeAge(NOW - age, NOW)).toBe(expected);
  });

  it('treats a timestamp in the future (clock skew) as just now', () => {
    expect(relativeAge(NOW + 5 * MIN, NOW)).toBe('just now');
  });
});
