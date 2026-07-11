// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveAccount, importPayload } from '../src/data/wishes/store.ts';
import { openImportDialog } from '../src/ui/importDialog.ts';
import { renderWishesView } from '../src/ui/wishesView.ts';
import type { WishPayload } from '../src/types.ts';

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

    expect(view.textContent).toMatch(/uid 800000001/i);

    // From the fixture: character group (301+400) has since5Star = 3 pulls
    // since the last 5★ (id 8, "Furina"), out of 90 hard pity.
    const characterCard = [...view.querySelectorAll('.pity-card')].find((c) =>
      c.textContent?.includes('Character Event Wish'),
    );
    expect(characterCard).toBeDefined();
    expect(characterCard!.textContent).toMatch(/3 \/ 90 pity/);

    // Furina (the most recent 5★) is not in the standard pool, so the 50/50
    // is not currently guaranteed.
    expect(characterCard!.querySelector('.guarantee-badge')?.textContent).toBe('50/50');

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
