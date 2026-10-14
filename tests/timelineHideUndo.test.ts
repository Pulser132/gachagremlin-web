// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { hideBanner, hideEvent, listHiddenBanners, listHiddenNames } from '../src/data/eventPrefs.ts';
import { applyTimelineHide } from '../src/ui/timelineHideUndo.ts';

afterEach(() => localStorage.clear());

describe('applyTimelineHide', () => {
  it('describes an Event hide as all reruns and undoes only that rule', () => {
    hideBanner('genshin', 'Luna/x');
    const h = applyTimelineHide('genshin', { kind: 'event', name: 'Ev: Sub', nextBarId: null, barId: 'b1' });
    expect(h.text).toBe('Hid Ev: Sub (all reruns).');
    expect(h.barId).toBe('b1');
    expect(listHiddenNames('genshin')).toEqual(['ev']);
    h.undo!();
    expect(listHiddenNames('genshin')).toEqual([]);
    expect(listHiddenBanners('genshin')).toEqual(['luna/x']);
  });

  it('describes a Banner hide as this run only and leaves Event rules alone', () => {
    hideEvent('genshin', 'Ev');
    const h = applyTimelineHide('genshin', { kind: 'banner', title: 'Luna/x', nextBarId: null, barId: 'b2' });
    expect(h.text).toBe('Hid Luna/x (this run only).');
    expect(listHiddenBanners('genshin')).toEqual(['luna/x']);
    h.undo!();
    expect(listHiddenBanners('genshin')).toEqual([]);
    expect(listHiddenNames('genshin')).toEqual(['ev']);
  });

  it('offers no undo when the rule already existed', () => {
    hideEvent('genshin', 'Ev');
    expect(applyTimelineHide('genshin', { kind: 'event', name: 'Ev', nextBarId: null, barId: 'b' }).undo).toBeNull();
    hideBanner('genshin', 'Luna/x');
    expect(applyTimelineHide('genshin', { kind: 'banner', title: 'Luna/x', nextBarId: null, barId: 'b' }).undo).toBeNull();
  });
});
