import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportAll } from '../src/data/backup.ts';
import { importPayload, loadAccount } from '../src/data/wishes/store.ts';
import { listReminders, toggleReminder } from '../src/data/reminders.ts';
import type { WishItem, WishPayload } from '../src/types.ts';

// The shipped client ID is an empty placeholder, so isCloudConfigured() is
// false and every sync entry point no-ops. Pretend it's provisioned.
vi.mock('../src/data/cloud/config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/cloud/config.ts')>()),
  GOOGLE_CLIENT_ID: 'test-client-id',
  isCloudConfigured: () => true,
}));

// Stub the network edge; CloudError is kept real because sync.ts branches on
// it with instanceof.
const loadCloudBackup = vi.fn();
const saveCloudBackup = vi.fn();
vi.mock('../src/data/cloud/drive.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/cloud/drive.ts')>()),
  loadCloudBackup: (...args: unknown[]) => loadCloudBackup(...args),
  saveCloudBackup: (...args: unknown[]) => saveCloudBackup(...args),
}));

const { CloudError } = await import('../src/data/cloud/drive.ts');
const { configureSync, getSyncState, onSyncStateChange, resetSyncForTests, scheduleSync, setOnMerged, syncNow } = await import(
  '../src/data/cloud/sync.ts'
);

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function item(id: string, overrides: Partial<WishItem> = {}): WishItem {
  return { id, bannerType: '301', name: 'Test', itemType: 'Character', rank: '4', time: '2026-01-01 00:00:00', ...overrides };
}
function makePayload(overrides: Partial<WishPayload> = {}): WishPayload {
  return { game: 'genshin', uid: 'uid1', region: 'os_usa', exportedAt: 1000, items: [item('1')], ...overrides };
}

let getToken: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  resetSyncForTests();
  loadCloudBackup.mockReset();
  saveCloudBackup.mockReset().mockResolvedValue('file-1');
  getToken = vi.fn(async () => 'tok');
  configureSync({ getToken, isConnected: () => true, now: () => 12345 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('syncNow — merge', () => {
  it('merges cloud data into localStorage BEFORE snapshotting for the push', async () => {
    // Local has uid1; cloud has uid2. A correct pull→merge→push uploads both.
    importPayload(makePayload({ uid: 'uid1', items: [item('1')] }));

    const otherDevice = new MemoryStorage();
    vi.stubGlobal('localStorage', otherDevice);
    importPayload(makePayload({ uid: 'uid2', items: [item('2')] }));
    const cloud = exportAll();

    const local = new MemoryStorage();
    vi.stubGlobal('localStorage', local);
    importPayload(makePayload({ uid: 'uid1', items: [item('1')] }));

    loadCloudBackup.mockResolvedValue({ data: cloud, fileId: 'file-1' });
    await syncNow('merge');

    // Cloud's account landed locally...
    expect(loadAccount('genshin', 'uid2')?.items.map((i) => i.id)).toEqual(['2']);
    // ...and the uploaded snapshot contains BOTH, proving import ran first.
    const uploaded = saveCloudBackup.mock.calls[0][1] as ReturnType<typeof exportAll>;
    expect(Object.keys(uploaded.games.genshin.accounts).sort()).toEqual(['uid1', 'uid2']);
  });

  it('creates the file on a first-ever sync (no cloud backup yet)', async () => {
    loadCloudBackup.mockResolvedValue(null);
    await syncNow('merge');

    expect(saveCloudBackup).toHaveBeenCalledOnce();
    expect(saveCloudBackup.mock.calls[0][2]).toBeUndefined(); // no known file id
    expect(getSyncState().status).toBe('idle');
  });

  it('passes the known file id through so the push skips a redundant lookup', async () => {
    loadCloudBackup.mockResolvedValue({ data: exportAll(), fileId: 'file-9' });
    await syncNow('merge');
    expect(saveCloudBackup.mock.calls[0][2]).toBe('file-9');
  });

  it('unions reminders across devices', async () => {
    toggleReminder('genshin', 'local-only');
    const cloud = exportAll();
    cloud.games.genshin.reminders = ['cloud-only'];

    loadCloudBackup.mockResolvedValue({ data: cloud, fileId: 'f' });
    await syncNow('merge');
    expect(listReminders('genshin').sort()).toEqual(['cloud-only', 'local-only']);
  });

  it('records lastSyncedAt and notifies subscribers', async () => {
    const seen: string[] = [];
    onSyncStateChange((s) => seen.push(s.status));
    loadCloudBackup.mockResolvedValue(null);

    await syncNow('merge');
    expect(seen).toEqual(['syncing', 'idle']);
    expect(getSyncState().lastSyncedAt).toBe(12345);
  });

  it('re-renders the app only when a merge actually brought data in', async () => {
    const onMerged = vi.fn();
    setOnMerged(onMerged);

    loadCloudBackup.mockResolvedValue(null); // nothing to merge
    await syncNow('merge');
    expect(onMerged).not.toHaveBeenCalled();

    loadCloudBackup.mockResolvedValue({ data: exportAll(), fileId: 'f' });
    await syncNow('merge');
    expect(onMerged).toHaveBeenCalledOnce();
  });
});

describe('syncNow — push-only', () => {
  it('skips the download entirely so a delete is not resurrected', async () => {
    await syncNow('push-only');
    expect(loadCloudBackup).not.toHaveBeenCalled();
    expect(saveCloudBackup).toHaveBeenCalledOnce();
    expect(saveCloudBackup.mock.calls[0][2]).toBeUndefined(); // no id -> save finds it
  });
});

describe('version guard', () => {
  it('aborts WITHOUT pushing when the cloud file came from a newer build', async () => {
    // The data-loss guard: pushing here would overwrite the newer file with
    // this build's older-shaped payload.
    loadCloudBackup.mockResolvedValue({ data: { app: 'gachagremlin', schemaVersion: 99, games: {} }, fileId: 'f' });

    await syncNow('merge');

    expect(saveCloudBackup).not.toHaveBeenCalled();
    const state = getSyncState();
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/newer version/i);
    expect(state.needsReconnect).toBe(false);
    expect(state.lastSyncedAt).toBeNull();
  });
});

describe('auth failures', () => {
  it('retries once with a fresh token after a 401 mid-flight, then succeeds', async () => {
    loadCloudBackup
      .mockRejectedValueOnce(new CloudError('unauthorized', 'expired', 401))
      .mockResolvedValueOnce({ data: exportAll(), fileId: 'f' });

    await syncNow('merge');

    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken.mock.calls[1][0]).toEqual({ forceRefresh: true });
    expect(getSyncState().status).toBe('idle');
  });

  it('surfaces a reconnect prompt when the retry also fails', async () => {
    loadCloudBackup.mockRejectedValue(new CloudError('unauthorized', 'expired', 401));

    await syncNow('merge');

    const state = getSyncState();
    expect(state.status).toBe('error');
    expect(state.needsReconnect).toBe(true);
    expect(saveCloudBackup).not.toHaveBeenCalled();
  });

  it('refreshes at most once per run even when a later op also 401s', async () => {
    // Pull 401s once (refresh + retry succeeds), then the push 401s too. The
    // cap must stop a second refresh — a dead grant otherwise turns every op
    // into another token request.
    loadCloudBackup
      .mockRejectedValueOnce(new CloudError('unauthorized', 'expired', 401))
      .mockResolvedValueOnce(null);
    saveCloudBackup.mockRejectedValue(new CloudError('unauthorized', 'expired', 401));

    await syncNow('merge');

    expect(getToken).toHaveBeenCalledTimes(2); // initial + exactly ONE forced refresh
    expect(getSyncState().needsReconnect).toBe(true);
  });

  it('surfaces reconnect without touching Drive when there is no grant (migration case)', async () => {
    // A pre-refresh-token user: connected flag set, but getToken has nothing
    // stored and rejects up front. No Drive call, no retry loop, no popup —
    // just the Reconnect prompt.
    getToken.mockRejectedValue(new CloudError('unauthorized', 'Reconnect Google Drive to keep syncing.'));

    await syncNow('merge');

    expect(loadCloudBackup).not.toHaveBeenCalled();
    expect(saveCloudBackup).not.toHaveBeenCalled();
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(getSyncState().needsReconnect).toBe(true);
  });
});

describe('error states', () => {
  it.each([
    ['rate-limited', /rate-limiting/i],
    ['network', /connection/i],
  ])('surfaces a readable message for a %s failure', async (kind, expected) => {
    loadCloudBackup.mockRejectedValue(new CloudError(kind as 'network', 'boom'));
    await syncNow('merge');

    const state = getSyncState();
    expect(state.status).toBe('error');
    expect(state.error).toMatch(expected);
    expect(state.needsReconnect).toBe(false);
  });

  // 'other' must pass Drive's own explanation through untouched — that's what
  // makes a misconfigured project (e.g. Drive API never enabled) diagnosable
  // instead of hiding behind a generic string.
  it("passes Drive's own explanation through for an 'other' failure", async () => {
    loadCloudBackup.mockRejectedValue(
      new CloudError('other', 'Drive request failed (403): Google Drive API has not been used in project 123 before or it is disabled.', 403),
    );
    await syncNow('merge');

    expect(getSyncState().error).toContain('has not been used in project');
  });
});

describe('gating', () => {
  it('does nothing when disconnected', async () => {
    configureSync({ getToken, isConnected: () => false });
    await syncNow('merge');
    expect(getToken).not.toHaveBeenCalled();
    expect(saveCloudBackup).not.toHaveBeenCalled();
  });
});

describe('serialization', () => {
  /** Holds the first pull open so follow-up requests land mid-flight.
   * Created up-front rather than inside the mock, because syncNow awaits
   * getToken() before it ever calls loadCloudBackup. */
  function heldPull(): { release: () => void } {
    let release!: () => void;
    const gate = new Promise<null>((resolve) => {
      release = () => resolve(null);
    });
    loadCloudBackup.mockReturnValueOnce(gate).mockResolvedValue(null);
    return { release };
  }

  it('queues exactly one follow-up while a sync is in flight', async () => {
    const { release } = heldPull();

    const first = syncNow('merge');
    await Promise.resolve(); // let the first sync reach the held pull
    // Three more requests arrive mid-flight; they must collapse into ONE.
    void syncNow('merge');
    void syncNow('merge');
    void syncNow('merge');

    release();
    await first;

    expect(saveCloudBackup).toHaveBeenCalledTimes(2); // the original + one follow-up
  });

  it('lets a destructive request win when collapsing a queued follow-up', async () => {
    const { release } = heldPull();

    const first = syncNow('merge');
    await Promise.resolve();
    void syncNow('merge');
    void syncNow('push-only'); // a delete happened mid-sync

    release();
    await first;

    // The follow-up must not pull, or it would resurrect the deleted data.
    expect(loadCloudBackup).toHaveBeenCalledTimes(1); // only the original merge
    expect(saveCloudBackup).toHaveBeenCalledTimes(2);
  });
});

describe('scheduleSync debounce', () => {
  it('collapses a burst of triggers into a single sync', async () => {
    vi.useFakeTimers();
    loadCloudBackup.mockResolvedValue(null);

    scheduleSync('merge');
    scheduleSync('merge');
    scheduleSync('merge');
    expect(saveCloudBackup).not.toHaveBeenCalled(); // trailing edge: nothing yet

    await vi.advanceTimersByTimeAsync(3000);
    expect(saveCloudBackup).toHaveBeenCalledOnce();
  });

  it('upgrades a pending merge to push-only when a destructive trigger arrives', async () => {
    vi.useFakeTimers();
    loadCloudBackup.mockResolvedValue(null);

    scheduleSync('merge'); // e.g. a rename
    scheduleSync('push-only'); // then a delete, before the timer fires

    await vi.advanceTimersByTimeAsync(3000);
    expect(loadCloudBackup).not.toHaveBeenCalled();
    expect(saveCloudBackup).toHaveBeenCalledOnce();
  });

  it('does nothing when disconnected', async () => {
    vi.useFakeTimers();
    configureSync({ getToken, isConnected: () => false });

    scheduleSync('merge');
    await vi.advanceTimersByTimeAsync(3000);
    expect(saveCloudBackup).not.toHaveBeenCalled();
  });
});
