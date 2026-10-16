const DEFAULT_INVITE_URL = 'https://discord.gg/VEVbKKDey7';

/** The bot's Discord server invite (public). `VITE_DISCORD_INVITE_URL` overrides it at build time. */
export const DISCORD_INVITE_URL: string = String(import.meta.env.VITE_DISCORD_INVITE_URL ?? '').trim() || DEFAULT_INVITE_URL;

/** A dismissible note: the bot can only DM users who share a server with it. */
export function renderDeliverableHint(inviteUrl: string, onDismiss: () => void): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'data-footer-message deliverable-hint';
  wrap.setAttribute('role', 'status');
  wrap.append('The bot can only DM users who share a server with it, so reminders may not reach you.');
  if (inviteUrl) {
    wrap.append(' ');
    const a = document.createElement('a');
    a.href = inviteUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'Join the server';
    wrap.append(a);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'data-footer-btn';
  close.textContent = 'Dismiss';
  close.setAttribute('aria-label', 'Dismiss this note');
  close.addEventListener('click', onDismiss);
  wrap.append(' ', close);
  return wrap;
}
