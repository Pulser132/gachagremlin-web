import {
  bannerHideKey,
  eventHideKey,
  hideBanner,
  hideEvent,
  isBannerHidden,
  isEventHidden,
  unhideBanner,
  unhideEvent,
} from '../data/eventPrefs.ts';
import type { GameKey } from '../types.ts';
import type { HideRequest } from './timelineView.ts';

/** The most recent Timeline hide, held in memory only. */
export interface LastHide {
  text: string;
  /** Removes exactly the rule that hide added; null when the rule already existed. */
  undo: (() => void) | null;
  /** The bar that was hidden, to focus again after an undo. */
  barId: string;
}

/** Writes the rule for `req` and describes it so the Timeline can offer Undo. */
export function applyTimelineHide(game: GameKey, req: HideRequest): LastHide {
  if (req.kind === 'event') {
    const added = !isEventHidden(game, req.name);
    hideEvent(game, req.name);
    const key = eventHideKey(req.name);
    return {
      text: `Hid ${req.name} (all reruns).`,
      undo: added ? () => unhideEvent(game, key) : null,
      barId: req.barId,
    };
  }
  const added = !isBannerHidden(game, req.title);
  hideBanner(game, req.title);
  const key = bannerHideKey(req.title);
  return {
    text: `Hid ${req.title} (this run only).`,
    undo: added ? () => unhideBanner(game, key) : null,
    barId: req.barId,
  };
}
