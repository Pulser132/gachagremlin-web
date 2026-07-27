import { exportAll, importBackup } from '../data/backup.ts';
import { cachedSource } from '../data/cache.ts';
import { connect, disconnect, getToken, isConnected } from '../data/cloud/auth.ts';
import { isCloudConfigured } from '../data/cloud/config.ts';
import { configureSync, getSyncState, onSyncStateChange, scheduleSync, setOnMerged, syncNow } from '../data/cloud/sync.ts';
import { categorizeEvent, EVENT_CATEGORIES, type EventCategory } from '../data/eventCategories.ts';
import {
  eventHideKey,
  hideEvent,
  listHiddenCategories,
  listHiddenNames,
  setCategoryHidden,
  unhideEvent,
} from '../data/eventPrefs.ts';
import { DEFAULT_EVENT_SORT, isEventSortOrder, sortEvents, type EventSortOrder, type SortableEvent } from '../data/eventSort.ts';
import { eventKey, listReminders } from '../data/reminders.ts';
import { GAME_CONFIGS, GAME_KEYS } from '../data/wiki/games.ts';
import { WikiSource } from '../data/wiki/wikiSource.ts';
import type { EventInfo, GameEvents, GameKey, Region } from '../types.ts';
import { startCountdownTicker } from './countdown.ts';
import { renderEventCard, resolveRegionUnix } from './eventCard.ts';
import { renderWishesView } from './wishesView.ts';

/** How close (seconds) a belled event's start/end must be to surface in the
 * "starting/ending soon" reminder banner. */
const REMINDER_WINDOW_SECONDS = 72 * 60 * 60;

const GAME_PREF_KEY = 'gachagremlin:selectedGame';
const REGION_PREF_KEY = 'gachagremlin:selectedRegion';
const VIEW_PREF_KEY = 'gachagremlin:selectedView';
const EVENT_SORT_PREF_KEY = 'gachagremlin:eventSort';

const EVENT_SORT_OPTIONS: { value: EventSortOrder; label: string }[] = [
  { value: 'wiki', label: 'Wiki order' },
  { value: 'time', label: 'Time' },
  { value: 'name', label: 'Name' },
];
const REGIONS: Region[] = ['America', 'Europe', 'Asia', 'SAR'];

type ViewMode = 'events' | 'wishes';
const VIEWS: { key: ViewMode; label: string }[] = [
  { key: 'events', label: 'Events' },
  { key: 'wishes', label: 'Wishes' },
];

const source = cachedSource(new WikiSource());

function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable (e.g. private browsing) — the picker just
    // won't persist across reloads; the site still works.
  }
}

export function mountApp(root: HTMLElement): void {
  let game: GameKey = (loadPref(GAME_PREF_KEY) as GameKey) ?? 'genshin';
  let region: Region = (loadPref(REGION_PREF_KEY) as Region) ?? 'America';
  let view: ViewMode = (loadPref(VIEW_PREF_KEY) as ViewMode) ?? 'events';
  const storedSort = loadPref(EVENT_SORT_PREF_KEY);
  let sortOrder: EventSortOrder = isEventSortOrder(storedSort) ? storedSort : DEFAULT_EVENT_SORT;
  let showEnded = false;

  root.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'app-header';
  header.appendChild(buildTitle());

  const tabs = document.createElement('nav');
  tabs.className = 'game-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Game');
  const tabButtons = GAME_KEYS.map((key) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = GAME_CONFIGS[key].label;
    btn.className = `game-tab game-tab-${key}`;
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => {
      game = key;
      if (region === 'SAR' && game !== 'genshin') {
        region = 'Asia'; // SAR only exists in Genshin; don't strand the picker on it
        savePref(REGION_PREF_KEY, region);
      }
      savePref(GAME_PREF_KEY, game);
      render();
    });
    tabs.appendChild(btn);
    return btn;
  });
  header.appendChild(tabs);

  const viewTabs = document.createElement('nav');
  viewTabs.className = 'view-tabs';
  viewTabs.setAttribute('role', 'tablist');
  viewTabs.setAttribute('aria-label', 'View');
  const viewButtons = VIEWS.map(({ key, label }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.className = 'view-tab';
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => {
      view = key;
      savePref(VIEW_PREF_KEY, view);
      render();
    });
    viewTabs.appendChild(btn);
    return btn;
  });
  header.appendChild(viewTabs);

  const controls = document.createElement('div');
  controls.className = 'controls';

  const regionLabel = document.createElement('label');
  regionLabel.className = 'region-picker';
  regionLabel.append('Server region: ');
  const regionSelect = document.createElement('select');
  regionSelect.setAttribute('aria-label', 'Server region');
  for (const r of REGIONS) {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r === 'SAR' ? 'TW/HK/MO (SAR)' : r;
    regionSelect.appendChild(opt);
  }
  regionSelect.addEventListener('change', () => {
    region = regionSelect.value as Region;
    savePref(REGION_PREF_KEY, region);
    render();
  });
  regionLabel.appendChild(regionSelect);
  controls.appendChild(regionLabel);

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.className = 'refresh-button';
  refreshBtn.addEventListener('click', () => render(true));
  controls.appendChild(refreshBtn);

  const lastUpdated = document.createElement('span');
  lastUpdated.className = 'last-updated';
  controls.appendChild(lastUpdated);

  header.appendChild(controls);
  root.appendChild(header);

  const status = document.createElement('div');
  status.className = 'status-banner';
  status.hidden = true;
  root.appendChild(status);

  const reminderBanner = document.createElement('div');
  reminderBanner.className = 'reminder-banner';
  reminderBanner.hidden = true;
  reminderBanner.setAttribute('role', 'status');
  root.appendChild(reminderBanner);

  const main = document.createElement('main');
  root.appendChild(main);

  root.appendChild(buildDataFooter(() => render()));

  // Hand cloud sync its auth implementation. Importing auth.ts is inert — the
  // GIS script is only injected during an interactive Connect click, and
  // background token refresh is a plain fetch to the OAuth worker — so this
  // costs nothing for users who never connect.
  configureSync({ getToken: (opts) => getToken(opts), isConnected });
  // A merge that pulled data in needs the view refreshed to show it.
  setOnMerged(() => void render());

  // Bumped at the start of every render() call. A render that's still
  // awaiting the events fetch when a newer render() starts (e.g. switching
  // to the Wishes tab, or to another game, before a slow wiki fetch
  // resolves) checks this after the await and bails instead of clobbering
  // whatever the newer render already put in `main`.
  let renderGen = 0;

  async function render(forceRefresh = false): Promise<void> {
    const myGen = ++renderGen;
    // Set on <html>, not #app: the per-game accent/geometry tokens it drives
    // (src/styles.css) need to reach the import dialog too, which is
    // appended to document.body (outside #app) so native <dialog> gets a
    // real top-layer stacking context.
    document.documentElement.dataset.game = game;
    tabButtons.forEach((btn, i) => btn.setAttribute('aria-selected', String(GAME_KEYS[i] === game)));
    viewButtons.forEach((btn, i) => btn.setAttribute('aria-selected', String(VIEWS[i].key === view)));
    Array.from(regionSelect.options).forEach((opt) => {
      opt.hidden = opt.value === 'SAR' && game !== 'genshin';
    });
    regionSelect.value = region;

    const wishesMode = view === 'wishes';
    regionLabel.hidden = wishesMode;
    refreshBtn.hidden = wishesMode;
    lastUpdated.hidden = wishesMode;
    status.hidden = true;
    reminderBanner.hidden = true;

    if (wishesMode) {
      main.innerHTML = '';
      main.appendChild(renderWishesView(game, () => render()));
      main.setAttribute('aria-busy', 'false');
      return;
    }

    main.setAttribute('aria-busy', 'true');
    main.innerHTML = '';
    main.appendChild(buildSkeleton());

    let data: GameEvents;
    try {
      data = forceRefresh ? await source.forceRefresh(game) : await source.fetchEvents(game);
    } catch (e) {
      if (myGen !== renderGen) return; // a newer render (e.g. switching to Wishes) already won
      main.innerHTML = '';
      status.hidden = false;
      status.textContent = `Couldn't load ${GAME_CONFIGS[game].label} events: ${(e as Error).message}. Try Refresh in a moment.`;
      main.setAttribute('aria-busy', 'false');
      return;
    }
    if (myGen !== renderGen) return; // a newer render (e.g. switching to Wishes) already won

    status.hidden = !data.stale;
    if (data.stale) {
      status.textContent = `The wiki couldn't be reached — showing cached data from ${new Date(data.fetchedAt).toLocaleString()}.`;
    }
    lastUpdated.textContent = `Last updated ${new Date(data.fetchedAt).toLocaleTimeString()}`;

    main.innerHTML = '';
    main.appendChild(buildEventsView(data));

    populateReminderBanner(reminderBanner, game, data, region);

    main.setAttribute('aria-busy', 'false');
    startCountdownTicker();
  }

  /**
   * The events view: toolbar (sort / sections / ended toggle), one section per
   * visible category, and the collapsed Hidden list at the bottom. The old
   * Current/Upcoming split is carried by each card's status badge instead of
   * the layout. Closure over mountApp state (game, region, sortOrder,
   * showEnded) on purpose — every control mutates state and re-renders.
   */
  function buildEventsView(data: GameEvents): DocumentFragment {
    const frag = document.createDocumentFragment();
    const onToggleReminder = () => render();
    const onHide = (ev: EventInfo) => {
      hideEvent(game, ev.name);
      scheduleSync('merge'); // hiding is additive — a union merge preserves it
      render();
    };

    // One storage read per render; every event is tested against the Set.
    const hiddenRules = listHiddenNames(game);
    const hidden = new Set(hiddenRules);
    const hiddenCategories = new Set(listHiddenCategories(game));

    // Position in Current-then-Upcoming IS wiki order (the index page's own).
    const all: SortableEvent[] = [...data.current, ...data.upcoming].map((ev, wikiIndex) => ({ ev, wikiIndex }));

    const ruleMatches = new Map<string, number>();
    const byCategory = new Map<EventCategory, SortableEvent[]>(EVENT_CATEGORIES.map(({ key }) => [key, []]));
    let endedCount = 0;
    for (const item of all) {
      const key = eventHideKey(item.ev.name);
      if (hidden.has(key)) {
        ruleMatches.set(key, (ruleMatches.get(key) ?? 0) + 1);
        continue;
      }
      const category = categorizeEvent(item.ev);
      if (hiddenCategories.has(category)) continue;
      // Count only ended events the toggle could actually reveal — rule- and
      // section-hidden ones stay hidden either way.
      if (item.ev.status === 'ended') {
        endedCount++;
        if (!showEnded) continue;
      }
      byCategory.get(category)!.push(item);
    }

    frag.appendChild(buildEventsToolbar(endedCount, hiddenCategories));

    let renderedAny = false;
    for (const { key, label } of EVENT_CATEGORIES) {
      const items = byCategory.get(key)!;
      // Empty sections are skipped entirely (HSR often has zero Web events);
      // the Sections-menu checkbox still lists them, so the pref survives.
      if (hiddenCategories.has(key) || items.length === 0) continue;
      const sorted = sortEvents(items, sortOrder, region);
      frag.appendChild(buildSection(label, sorted.map((i) => i.ev), region, onToggleReminder, onHide));
      renderedAny = true;
    }
    if (!renderedAny) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No events to show — everything is hidden or filtered. Check the Sections menu above or the Hidden list below.';
      frag.appendChild(empty);
    }

    const hiddenSection = buildHiddenSection(hiddenRules, ruleMatches);
    if (hiddenSection) frag.appendChild(hiddenSection);
    return frag;
  }

  function buildEventsToolbar(endedCount: number, hiddenCategories: Set<EventCategory>): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'events-toolbar';

    const sortLabel = document.createElement('label');
    sortLabel.className = 'events-sort';
    sortLabel.append('Sort: ');
    const sortSelect = document.createElement('select');
    sortSelect.setAttribute('aria-label', 'Sort events');
    for (const { value, label } of EVENT_SORT_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      sortSelect.appendChild(opt);
    }
    sortSelect.value = sortOrder;
    sortSelect.addEventListener('change', () => {
      sortOrder = isEventSortOrder(sortSelect.value) ? sortSelect.value : DEFAULT_EVENT_SORT;
      savePref(EVENT_SORT_PREF_KEY, sortOrder);
      render();
    });
    sortLabel.appendChild(sortSelect);
    toolbar.appendChild(sortLabel);

    // Native <details> menu: opens/closes without any popover JS.
    const menu = document.createElement('details');
    menu.className = 'events-sections-menu';
    const summary = document.createElement('summary');
    summary.textContent = 'Sections';
    menu.appendChild(summary);
    const list = document.createElement('div');
    list.className = 'events-sections-list';
    for (const { key, label } of EVENT_CATEGORIES) {
      const checkboxLabel = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !hiddenCategories.has(key);
      checkbox.addEventListener('change', () => {
        const hide = !checkbox.checked;
        setCategoryHidden(game, key, hide);
        // Hiding is additive (merge unions it up); re-showing is destructive —
        // a merge would resurrect the hide from the cloud copy, so push over it.
        scheduleSync(hide ? 'merge' : 'push-only');
        render();
      });
      checkboxLabel.append(checkbox, ` ${label}`);
      list.appendChild(checkboxLabel);
    }
    menu.appendChild(list);
    toolbar.appendChild(menu);

    if (endedCount > 0) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'toggle-ended';
      toggle.textContent = showEnded ? 'Hide ended events' : `Show ${endedCount} ended event(s)`;
      toggle.addEventListener('click', () => {
        showEnded = !showEnded;
        render();
      });
      toolbar.appendChild(toggle);
    }

    return toolbar;
  }

  /**
   * The collapsed "Hidden (N)" list: one row per hidden section and per hide
   * rule (its stored canonical text, so the breadth of a rule is visible),
   * each with an un-hide button. Rules matching nothing right now are still
   * listed — they are standing rules, not stale state. Returns null when
   * nothing is hidden so a fresh install renders no empty chrome.
   */
  function buildHiddenSection(hiddenRules: string[], ruleMatches: Map<string, number>): HTMLElement | null {
    const hiddenCats = EVENT_CATEGORIES.filter(({ key }) => listHiddenCategories(game).includes(key));
    const count = hiddenRules.length + hiddenCats.length;
    if (count === 0) return null;

    const details = document.createElement('details');
    details.className = 'hidden-events';
    const summary = document.createElement('summary');
    summary.textContent = `Hidden (${count})`;
    details.appendChild(summary);

    const list = document.createElement('ul');
    list.className = 'hidden-events-list';

    const unhideButton = (label: string, ariaLabel: string, onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hidden-events-btn';
      btn.textContent = label;
      btn.setAttribute('aria-label', ariaLabel);
      btn.addEventListener('click', () => {
        onClick();
        // Un-hiding is destructive: a merge would union the hide back in
        // from the cloud copy, so push over it instead (same rule as
        // un-belling a reminder).
        scheduleSync('push-only');
        render();
      });
      return btn;
    };

    for (const { key, label } of hiddenCats) {
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.className = 'hidden-events-name';
      text.textContent = `${label} section hidden`;
      li.appendChild(text);
      li.appendChild(unhideButton('Show', `Show the ${label} section`, () => setCategoryHidden(game, key, false)));
      list.appendChild(li);
    }

    for (const rule of hiddenRules) {
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.className = 'hidden-events-name';
      text.textContent = rule;
      li.appendChild(text);
      const matches = ruleMatches.get(rule) ?? 0;
      if (matches > 0) {
        const badge = document.createElement('span');
        badge.className = 'hidden-events-count';
        badge.textContent = matches === 1 ? 'matches 1 event' : `matches ${matches} events`;
        li.appendChild(badge);
      }
      li.appendChild(unhideButton('Unhide', `Unhide ${rule}`, () => unhideEvent(game, rule)));
      list.appendChild(li);
    }

    details.appendChild(list);
    return details;
  }

  render();
  // Background, non-blocking: local data renders immediately and cloud data
  // merges in when it lands. No-ops unless configured and connected.
  scheduleSync('merge');
}

/** Fills the "starting/ending soon" banner with belled events whose start
 * (upcoming) or end (current) falls within REMINDER_WINDOW_SECONDS, each with
 * a live countdown span driven by the shared ticker. Hidden when none qualify. */
function populateReminderBanner(banner: HTMLElement, game: GameKey, data: GameEvents, region: Region): void {
  const reminded = new Set(listReminders(game));
  // Hidden means hidden everywhere: a hide-rule match stays out of the banner
  // too. The subscription itself is left in storage, so un-hiding restores
  // banner behavior without re-belling.
  const hidden = new Set(listHiddenNames(game));
  const nowSeconds = Date.now() / 1000;
  banner.innerHTML = '';

  const rows: { name: string; label: string; deadline: number }[] = [];
  const consider = (ev: EventInfo, unix: number | null, label: string) => {
    if (unix === null || !reminded.has(eventKey(ev))) return;
    if (hidden.has(eventHideKey(ev.name))) return;
    if (unix > nowSeconds && unix - nowSeconds <= REMINDER_WINDOW_SECONDS) {
      rows.push({ name: ev.name, label, deadline: unix });
    }
  };
  for (const ev of data.upcoming) consider(ev, resolveRegionUnix(ev.startUnix, region), 'starts in');
  for (const ev of data.current) consider(ev, resolveRegionUnix(ev.endUnix, region), 'ends in');

  if (rows.length === 0) {
    banner.hidden = true;
    return;
  }
  rows.sort((a, b) => a.deadline - b.deadline);

  const heading = document.createElement('strong');
  heading.className = 'reminder-banner-heading';
  heading.textContent = rows.length === 1 ? '⏰ 1 tracked event soon' : `⏰ ${rows.length} tracked events soon`;
  banner.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'reminder-list';
  for (const row of rows) {
    const li = document.createElement('li');
    li.appendChild(document.createTextNode(`${row.name} — `));
    const countdown = document.createElement('span');
    countdown.className = 'countdown';
    countdown.dataset.deadline = String(row.deadline);
    countdown.dataset.countdownLabel = row.label;
    li.appendChild(countdown);
    list.appendChild(li);
  }
  banner.appendChild(list);
  banner.hidden = false;
}

function buildSkeleton(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'event-grid skeleton';
  wrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 6; i++) {
    const card = document.createElement('div');
    card.className = 'skeleton-card';
    wrap.appendChild(card);
  }
  return wrap;
}

function buildTitle(): HTMLElement {
  const h1 = document.createElement('h1');
  h1.textContent = 'GachaGremlin — Event Tracker';
  return h1;
}

/**
 * The cloud-sync controls: Connect, or once connected a status line plus Sync
 * now / Disconnect.
 *
 * Renders nothing at all while `isCloudConfigured()` is false (no OAuth client
 * ID provisioned) — a fork or fresh clone shouldn't show a button that could
 * only fail. Updates itself through `onSyncStateChange` rather than the app's
 * render loop, because the footer is built once at mount and never rebuilt.
 */
function buildCloudControls(): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'cloud-controls';
  if (!isCloudConfigured()) return wrap; // no client ID → no cloud UI

  const status = document.createElement('span');
  status.className = 'data-footer-message';

  /** A failed connect()'s message. Shown in preference to the sync-state text,
   * which at that moment is the STALE pre-click error (usually "access
   * expired") — repainting from sync state alone would hide the real reason
   * the connect failed. Cleared when a new connect starts or a sync begins. */
  let connectError: string | null = null;

  const connectBtn = document.createElement('button');
  connectBtn.type = 'button';
  connectBtn.className = 'data-footer-btn';

  const syncBtn = document.createElement('button');
  syncBtn.type = 'button';
  syncBtn.className = 'data-footer-btn';
  syncBtn.textContent = 'Sync now';
  syncBtn.addEventListener('click', () => void syncNow('merge'));

  const disconnectBtn = document.createElement('button');
  disconnectBtn.type = 'button';
  disconnectBtn.className = 'data-footer-btn';
  disconnectBtn.textContent = 'Disconnect';
  disconnectBtn.addEventListener('click', async () => {
    await disconnect();
    update();
  });

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectError = null;
    try {
      await connect();
      update();
      await syncNow('merge');
    } catch (e) {
      connectError = (e as Error).message;
    } finally {
      connectBtn.disabled = false;
      update();
    }
  });

  function update(): void {
    const state = getSyncState();
    const connected = isConnected();
    if (state.status === 'syncing') connectError = null;

    // A lapsed Google session needs consent again, so it re-uses the Connect
    // button rather than offering a Sync that can only fail.
    const reconnecting = connected && state.needsReconnect;
    connectBtn.hidden = connected && !reconnecting;
    connectBtn.textContent = reconnecting ? 'Reconnect' : 'Connect Google Drive';
    syncBtn.hidden = !connected || reconnecting;
    disconnectBtn.hidden = !connected;

    status.classList.toggle('error', connectError !== null || state.status === 'error');
    if (connectError) {
      status.textContent = connectError;
    } else if (!connected) {
      status.textContent = '';
    } else if (state.status === 'syncing') {
      status.textContent = 'Syncing…';
    } else if (state.status === 'error') {
      status.textContent = state.error ?? 'Cloud sync failed.';
    } else if (state.lastSyncedAt) {
      status.textContent = `Last synced ${new Date(state.lastSyncedAt).toLocaleTimeString()}`;
    } else {
      status.textContent = 'Connected';
    }
  }

  onSyncStateChange(update);
  update();

  wrap.append(connectBtn, syncBtn, disconnectBtn, status);
  return wrap;
}

/**
 * Manual backup / restore of all local data to a single JSON file — the guard
 * against a cleared cache, and the same payload cloud sync moves. Restore
 * merges (never overwrites), so re-importing can't lose pulls. `onRestored`
 * re-renders so switched accounts/reminders show up.
 */
function buildDataFooter(onRestored: () => void): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'data-footer';

  const label = document.createElement('span');
  label.className = 'data-footer-label';
  label.textContent = 'Your data lives in this browser.';
  footer.appendChild(label);

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'data-footer-btn';
  exportBtn.textContent = 'Export all data';
  exportBtn.addEventListener('click', () => {
    const json = JSON.stringify(exportAll(), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gachagremlin-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  });
  footer.appendChild(exportBtn);

  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = '.json,application/json';
  importInput.className = 'data-footer-file';
  importInput.hidden = true;

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'data-footer-btn';
  importBtn.textContent = 'Import backup';
  importBtn.addEventListener('click', () => importInput.click());

  const message = document.createElement('span');
  message.className = 'data-footer-message';

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const result = importBackup(JSON.parse(await file.text()));
      message.classList.remove('error');
      message.textContent = `Restored ${result.accounts} account(s) and ${result.reminders} reminder(s).`;
      onRestored();
      scheduleSync('merge'); // push the restored data up too
    } catch (e) {
      message.classList.add('error');
      message.textContent = `Couldn't import backup: ${(e as Error).message}`;
    } finally {
      importInput.value = ''; // allow re-selecting the same file
    }
  });

  footer.append(importBtn, importInput, message, buildCloudControls());
  return footer;
}

/** One category section. Callers skip empty categories, so `events` is never
 * empty here. */
function buildSection(
  title: string,
  events: EventInfo[],
  region: Region,
  onToggleReminder: () => void,
  onHide: (ev: EventInfo) => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'event-section';
  const heading = document.createElement('h2');
  heading.textContent = title;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'event-grid';
  for (const ev of events) {
    grid.appendChild(renderEventCard(ev, region, onToggleReminder, onHide));
  }
  section.appendChild(grid);
  return section;
}
