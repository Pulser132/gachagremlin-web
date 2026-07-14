/**
 * The per-game account switcher: a dropdown to swap between saved UIDs, plus
 * Rename (set a nickname) and a guarded Remove (delete all of a UID's pulls
 * behind a confirmation checkbox). Storage already keys accounts by (game,
 * uid); this is the UI over `listAccounts` / `setActiveUid` / `setNickname` /
 * `deleteAccount` in src/data/wishes/store.ts.
 */
import { GAME_BANNER_CONFIGS } from '../data/wishes/banners.ts';
import { deleteAccount, getActiveUid, listAccounts, loadAccount, setActiveUid, setNickname } from '../data/wishes/store.ts';
import type { GameKey } from '../types.ts';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  return node;
}

/** Opens a native <dialog> built by `build`, mirroring importDialog.ts: append
 * to document.body (so the native top-layer works and per-game tokens on
 * <html> still apply), fall back to the open attribute for test DOMs, and
 * remove on close. */
function openDialog(build: (dialog: HTMLDialogElement) => void): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'uid-dialog';
  build(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  try {
    dialog.showModal();
  } catch {
    dialog.setAttribute('open', '');
  }
}

function accountLabel(uid: string, nickname?: string): string {
  return nickname ? `${nickname} · ${uid}` : uid;
}

function openRenameDialog(game: GameKey, uid: string, current: string | undefined, onChange: () => void): void {
  openDialog((dialog) => {
    dialog.appendChild(el('h2', { text: 'Rename account' }));
    dialog.appendChild(el('p', { className: 'uid-dialog-sub', text: `UID ${uid}` }));

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'uid-nickname-input';
    input.placeholder = 'Nickname (e.g. Main, Alt)';
    input.value = current ?? '';
    input.setAttribute('aria-label', 'Account nickname');
    input.maxLength = 40;
    dialog.appendChild(input);

    const actions = el('div', { className: 'uid-dialog-actions' });
    const cancel = el('button', { className: 'uid-dialog-cancel', text: 'Cancel' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => dialog.close());
    const save = el('button', { className: 'uid-dialog-confirm', text: 'Save' });
    save.type = 'button';
    save.addEventListener('click', () => {
      setNickname(game, uid, input.value);
      dialog.close();
      onChange();
    });
    actions.append(cancel, save);
    dialog.appendChild(actions);
  });
}

function openDeleteDialog(game: GameKey, uid: string, nickname: string | undefined, onChange: () => void): void {
  const account = loadAccount(game, uid);
  const count = account?.items.length ?? 0;
  const itemLabel = GAME_BANNER_CONFIGS[game].itemLabel.toLowerCase();

  openDialog((dialog) => {
    dialog.appendChild(el('h2', { text: 'Remove account' }));
    dialog.appendChild(
      el('p', {
        className: 'uid-dialog-warning',
        text: `This permanently deletes all ${count} imported ${itemLabel} for ${accountLabel(uid, nickname)} from this browser. It cannot be undone.`,
      }),
    );
    dialog.appendChild(
      el('p', {
        className: 'uid-dialog-sub',
        text: 'Export a backup first if you might want this data back and haven’t synced it elsewhere.',
      }),
    );

    const confirmRow = el('label', { className: 'uid-delete-confirm' });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    confirmRow.appendChild(checkbox);
    confirmRow.appendChild(document.createTextNode(` I understand this deletes all ${itemLabel} for UID ${uid}.`));
    dialog.appendChild(confirmRow);

    const actions = el('div', { className: 'uid-dialog-actions' });
    const cancel = el('button', { className: 'uid-dialog-cancel', text: 'Cancel' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => dialog.close());
    const del = el('button', { className: 'uid-dialog-danger', text: 'Delete' }) as HTMLButtonElement;
    del.type = 'button';
    del.disabled = true;
    checkbox.addEventListener('change', () => {
      del.disabled = !checkbox.checked;
    });
    del.addEventListener('click', () => {
      if (!checkbox.checked) return;
      deleteAccount(game, uid);
      dialog.close();
      onChange();
    });
    actions.append(cancel, del);
    dialog.appendChild(actions);
  });
}

/** Renders the account switcher for `game`, or null when nothing is stored. */
export function renderUidSwitcher(game: GameKey, onChange: () => void): HTMLElement | null {
  const accounts = listAccounts(game);
  if (accounts.length === 0) return null;

  const activeUid = getActiveUid(game);
  const wrap = el('div', { className: 'uid-switcher' });

  const select = document.createElement('select');
  select.className = 'uid-select';
  select.setAttribute('aria-label', 'Switch account (UID)');
  for (const { uid, nickname } of accounts) {
    const opt = document.createElement('option');
    opt.value = uid;
    opt.textContent = accountLabel(uid, nickname);
    if (uid === activeUid) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    setActiveUid(game, select.value);
    onChange();
  });
  wrap.appendChild(select);

  const active = accounts.find((a) => a.uid === activeUid) ?? accounts[0];

  const renameBtn = el('button', { className: 'uid-action', text: 'Rename' });
  renameBtn.type = 'button';
  renameBtn.addEventListener('click', () => openRenameDialog(game, active.uid, active.nickname, onChange));
  wrap.appendChild(renameBtn);

  const removeBtn = el('button', { className: 'uid-action uid-action-danger', text: 'Remove' });
  removeBtn.type = 'button';
  removeBtn.addEventListener('click', () => openDeleteDialog(game, active.uid, active.nickname, onChange));
  wrap.appendChild(removeBtn);

  return wrap;
}
