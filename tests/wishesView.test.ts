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

/** Finds the history-table row for a given item name, from a game rendered
 * via renderWishesView appended to document.body. */
function findRow(name: string): HTMLTableRowElement {
  const row = [...document.querySelectorAll<HTMLTableRowElement>('.history-table tbody tr')].find((tr) =>
    tr.textContent?.includes(name),
  );
  if (!row) throw new Error(`no history row for "${name}"`);
  return row;
}

describe('renderWishesView history table portraits', () => {
  beforeEach(() => {
    // hsr.json: Herta (4★ Character, in the portrait manifest), Seele (5★
    // Character, also in the manifest), Trailblazer (4★ Character, not in the
    // manifest — a miss), SAM (5★ Character, also a miss), and three 3★ Light
    // Cones (rarity-gated out regardless of manifest membership).
    importPayload(loadPayload('hsr.json'));
    document.body.appendChild(renderWishesView('hsr', vi.fn()));
  });

  it('renders a portrait slot for a matched row, with the category glyph still inside and its label still in the cell', () => {
    const cell = findRow('Herta').querySelector('.history-item-cell')!;

    const slot = cell.querySelector('.icon-slot');
    expect(slot).not.toBeNull();
    expect(slot!.querySelector('img.portrait-img')).not.toBeNull();
    expect(slot!.querySelector('svg.item-icon')).not.toBeNull(); // the category badge, not gone

    const label = cell.querySelector('.sr-only');
    expect(label).not.toBeNull();
    expect(label!.textContent).toMatch(/character/i);
  });

  it('renders an unmatched row exactly as before portraits existed — no slot, no skeleton', () => {
    // Trailblazer is 4★ Character (both gates pass) but absent from the
    // manifest — the ordinary miss case, not a rarity/category exclusion.
    const cell = findRow('Trailblazer').querySelector('.history-item-cell')!;

    expect(cell.querySelector('.icon-slot')).toBeNull();
    expect(cell.querySelector('img.portrait-img')).toBeNull();
    expect(cell.querySelector('svg.item-icon')).not.toBeNull();
    expect(cell.querySelector('.sr-only')).not.toBeNull();
  });

  it('rarity-gates 3★ Light Cones out even though nothing in their name/category excludes them', () => {
    const cell = findRow('Adversarial').querySelector('.history-item-cell')!;
    expect(cell.querySelector('.icon-slot')).toBeNull();
  });

  it('sets a no-referrer policy on every portrait image', () => {
    const imgs = document.querySelectorAll<HTMLImageElement>('.history-table img.portrait-img');
    expect(imgs.length).toBeGreaterThan(0); // Herta and Seele both match
    for (const img of imgs) {
      expect(img.referrerPolicy).toBe('no-referrer');
    }
  });

  it('never sets lazy loading on a portrait image', () => {
    const imgs = document.querySelectorAll<HTMLImageElement>('.history-table img.portrait-img');
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img.loading).not.toBe('lazy');
    }
  });

  it('rebuilds the plain glyph in place when a matched portrait fails to load, leaving no gap and no stranded badge', () => {
    const cell = findRow('Herta').querySelector('.history-item-cell')!;
    const img = cell.querySelector<HTMLImageElement>('img.portrait-img')!;

    img.dispatchEvent(new Event('error'));

    expect(cell.querySelector('.icon-slot')).toBeNull();
    expect(cell.querySelector('img.portrait-img')).toBeNull();
    expect(cell.querySelector('svg.item-icon')).not.toBeNull();
    const labels = cell.querySelectorAll('.sr-only');
    expect(labels.length).toBe(1); // not doubled up with the pre-error label
    expect(labels[0]!.textContent).toMatch(/character/i);
  });
});

/** Finds the Recent 5★ `<li>` for a given item name, from a game rendered via
 * renderWishesView appended to document.body. */
function findRecentItem(name: string): HTMLLIElement {
  const li = [...document.querySelectorAll<HTMLLIElement>('.banner-recent li')].find((li) =>
    li.textContent?.includes(name),
  );
  if (!li) throw new Error(`no Recent 5★ item for "${name}"`);
  return li;
}

describe('renderWishesView Recent 5★ list portraits', () => {
  beforeEach(() => {
    // hsr.json: Seele (5★ Character, bannerType 11, in the portrait
    // manifest) and SAM (5★ Character, bannerType 22, absent from the
    // manifest — a miss), each the sole 5★ in its own banner group so each
    // gets its own Recent 5★ expander.
    importPayload(loadPayload('hsr.json'));
    document.body.appendChild(renderWishesView('hsr', vi.fn()));
  });

  it('renders a 40px portrait for a matched 5★, wrapped with the name so pity stays hard right', () => {
    const li = findRecentItem('Seele');

    const wrapper = li.querySelector('.recent-item');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector('img.recent-portrait')).not.toBeNull();
    expect(wrapper!.textContent).toContain('Seele');
    expect(li.querySelector('.recent-pity')).not.toBeNull();

    // No category badge/label is introduced on this surface.
    expect(li.querySelector('svg.item-icon')).toBeNull();
    expect(li.querySelector('.sr-only')).toBeNull();
  });

  it('renders an unmatched 5★ exactly as before portraits existed — no wrapper, no icon', () => {
    const li = findRecentItem('SAM');

    expect(li.querySelector('.recent-item')).toBeNull();
    expect(li.querySelector('img.recent-portrait')).toBeNull();
    expect(li.textContent).toContain('SAM');
    expect(li.querySelector('.recent-pity')).not.toBeNull();
  });

  it('sets a no-referrer policy on every recent-portrait image', () => {
    const imgs = document.querySelectorAll<HTMLImageElement>('.banner-recent img.recent-portrait');
    expect(imgs.length).toBeGreaterThan(0); // Seele matches
    for (const img of imgs) {
      expect(img.referrerPolicy).toBe('no-referrer');
    }
  });

  it('replaces the portrait wrapper with the bare name when a matched image fails to load', () => {
    const li = findRecentItem('Seele');
    const img = li.querySelector<HTMLImageElement>('img.recent-portrait')!;

    img.dispatchEvent(new Event('error'));

    expect(li.querySelector('.recent-item')).toBeNull();
    expect(li.querySelector('img.recent-portrait')).toBeNull();
    expect(li.textContent).toContain('Seele');
    expect(li.querySelector('.recent-pity')).not.toBeNull();
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

  it('emits the plain full-download one-liner when the account has never full-imported', () => {
    // A store-level import without the fullImport verdict (e.g. restored from
    // a tracker backup) must not arm incremental — its history is unvetted.
    importPayload(loadPayload('genshin.json'));
    openImportDialog('genshin', vi.fn());

    const code = document.querySelector('.import-command code')!;
    // The one-liner ends at the uid — no third (watermark) argument.
    expect(code.textContent!.endsWith(`'800000001'"`)).toBe(true);
    expect(document.querySelector('.import-reimport')).toBeNull(); // no checkbox either
  });

  it('appends the watermark arg for a full-imported account, and the checkbox strips it', () => {
    importPayload({ ...loadPayload('genshin.json'), fullImport: true });
    openImportDialog('genshin', vi.fn());

    const code = document.querySelector('.import-command code')!;
    // Third positional arg present, carrying a 301 watermark (fixture ids are
    // short, which classifies as real — see classifyIdScheme).
    expect(code.textContent).toMatch(/'' '800000001' '[^']*301:/);

    const checkbox = document.querySelector<HTMLInputElement>('.import-reimport input')!;
    expect(checkbox).not.toBeNull();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(code.textContent).not.toMatch(/301:/); // full re-import: watermarks gone
    expect(code.textContent).toContain(`'800000001'`);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(code.textContent).toMatch(/301:/); // and back
  });

  it('shows "already up to date" without importing or closing on an empty incremental payload', () => {
    importPayload({ ...loadPayload('genshin.json'), fullImport: true }, () => 1000);
    const onImported = vi.fn();
    openImportDialog('genshin', onImported);

    const payload = loadPayload('genshin.json');
    const textarea = document.querySelector<HTMLTextAreaElement>('.import-textarea')!;
    textarea.value = JSON.stringify({ ...payload, items: [], incremental: true });
    document.querySelector<HTMLButtonElement>('.import-confirm')!.click();

    const statusBox = document.querySelector<HTMLElement>('.import-status')!;
    expect(statusBox.hidden).toBe(false);
    expect(statusBox.textContent).toMatch(/already up to date/i);
    expect(document.querySelector<HTMLElement>('.import-error')!.hidden).toBe(true);
    expect(onImported).not.toHaveBeenCalled();
    expect(document.querySelector('.import-dialog')).not.toBeNull(); // stays open
    expect(getActiveAccount('genshin')?.updatedAt).toBe(1000); // store untouched
  });

  it('still imports an incremental payload that carries new pulls', () => {
    importPayload({ ...loadPayload('genshin.json'), fullImport: true });
    const onImported = vi.fn();
    openImportDialog('genshin', onImported);

    const payload = loadPayload('genshin.json');
    const newPull = { ...payload.items[0], id: '9000000000000000000' };
    const textarea = document.querySelector<HTMLTextAreaElement>('.import-textarea')!;
    textarea.value = JSON.stringify({ ...payload, items: [newPull], incremental: true });
    document.querySelector<HTMLButtonElement>('.import-confirm')!.click();

    expect(onImported).toHaveBeenCalledTimes(1);
    expect(getActiveAccount('genshin')?.items.some((i) => i.id === '9000000000000000000')).toBe(true);
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
