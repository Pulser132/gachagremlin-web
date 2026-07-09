import { cachedSource } from '../data/cache.ts';
import { GAME_CONFIGS, GAME_KEYS } from '../data/wiki/games.ts';
import { WikiSource } from '../data/wiki/wikiSource.ts';
import type { EventInfo, GameEvents, GameKey, Region } from '../types.ts';
import { startCountdownTicker } from './countdown.ts';
import { renderEventCard } from './eventCard.ts';

const GAME_PREF_KEY = 'gachagremlin:selectedGame';
const REGION_PREF_KEY = 'gachagremlin:selectedRegion';
const REGIONS: Region[] = ['America', 'Europe', 'Asia', 'SAR'];

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

  const main = document.createElement('main');
  root.appendChild(main);

  async function render(forceRefresh = false): Promise<void> {
    tabButtons.forEach((btn, i) => btn.setAttribute('aria-selected', String(GAME_KEYS[i] === game)));
    Array.from(regionSelect.options).forEach((opt) => {
      opt.hidden = opt.value === 'SAR' && game !== 'genshin';
    });
    regionSelect.value = region;

    main.setAttribute('aria-busy', 'true');
    main.innerHTML = '<p class="loading">Loading events…</p>';
    status.hidden = true;

    let data: GameEvents;
    try {
      data = forceRefresh ? await source.forceRefresh(game) : await source.fetchEvents(game);
    } catch (e) {
      main.innerHTML = '';
      status.hidden = false;
      status.textContent = `Couldn't load ${GAME_CONFIGS[game].label} events: ${(e as Error).message}. Try Refresh in a moment.`;
      main.setAttribute('aria-busy', 'false');
      return;
    }

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

    main.appendChild(buildSection('Current Events', visibleCurrent, region));
    main.appendChild(buildSection('Upcoming Events', data.upcoming, region));

    main.setAttribute('aria-busy', 'false');
    startCountdownTicker();
  }

  render();
}

function buildTitle(): HTMLElement {
  const h1 = document.createElement('h1');
  h1.textContent = 'GachaGremlin — Event Tracker';
  return h1;
}

function buildSection(title: string, events: EventInfo[], region: Region): HTMLElement {
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
    grid.appendChild(renderEventCard(ev, region));
  }
  section.appendChild(grid);
  return section;
}
