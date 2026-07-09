/** Formatting helpers for countdowns and absolute local times. */

/** "3d 14h 02m" style countdown; shrinks to the largest two units left. */
export function formatCountdown(deadlineUnix: number, nowMs: number): string {
  const diffSec = deadlineUnix - Math.floor(nowMs / 1000);
  if (diffSec <= 0) return 'ended';
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = Math.floor(diffSec / 86400);
  const h = Math.floor((diffSec % 86400) / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

/** Absolute end/start time rendered in the visitor's own local timezone —
 * the browser equivalent of Discord's <t:UNIX:F> tag. */
export function formatAbsolute(unixSeconds: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(unixSeconds * 1000),
  );
}
