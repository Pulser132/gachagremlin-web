import { describe, expect, it } from 'vitest';
import { formatCountdown } from '../src/ui/format.ts';

describe('formatCountdown', () => {
  const now = 1_000_000_000;

  it('shows days + hours + minutes when more than a day remains', () => {
    const deadline = now / 1000 + 3 * 86400 + 14 * 3600 + 2 * 60;
    expect(formatCountdown(deadline, now)).toBe('3d 14h 02m');
  });

  it('shows hours + minutes under a day', () => {
    const deadline = now / 1000 + 2 * 3600 + 5 * 60;
    expect(formatCountdown(deadline, now)).toBe('2h 05m');
  });

  it('shows minutes + seconds under an hour', () => {
    const deadline = now / 1000 + 90;
    expect(formatCountdown(deadline, now)).toBe('1m 30s');
  });

  it('shows seconds only under a minute', () => {
    const deadline = now / 1000 + 5;
    expect(formatCountdown(deadline, now)).toBe('5s');
  });

  it('reports ended at or past the deadline', () => {
    expect(formatCountdown(now / 1000, now)).toBe('ended');
    expect(formatCountdown(now / 1000 - 10, now)).toBe('ended');
  });
});
