import { exportAll, importBackup } from '../data/backup.ts';
import { cachedSource } from '../data/cache.ts';
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
    const visibleCurrent = data.current.filter((e) => showEnded || e.status !== 'ended');
    const endedCount = data.current.length - visibleCurrent.length;

    if (endedCount > 0) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'toggle-ended';
      toggle.textContent = showEnded ? 'Hide ended events' : `Show ${endedCount} ended event(s)`;
      toggle.addEventListener('click', () => {
        showEnded = !showEnded;
        render();
      });
      main.appendChild(toggle);
    }

    const onToggleReminder = () => render();
    main.appendChild(buildSection('Current Events', visibleCurrent, region, onToggleReminder));
    main.appendChild(buildSection('Upcoming Events', data.upcoming, region, onToggleReminder));

    populateReminderBanner(reminderBanner, game, data, region);

    main.setAttribute('aria-busy', 'false');
    startCountdownTicker();
  }

  render();
}

/** Fills the "starting/ending soon" banner with belled events whose start
 * (upcoming) or end (current) falls within REMINDER_WINDOW_SECONDS, each with
 * a live countdown span driven by the shared ticker. Hidden when none qualify. */
function populateReminderBanner(banner: HTMLElement, game: GameKey, data: GameEvents, region: Region): void {
  const reminded = new Set(listReminders(game));
  const nowSeconds = Date.now() / 1000;
  banner.innerHTML = '';

  const rows: { name: string; label: string; deadline: number }[] = [];
  const consider = (ev: EventInfo, unix: number | null, label: string) => {
    if (unix === null || !reminded.has(eventKey(ev))) return;
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
 * Manual backup / restore of all local data to a single JSON file — the guard
 * against a cleared cache, and the same payload a future Google Drive sync
 * will move. Restore merges (never overwrites), so re-importing can't lose
 * pulls. `onRestored` re-renders so switched accounts/reminders show up.
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
    } catch (e) {
      message.classList.add('error');
      message.textContent = `Couldn't import backup: ${(e as Error).message}`;
    } finally {
      importInput.value = ''; // allow re-selecting the same file
    }
  });

  footer.append(importBtn, importInput, message);
  return footer;
}

function buildSection(title: string, events: EventInfo[], region: Region, onToggleReminder: () => void): HTMLElement {
  const section = document.createElement('section');
  section.className = 'event-section';
  const heading = document.createElement('h2');
  heading.textContent = title;
  section.appendChild(heading);

  if (events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No events.';
    section.appendChild(empty);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'event-grid';
  for (const ev of events) {
    grid.appendChild(renderEventCard(ev, region, onToggleReminder));
  }
  section.appendChild(grid);
  return section;
}
