// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveAccount, getActiveUid, importPayload } from '../src/data/wishes/store.ts';
import { openImportDialog } from '../src/ui/importDialog.ts';
import { renderWishesView } from '../src/ui/wishesView.ts';
import type { GameKey, WishItem, WishPayload } from '../src/types.ts';

// Same in-memory Storage stand-in used by tests/cache.test.ts and
// tests/wishStore.test.ts.
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

const FIXTURES = join(import.meta.dirname, 'fixtures', 'wishes');

/** Mirrors importDialog's own derivation: the scripts are served from whatever
 * site the player is on, so this resolves to the test DOM's origin here and to
 * Pages in production. */
function scriptUrl(game: GameKey): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}import/${game}.ps1`;
}

function loadPayload(name: string): WishPayload {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf-8')) as WishPayload;
}

function loadText(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  document.body.innerHTML = '';
});

describe('renderWishesView', () => {
  it('shows an empty state with import instructions when nothing has been imported', () => {
    const view = renderWishesView('genshin', vi.fn());
    expect(view.textContent).toMatch(/no wishes imported yet/i);
    expect(view.querySelector('.import-button')).not.toBeNull();
  });

  it('renders uid, pity, and history rows for an imported account', () => {
    importPayload(loadPayload('genshin.json'));
    const view = renderWishesView('genshin', vi.fn());

    // The uid shows in the account switcher's option list.
    expect(view.querySelector('.uid-select')?.textContent).toMatch(/800000001/);

    // From the fixture: character group (301+400) has since5Star = 3 pulls
    // since the last 5★ (id 8, "Furina"), out of 90 hard pity.
    const characterCard = [...view.querySelectorAll('.banner-card')].find((c) =>
      c.textContent?.includes('Character Event Wish'),
    );
    expect(characterCard).toBeDefined();
    expect(characterCard!.querySelector('.stat-value.stat-5')?.textContent).toBe('3');
    expect(characterCard!.textContent).toMatch(/Guaranteed at 90/);

    // The pity fuse keeps the old pity bar's progressbar semantics.
    const fuse = characterCard!.querySelector('[role="progressbar"]');
    expect(fuse?.getAttribute('aria-valuenow')).toBe('3');
    expect(fuse?.getAttribute('aria-valuemax')).toBe('90');

    // Furina (the most recent 5★) is not in the standard pool, so the 50/50
    // is not currently guaranteed.
    expect(characterCard!.querySelector('.guarantee-badge')?.textContent).toBe('50/50');

    // The recent-5★ expander lists Furina with the pity she landed at.
    expect(characterCard!.querySelector('.banner-recent')?.textContent).toContain('Furina');

    // The grid ends with the pulls-per-month chart card.
    expect(view.querySelector('.chart-card')).not.toBeNull();

    const table = view.querySelector('.history-table');
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll('tbody tr').length).toBe(12);
  });

  it('filters the history table by rarity', () => {
    importPayload(loadPayload('genshin.json'));
    document.body.appendChild(renderWishesView('genshin', vi.fn()));

    const raritySelect = document.querySelector<HTMLSelectElement>('[aria-label="Filter by rarity"]')!;
    raritySelect.value = '5';
    raritySelect.dispatchEvent(new Event('change'));

    const rows = document.querySelectorAll('.history-table tbody tr');
    expect(rows.length).toBe(2); // Diluc + Furina are the only 5★ pulls in the fixture
  });

  it('limits the history table to the chosen number of most-recent pulls', () => {
    importPayload(loadPayload('genshin.json')); // 12 pulls in the fixture
    document.body.appendChild(renderWishesView('genshin', vi.fn()));

    // Default is "Last 100": all 12 fit, so all show and the caption says so.
    expect(document.querySelectorAll('.history-table tbody tr').length).toBe(12);
    expect(document.querySelector('.history-count')?.textContent).toBe('Showing all 12 wishes');

    const countSelect = document.querySelector<HTMLSelectElement>('[aria-label="Show how many pulls"]')!;
    expect(countSelect.value).toBe('100'); // default

    countSelect.value = '10';
    countSelect.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('.history-table tbody tr').length).toBe(10);
    expect(document.querySelector('.history-count')?.textContent).toBe('Showing latest 10 of 12 wishes');

    countSelect.value = 'all';
    countSelect.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('.history-table tbody tr').length).toBe(12);
    expect(document.querySelector('.history-count')?.textContent).toBe('Showing all 12 wishes');
  });
});

function makeItem(id: string): WishItem {
  return { id, bannerType: '301', name: 'Test', itemType: 'Character', rank: '4', time: '2026-01-01 00:00:00' };
}

function payloadFor(uid: string): WishPayload {
  return { game: 'genshin', uid, region: 'os_usa', exportedAt: 1, items: [makeItem('100')] };
}

describe('renderWishesView account switcher', () => {
  it('renders a switcher listing every stored uid and swaps the active account on change', () => {
    importPayload(payloadFor('800000001'));
    importPayload(payloadFor('800000002'));

    document.body.appendChild(renderWishesView('genshin', vi.fn()));
    const select = document.querySelector<HTMLSelectElement>('.uid-select')!;
    expect([...select.options].map((o) => o.value)).toEqual(['800000001', '800000002']);
    expect(select.value).toBe('800000002'); // last import is active

    select.value = '800000001';
    select.dispatchEvent(new Event('change'));
    expect(getActiveUid('genshin')).toBe('800000001');
  });

  it('does not render a switcher when nothing has been imported', () => {
    document.body.appendChild(renderWishesView('genshin', vi.fn()));
    expect(document.querySelector('.uid-switcher')).toBeNull();
  });
});

describe('renderWishesView import mismatch notice', () => {
  it('warns and auto-swaps when an import lands on a different uid than the one being viewed', () => {
    importPayload(payloadFor('800000001')); // viewing this uid

    const onChange = vi.fn();
    document.body.appendChild(renderWishesView('genshin', onChange));

    // Import pulls for a different uid via the dialog.
    document.querySelector<HTMLButtonElement>('.import-button')!.click();
    const textarea = document.querySelector<HTMLTextAreaElement>('.import-textarea')!;
    textarea.value = JSON.stringify(payloadFor('800000002'));
    document.querySelector<HTMLButtonElement>('.import-confirm')!.click();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(getActiveUid('genshin')).toBe('800000002'); // storage auto-swapped

    // The re-render (which the real app does in onChange) surfaces the notice.
    document.body.innerHTML = '';
    document.body.appendChild(renderWishesView('genshin', vi.fn()));
    const notice = document.querySelector('.wishes-notice');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toMatch(/800000002/);
    expect(notice!.textContent).toMatch(/800000001/);
  });

  it('shows no notice when re-importing the same uid being viewed', () => {
    importPayload(payloadFor('800000001'));
    document.body.appendChild(renderWishesView('genshin', vi.fn()));

    document.querySelector<HTMLButtonElement>('.import-button')!.click();
    const textarea = document.querySelector<HTMLTextAreaElement>('.import-textarea')!;
    textarea.value = JSON.stringify(payloadFor('800000001'));
    document.querySelector<HTMLButtonElement>('.import-confirm')!.click();

    document.body.innerHTML = '';
    document.body.appendChild(renderWishesView('genshin', vi.fn()));
    expect(document.querySelector('.wishes-notice')).toBeNull();
  });
});

describe('openImportDialog', () => {
  it('shows an inline error and does not import when the payload is for the wrong game', () => {
    const onImported = vi.fn();
    openImportDialog('genshin', onImported);

    const textarea = document.querySelector<HTMLTextAreaElement>('.import-textarea')!;
    textarea.value = JSON.stringify(loadPayload('hsr.json'));

    const importBtn = document.querySelector<HTMLButtonElement>('.import-confirm')!;
    importBtn.click();

    const errorBox = document.querySelector('.import-error')!;
    expect(errorBox.hidden).toBe(false);
    expect(errorBox.textContent).toMatch(/hsr.*genshin/i);
    expect(onImported).not.toHaveBeenCalled();
  });

  it('imports and closes the dialog on a valid payload for the right game', () => {
    const onImported = vi.fn();
    openImportDialog('genshin', onImported);

    const textarea = document.querySelector<HTMLTextAreaElement>('.import-textarea')!;
    textarea.value = JSON.stringify(loadPayload('genshin.json'));
    document.querySelector<HTMLButtonElement>('.import-confirm')!.click();

    expect(onImported).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.import-dialog')).toBeNull(); // removed on close
  });

  it('imports a UIGF export pasted from another tracker (e.g. paimon.moe/stardb.gg) via the same textarea', () => {
    const onImported = vi.fn();
    openImportDialog('genshin', onImported);

    const textarea = document.querySelector<HTMLTextAreaElement>('.import-textarea')!;
    textarea.value = loadText('uigf-genshin.json');
    document.querySelector<HTMLButtonElement>('.import-confirm')!.click();

    expect(onImported).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.import-dialog')).toBeNull();
    expect(getActiveAccount('genshin')?.uid).toBe('800000099'); // the uid in uigf-genshin.json's hk4e account
  });

  it('targets the account being viewed, so the script cannot silently grab another UID cached by the game', () => {
    importPayload(loadPayload('genshin.json'));
    const uid = getActiveUid('genshin')!;
    openImportDialog('genshin', vi.fn());

    // Positional args: '' keeps path auto-detect, then the uid to select.
    const command = document.querySelector('.import-command code')!.textContent!;
    expect(command).toBe(`iex "& { $(irm ${scriptUrl('genshin')}) } '' '${uid}'"`);

    // The copy button must hand over the same targeted command, not the plain one.
    expect(document.querySelector('.import-command')!.textContent).toContain(uid);
    // And the steps say which account to open in-game, since the link has to exist first.
    expect(document.querySelector('.import-steps')!.textContent).toContain(uid);
  });

  it('follows the active account when it changes, rather than pinning the first import', () => {
    importPayload(loadPayload('genshin.json'));
    importPayload({ ...loadPayload('genshin.json'), uid: '800000042' });
    expect(getActiveUid('genshin')).toBe('800000042');

    openImportDialog('genshin', vi.fn());
    expect(document.querySelector('.import-command code')!.textContent).toContain("'800000042'");
  });

  it('falls back to the plain one-liner before any account exists, since there is no uid to target', () => {
    expect(getActiveUid('genshin')).toBeNull();
    openImportDialog('genshin', vi.fn());

    const command = document.querySelector('.import-command code')!.textContent!;
    expect(command).toBe(`iwr -useb ${scriptUrl('genshin')} | iex`);
  });

  it('serves the script from the site the player is on, so a dev build tests the local script', () => {
    importPayload(loadPayload('genshin.json'));
    openImportDialog('genshin', vi.fn());

    // Hardcoding the Pages URL meant localhost handed out production's script,
    // making a script fix untestable without deploying it first.
    const command = document.querySelector('.import-command code')!.textContent!;
    expect(command).toContain(window.location.origin);
    expect(command).toContain(scriptUrl('genshin'));
    expect(command).not.toContain('pulser132.github.io');
  });

  it("targets the per-game active account, using that game's own script", () => {
    importPayload(loadPayload('hsr.json'));
    const hsrUid = getActiveUid('hsr')!;
    openImportDialog('hsr', vi.fn());

    const command = document.querySelector('.import-command code')!.textContent!;
    expect(command).toContain('hsr.ps1');
    expect(command).toContain(`'${hsrUid}'`);
  });

  it('has a file input for uploading a UIGF export as an alternative to pasting', () => {
    openImportDialog('genshin', vi.fn());
    const fileInput = document.querySelector<HTMLInputElement>('.import-file');
    expect(fileInput).not.toBeNull();
    expect(fileInput!.accept).toContain('json');
  });

  it('imports a real-shaped paimon.moe local-data backup pasted on the Genshin dialog', () => {
    const onImported = vi.fn();
    openImportDialog('genshin', onImported);

    const textarea = document.querySelector<HTMLTextAreaElement>('.import-textarea')!;
    textarea.value = loadText('paimon-moe-local-data.json');
    document.querySelector<HTMLButtonElement>('.import-confirm')!.click();

    expect(onImported).toHaveBeenCalledTimes(1);
    expect(getActiveAccount('genshin')?.uid).toBe('630164299');
  });

  it('mentions the Genshin local-data backup format on the Genshin dialog but not on HSR/ZZZ, where it isn’t supported', () => {
    openImportDialog('genshin', vi.fn());
    expect(document.querySelector('.import-alt-label')?.textContent).toMatch(/genshin tracker local-data backup/i);
    document.querySelector<HTMLButtonElement>('.import-cancel')!.click();
    expect(document.querySelector('.import-dialog')).toBeNull(); // removed on close

    openImportDialog('hsr', vi.fn());
    const hsrLabel = document.querySelector('.import-alt-label')?.textContent ?? '';
    expect(hsrLabel).toMatch(/isn't supported yet/i);
    expect(hsrLabel).not.toMatch(/local-data backup\?/i);
  });

  it('includes the game-specific one-liner in a copyable code block', () => {
    openImportDialog('hsr', vi.fn());
    const code = document.querySelector('.import-command code');
    expect(code?.textContent).toContain('hsr.ps1');
  });
});
