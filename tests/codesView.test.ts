// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderCodesView } from '../src/ui/codesView.ts';
import type { CodeItem } from '../src/data/codesApi.ts';

const item = (over: Partial<CodeItem>): CodeItem => ({
  game: 'genshin',
  code: 'ABC',
  status: 'active',
  rewards: [],
  premium: false,
  claimUrl: 'https://example.test/gift?code=ABC',
  firstSeenAt: 1000,
  expiredAt: null,
  ...over,
});

describe('renderCodesView', () => {
  it('lists live codes newest first with the game, and omits expired ones', () => {
    const view = renderCodesView('genshin', {
      items: [
        item({ code: 'OLD', firstSeenAt: 1000 }),
        item({ code: 'NEW', firstSeenAt: 3000 }),
        item({ code: 'GONE', firstSeenAt: 5000, status: 'expired', expiredAt: 6000 }),
      ],
      lastCheckedAt: 1_786_400_100_000,
    });
    const rows = [...view.querySelectorAll('.codes-card')];
    expect(rows.map((r) => r.querySelector('.codes-code')?.textContent)).toEqual(['NEW', 'OLD']);
    expect(rows[0].textContent).toContain('Genshin Impact');
    expect(view.textContent).not.toContain('GONE');
  });

  it('shows the empty message and last-checked time for an empty set', () => {
    const view = renderCodesView('hsr', { items: [], lastCheckedAt: 1_786_400_100_000 });
    expect(view.textContent).toContain('no live codes right now');
    expect(view.querySelector('.codes-checked')?.textContent).toContain('Last checked');
  });

  it('says so when the bot has not checked yet', () => {
    const view = renderCodesView('zzz', { items: [], lastCheckedAt: null });
    expect(view.querySelector('.codes-checked')?.textContent).toContain('not checked yet');
  });

  describe('hero cards', () => {
    const NOW = 1_786_400_000_000;
    const render = (items: CodeItem[]) => renderCodesView('genshin', { items, lastCheckedAt: NOW }, NOW);

    it('renders a card grid with Reward chips', () => {
      const view = render([item({ rewards: [{ item: 'Primogem', qty: 60 }, { item: 'Mora', qty: 10000 }], firstSeenAt: NOW })]);
      expect(view.querySelectorAll('.codes-grid > .codes-card')).toHaveLength(1);
      expect([...view.querySelectorAll('.codes-chip')].map((c) => c.textContent)).toEqual(['Primogem ×60', 'Mora ×10,000']);
    });

    it('still renders a usable card with no rewards', () => {
      const view = render([item({ rewards: [] })]);
      expect(view.querySelector('.codes-card .codes-code')?.textContent).toBe('ABC');
      expect(view.querySelector('.codes-card a.codes-claim')).not.toBeNull();
      expect(view.querySelectorAll('.codes-chip')).toHaveLength(0);
    });

    it('claim button opens claimUrl in a new tab', () => {
      const a = render([item({})]).querySelector<HTMLAnchorElement>('a.codes-claim')!;
      expect(a.getAttribute('href')).toBe('https://example.test/gift?code=ABC');
      expect(a.target).toBe('_blank');
      expect(a.rel).toContain('noopener');
    });

    it('badges recent codes NEW and older ones Active', () => {
      const view = render([item({ code: 'FRESH', firstSeenAt: NOW - 3600_000 }), item({ code: 'STALE', firstSeenAt: NOW - 5 * 86400_000 })]);
      const badges = [...view.querySelectorAll('.codes-badge')].map((b) => b.textContent);
      expect(badges).toEqual(['NEW', 'Active']);
    });

    it('copies the code on click and confirms visibly and to screen readers', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const view = render([item({ code: 'ABC123' })]);
      const btn = view.querySelector<HTMLButtonElement>('button.codes-code')!;
      expect(btn.tagName).toBe('BUTTON');
      expect(btn.getAttribute('aria-label')).toContain('ABC123');
      btn.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith('ABC123');
      expect(view.querySelector('.codes-copied')?.textContent).toBe('Copied!');
      expect(view.querySelector('.codes-copied')?.getAttribute('role')).toBe('status');
    });

    it('says so when copying fails', async () => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
      const view = render([item({})]);
      view.querySelector<HTMLButtonElement>('button.codes-code')!.click();
      await new Promise((r) => setTimeout(r, 0));
      expect(view.querySelector('.codes-copied')?.textContent).toContain('Copy failed');
    });
  });
});
