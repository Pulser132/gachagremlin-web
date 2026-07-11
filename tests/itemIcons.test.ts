// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createItemIcon } from '../src/ui/itemIcons.ts';

function render(itemType: string, game: 'genshin' | 'hsr' | 'zzz' = 'genshin') {
  const wrap = document.createElement('div');
  wrap.appendChild(createItemIcon(itemType, game));
  return wrap;
}

describe('createItemIcon', () => {
  it('renders an aria-hidden svg plus a real (visually-hidden) text label', () => {
    const wrap = render('Character');
    const svg = wrap.querySelector('svg.item-icon')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('aria-hidden')).toBe('true');

    const label = wrap.querySelector('.sr-only')!;
    expect(label.textContent).toMatch(/character/i);
  });

  it.each([
    ['Character', 'genshin', /character/i],
    ['Weapon', 'genshin', /weapon/i],
    ['Agent', 'zzz', /character/i], // agents share the "person" glyph/label family
    ['Light Cone', 'hsr', /light cone/i],
    ['W-Engine', 'zzz', /w-engine/i],
    ['W-Engines', 'zzz', /w-engine/i], // the real ZZZ API returns this plural form
    ['Bangboo', 'zzz', /bangboo/i],
  ] as const)('labels %s (%s) correctly', (itemType, game, expected) => {
    const wrap = render(itemType, game);
    expect(wrap.querySelector('.sr-only')!.textContent).toMatch(expected);
  });

  it('falls back gracefully for an unrecognized itemType instead of throwing', () => {
    const wrap = render('SomethingNew');
    expect(wrap.querySelector('svg.item-icon')).not.toBeNull();
    expect(wrap.querySelector('.sr-only')!.textContent).toMatch(/item/i);
  });

  it('routes a blank itemType to the person glyph for non-Genshin games (most common case)', () => {
    const wrap = render('', 'zzz');
    expect(wrap.querySelector('.sr-only')!.textContent).toMatch(/character/i);
  });
});
