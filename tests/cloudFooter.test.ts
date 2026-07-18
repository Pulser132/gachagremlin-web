// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncState } from '../src/data/cloud/sync.ts';

// The footer's cloud row is gated on isCloudConfigured(); flip it per-test.
let configured = true;
vi.mock('../src/data/cloud/config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/cloud/config.ts')>()),
  GOOGLE_CLIENT_ID: 'test-client-id',
  isCloudConfigured: () => configured,
}));

let connected = false;
const connect = vi.fn(async () => {
  connected = true;
});
const disconnect = vi.fn(async () => {
  connected = false;
});
vi.mock('../src/data/cloud/auth.ts', () => ({
  connect: () => connect(),
  disconnect: () => disconnect(),
  getToken: vi.fn(async () => 'tok'),
  isConnected: () => connected,
}));

// Stub sync so the tests observe exactly which calls the UI makes.
const scheduleSync = vi.fn();
const syncNow = vi.fn(async () => {});
let syncState: SyncState = { status: 'idle', lastSyncedAt: null, error: null, needsReconnect: false };
let notify: (state: SyncState) => void = () => {};
vi.mock('../src/data/cloud/sync.ts', () => ({
  configureSync: vi.fn(),
  setOnMerged: vi.fn(),
  getSyncState: () => syncState,
  onSyncStateChange: (cb: (s: SyncState) => void) => {
    notify = cb;
    return () => {};
  },
  scheduleSync: (...args: unknown[]) => scheduleSync(...args),
  syncNow: (...args: unknown[]) => syncNow(...args),
}));

// The events fetch is irrelevant here; keep mountApp off the network.
vi.mock('../src/data/wiki/wikiSource.ts', () => ({
  WikiSource: class {
    async fetchEvents() {
      return { current: [], upcoming: [], fetchedAt: 0 };
    }
  },
}));

const { mountApp } = await import('../src/ui/app.ts');

function mount(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mountApp(root);
  return root;
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
/** The cloud row's buttons, in DOM order: Connect, Sync now, Disconnect. */
const cloudButtons = () => [...document.querySelectorAll<HTMLButtonElement>('.cloud-controls button')];
const visibleCloudButtonText = () => cloudButtons().filter((b) => !b.hidden).map((b) => b.textContent);

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  configured = true;
  connected = false;
  syncState = { status: 'idle', lastSyncedAt: null, error: null, needsReconnect: false };
  scheduleSync.mockClear();
  syncNow.mockClear();
  connect.mockClear();
  disconnect.mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('cloud controls visibility', () => {
  it('renders no cloud UI at all while no client ID is configured', () => {
    configured = false;
    mount();
    expect(cloudButtons()).toHaveLength(0);
  });

  it('offers only Connect when configured but disconnected', () => {
    mount();
    expect(visibleCloudButtonText()).toEqual(['Connect Google Drive']);
    expect(q('.cloud-controls .data-footer-message')?.textContent).toBe('');
  });

  it('offers Sync now and Disconnect once connected', () => {
    connected = true;
    mount();
    expect(visibleCloudButtonText()).toEqual(['Sync now', 'Disconnect']);
  });

  it('leaves the existing export/import buttons untouched', () => {
    mount();
    const labels = [...document.querySelectorAll('.data-footer > .data-footer-btn')].map((b) => b.textContent);
    expect(labels).toEqual(['Export all data', 'Import backup']);
  });
});

describe('cloud status text', () => {
  it('shows Syncing… while a sync is in flight', () => {
    connected = true;
    syncState = { ...syncState, status: 'syncing' };
    mount();
    expect(q('.cloud-controls .data-footer-message')?.textContent).toBe('Syncing…');
  });

  it('shows the last-synced time when idle', () => {
    connected = true;
    const at = new Date('2026-07-14T12:04:00').getTime();
    syncState = { ...syncState, lastSyncedAt: at };
    mount();
    expect(q('.cloud-controls .data-footer-message')?.textContent).toContain('Last synced');
  });

  it('renders an error with the .error class rather than blocking the UI', () => {
    connected = true;
    syncState = { status: 'error', lastSyncedAt: null, error: 'Drive is unhappy', needsReconnect: false };
    mount();

    const message = q('.cloud-controls .data-footer-message');
    expect(message?.textContent).toBe('Drive is unhappy');
    expect(message?.classList.contains('error')).toBe(true);
    expect(document.querySelector('dialog')).toBeNull(); // never a modal
  });

  it('swaps Sync now for Reconnect when the session lapsed', () => {
    connected = true;
    syncState = { status: 'error', lastSyncedAt: null, error: 'expired', needsReconnect: true };
    mount();
    // Offering "Sync now" here would only fail again.
    expect(visibleCloudButtonText()).toEqual(['Reconnect', 'Disconnect']);
  });

  it('updates in place when sync state changes (no app re-render involved)', () => {
    connected = true;
    mount();
    expect(q('.cloud-controls .data-footer-message')?.textContent).toBe('Connected');

    syncState = { ...syncState, status: 'syncing' };
    notify(syncState);
    expect(q('.cloud-controls .data-footer-message')?.textContent).toBe('Syncing…');
  });
});

describe('cloud actions', () => {
  it('Connect authenticates then syncs', async () => {
    mount();
    cloudButtons()[0].click();
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    expect(syncNow).toHaveBeenCalledWith('merge');
  });

  it('shows the connect failure itself, not the stale pre-click sync error', async () => {
    // Regression: a failed Reconnect used to repaint from sync state, whose
    // error was still the old "access expired" — hiding the real reason
    // (e.g. the OAuth Worker being unreachable) behind a misleading message.
    connected = true;
    syncState = { status: 'error', lastSyncedAt: null, error: 'Google Drive access expired. Reconnect to keep syncing.', needsReconnect: true };
    connect.mockRejectedValueOnce(new Error("Couldn't reach the sign-in service: DNS"));
    mount();

    cloudButtons()[0].click(); // the Reconnect button
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());

    const message = q('.cloud-controls .data-footer-message');
    expect(message?.textContent).toBe("Couldn't reach the sign-in service: DNS");
    expect(message?.classList.contains('error')).toBe(true);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('shows a first-time Connect failure instead of clearing the status line', async () => {
    connect.mockRejectedValueOnce(new Error('Google sign-in was dismissed.'));
    mount();

    cloudButtons()[0].click();
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    expect(q('.cloud-controls .data-footer-message')?.textContent).toBe('Google sign-in was dismissed.');
  });

  it('Sync now triggers an immediate merge', () => {
    connected = true;
    mount();
    cloudButtons()[1].click();
    expect(syncNow).toHaveBeenCalledWith('merge');
  });

  it('Disconnect revokes and returns to the Connect state', async () => {
    connected = true;
    mount();
    cloudButtons()[2].click();
    await vi.waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
    expect(visibleCloudButtonText()).toEqual(['Connect Google Drive']);
  });
});

describe('triggers', () => {
  it('schedules a background merge on page load', () => {
    mount();
    expect(scheduleSync).toHaveBeenCalledWith('merge');
  });
});
