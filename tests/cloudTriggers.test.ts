// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventInfo } from '../src/types.ts';

/**
 * Guards the trigger map: every data-changing UI action must schedule a sync,
 * and destructive ones must schedule push-only. Getting the mode wrong is
 * silent and costly — a merge after a delete resurrects the deleted data —
 * so it's asserted per call site rather than inferred.
 */
const scheduleSync = vi.fn();
vi.mock('../src/data/cloud/sync.ts', () => ({
  configureSync: vi.fn(),
  setOnMerged: vi.fn(),
  getSyncState: () => ({ status: 'idle', lastSyncedAt: null, error: null, needsReconnect: false }),
  onSyncStateChange: () => () => {},
  scheduleSync: (...args: unknown[]) => scheduleSync(...args),
  syncNow: vi.fn(),
}));

const { renderEventCard } = await import('../src/ui/eventCard.ts');
const { renderUidSwitcher } = await import('../src/ui/uidSwitcher.ts');
const { importPayload } = await import('../src/data/wishes/store.ts');

function makeEvent(overrides: Partial<EventInfo> = {}): EventInfo {
  return {
    game: 'genshin',
    title: 'Test Event (Event)',
    name: 'Test Event',
    type: 'Character Event Wish',
    group: 'Events',
    status: 'upcoming',
    globalTime: false,
    reward: '',
    rewardType: '',
    characters: [],
    description: '',
    hoyolabLinks: [],
    durationText: [],
    requirements: [],
    imageUrl: null,
    startWalltime: null,
    endWalltime: null,
    startUnix: null,
    endUnix: null,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  scheduleSync.mockClear();
});

describe('reminder bell', () => {
  it('belling schedules a merge; un-belling schedules push-only', () => {
    const card = renderEventCard(makeEvent(), 'America', vi.fn());
    const bell = card.querySelector<HTMLButtonElement>('.event-reminder-bell')!;

    bell.click(); // on — additive
    expect(scheduleSync).toHaveBeenLastCalledWith('merge');

    bell.click(); // off — a merge would union the subscription back in
    expect(scheduleSync).toHaveBeenLastCalledWith('push-only');
  });
});

describe('account switcher', () => {
  beforeEach(() => {
    importPayload({
      game: 'genshin',
      uid: 'uidA',
      region: 'os_usa',
      exportedAt: 1,
      items: [{ id: '1', bannerType: '301', name: 'X', itemType: 'Character', rank: '4', time: '2026-01-01 00:00:00' }],
    });
  });

  it('renaming schedules a merge', () => {
    const wrap = renderUidSwitcher('genshin', vi.fn())!;
    document.body.appendChild(wrap);
    wrap.querySelectorAll<HTMLButtonElement>('.uid-action')[0].click(); // Rename

    document.querySelector<HTMLInputElement>('.uid-nickname-input')!.value = 'Main';
    document.querySelector<HTMLButtonElement>('.uid-dialog-confirm')!.click();

    expect(scheduleSync).toHaveBeenCalledWith('merge');
  });

  it('deleting schedules push-only', () => {
    const wrap = renderUidSwitcher('genshin', vi.fn())!;
    document.body.appendChild(wrap);
    wrap.querySelector<HTMLButtonElement>('.uid-action-danger')!.click(); // Remove

    document.querySelector<HTMLInputElement>('.uid-delete-confirm input')!.click(); // confirm checkbox
    document.querySelector<HTMLButtonElement>('.uid-dialog-danger')!.click();

    expect(scheduleSync).toHaveBeenCalledWith('push-only');
  });

  it('switching the active account schedules nothing (device-local view state)', () => {
    importPayload({
      game: 'genshin',
      uid: 'uidB',
      region: 'os_usa',
      exportedAt: 1,
      items: [{ id: '2', bannerType: '301', name: 'Y', itemType: 'Character', rank: '4', time: '2026-01-01 00:00:00' }],
    });

    const wrap = renderUidSwitcher('genshin', vi.fn())!;
    document.body.appendChild(wrap);
    const select = wrap.querySelector<HTMLSelectElement>('.uid-select')!;
    select.value = 'uidA';
    select.dispatchEvent(new Event('change'));

    expect(scheduleSync).not.toHaveBeenCalled();
  });
});
