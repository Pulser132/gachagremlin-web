import { GAME_BANNER_CONFIGS } from '../data/wishes/banners.ts';
import { parseAnyImport } from '../data/wishes/payload.ts';
import { getActiveUid, importPayloads } from '../data/wishes/store.ts';
import { GAME_CONFIGS } from '../data/wiki/games.ts';
import type { GameKey } from '../types.ts';

/** What an import did, so the caller can warn when the pulls landed on a
 * different UID than the one being viewed. `previousUid` is the account that
 * was active before the import; `activeUid` is the one now shown (the last
 * imported uid, matching importPayloads). */
export interface ImportSummary {
  previousUid: string | null;
  activeUid: string;
  importedUids: string[];
}

const SCRIPT_BASE_URL = 'https://pulser132.github.io/gachagremlin-web/import';
const SCRIPT_NAMES: Record<GameKey, string> = { genshin: 'genshin.ps1', hsr: 'hsr.ps1', zzz: 'zzz.ps1' };
const HISTORY_LABEL: Record<GameKey, string> = {
  genshin: 'Wish History',
  hsr: 'Warp History',
  zzz: 'Signal Search History',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  return node;
}

/** Builds and shows the import dialog for `game`. Calls `onImported` with a
 * summary once a pasted payload has been validated and merged into storage. */
export function openImportDialog(game: GameKey, onImported: (summary: ImportSummary) => void): void {
  const itemLabel = GAME_BANNER_CONFIGS[game].itemLabel;
  const historyLabel = HISTORY_LABEL[game];
  const oneLiner = `iwr -useb ${SCRIPT_BASE_URL}/${SCRIPT_NAMES[game]} | iex`;

  const dialog = document.createElement('dialog');
  dialog.className = 'import-dialog';

  dialog.appendChild(el('h2', { text: `Import ${itemLabel}` }));

  const steps = document.createElement('ol');
  steps.className = 'import-steps';
  const stepTexts = [
    `Open the ${historyLabel} screen in ${GAME_CONFIGS[game].label} on your PC (from any banner, tap History).`,
    'Open Windows PowerShell — search for "PowerShell" in the Start menu.',
    'Copy the command below, paste it into PowerShell, and press Enter.',
    'It copies your full history to your clipboard.',
    'Paste it (Ctrl+V) into the box below and click Import.',
  ];
  for (const text of stepTexts) {
    const li = document.createElement('li');
    li.textContent = text;
    steps.appendChild(li);
  }
  dialog.appendChild(steps);

  const commandBlock = el('div', { className: 'import-command' });
  const code = document.createElement('code');
  code.textContent = oneLiner;
  commandBlock.appendChild(code);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'copy-button';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(oneLiner);
      copyBtn.textContent = 'Copied!';
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — select the text
      // instead so the player can still copy it with Ctrl+C.
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
    }, 2000);
  });
  commandBlock.appendChild(copyBtn);
  dialog.appendChild(commandBlock);

  const textarea = document.createElement('textarea');
  textarea.className = 'import-textarea';
  textarea.rows = 8;
  textarea.setAttribute('aria-label', 'Pasted history JSON');
  textarea.placeholder = 'Paste the copied history here…';
  dialog.appendChild(textarea);

  const altImport = el('div', { className: 'import-alt' });
  const altLabel =
    game === 'genshin'
      ? 'Paste not working, or importing a Genshin tracker local-data backup or a UIGF export from another tracker? Choose a file instead — including the backup copy the script saves alongside the clipboard copy.'
      : `Paste not working, or importing a UIGF export from another tracker? Choose a file instead — including the backup copy the script saves alongside the clipboard copy. (Importing ${GAME_CONFIGS[game].label} from a tracker's own backup format isn't supported yet.)`;
  altImport.appendChild(el('p', { className: 'import-alt-label', text: altLabel }));
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.className = 'import-file';
  fileInput.setAttribute('aria-label', 'Choose a history file instead');
  altImport.appendChild(fileInput);
  dialog.appendChild(altImport);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    textarea.value = await file.text();
    errorBox.hidden = true;
  });

  const errorBox = el('p', { className: 'import-error' });
  errorBox.hidden = true;
  errorBox.setAttribute('role', 'alert');
  dialog.appendChild(errorBox);

  const actions = el('div', { className: 'import-actions' });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'import-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => dialog.close());
  actions.appendChild(cancelBtn);

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'import-confirm';
  importBtn.textContent = 'Import';
  importBtn.addEventListener('click', () => {
    const result = parseAnyImport(textarea.value.trim(), game);
    if (!result.ok) {
      errorBox.textContent = result.error;
      errorBox.hidden = false;
      return;
    }
    const previousUid = getActiveUid(game);
    importPayloads(result.payloads);
    const importedUids = [...new Set(result.payloads.map((p) => p.uid))];
    // importPayloads leaves the last payload's uid active.
    const activeUid = result.payloads[result.payloads.length - 1].uid;
    dialog.close();
    onImported({ previousUid, activeUid, importedUids });
  });
  actions.appendChild(importBtn);
  dialog.appendChild(actions);

  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  try {
    dialog.showModal();
  } catch {
    // Environments without full <dialog> support (older browsers, some
    // test DOMs) — fall back to a plain open attribute so the dialog is
    // at least visible and usable, just without native modal behavior.
    dialog.setAttribute('open', '');
  }
}
