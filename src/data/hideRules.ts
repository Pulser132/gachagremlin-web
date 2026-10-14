/**
 * The one shared hide filter: tests Events and Banners against a player's
 * Hide rules (name rules, hidden sections, banner rules). Pure — callers load
 * the rules with `loadHidePrefs` and pass them in. The Events tab's "show
 * ended events" toggle is a view-local Filter, not a hide, and is not here.
 */
import type { BannerInfo, EventInfo, GameBanners, GameEvents } from '../types.ts';
import { categorizeEvent, type EventCategory } from './eventCategories.ts';
import { bannerHideKey, eventHideKey } from './eventPrefs.ts';

export interface HidePrefs {
  hiddenNames: string[];
  hiddenCategories: EventCategory[];
  hiddenBanners: string[];
}

export type HiddenKind = 'event' | 'banner';

export interface HideResult {
  events: GameEvents;
  banners: GameBanners | null;
  hiddenCount: number;
  hiddenKinds: HiddenKind[];
}

export function isEventHiddenBy(prefs: HidePrefs, ev: EventInfo): boolean {
  return (
    prefs.hiddenNames.includes(eventHideKey(ev.name)) ||
    prefs.hiddenCategories.includes(categorizeEvent(ev))
  );
}

export function isBannerHiddenBy(prefs: HidePrefs, banner: BannerInfo): boolean {
  return prefs.hiddenBanners.includes(bannerHideKey(banner.title));
}

export function applyHideRules(events: GameEvents, banners: GameBanners | null, prefs: HidePrefs): HideResult {
  let eventsHidden = 0;
  let bannersHidden = 0;
  const keepEvents = (list: EventInfo[]) =>
    list.filter((ev) => {
      if (!isEventHiddenBy(prefs, ev)) return true;
      eventsHidden++;
      return false;
    });
  const keepGroups = (groups: GameBanners['current']) =>
    groups.map((g) => ({
      ...g,
      banners: g.banners.filter((b) => {
        if (!isBannerHiddenBy(prefs, b)) return true;
        bannersHidden++;
        return false;
      }),
    }));

  const outEvents: GameEvents = { ...events, current: keepEvents(events.current), upcoming: keepEvents(events.upcoming) };
  const outBanners: GameBanners | null = banners
    ? { ...banners, current: keepGroups(banners.current), upcoming: keepGroups(banners.upcoming) }
    : null;

  const hiddenKinds: HiddenKind[] = [];
  if (eventsHidden > 0) hiddenKinds.push('event');
  if (bannersHidden > 0) hiddenKinds.push('banner');
  return { events: outEvents, banners: outBanners, hiddenCount: eventsHidden + bannersHidden, hiddenKinds };
}
