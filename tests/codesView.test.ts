// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
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
    const rows = [...view.querySelectorAll('.codes-item')];
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
});
