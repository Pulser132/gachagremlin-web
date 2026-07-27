/**
 * One shared 1-second ticker for the whole page, rather than a setInterval
 * per card — updates every `[data-deadline]` element's text each tick and
 * flips it to "Ended" once its deadline passes.
 */
import { formatAbsolute, formatCountdown } from './format.ts';

let started = false;

function tick(): void {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>('[data-deadline]').forEach((el) => {
    const deadline = Number(el.dataset.deadline);
    if (Number.isNaN(deadline)) return;
    const remaining = formatCountdown(deadline, now);
    const label = el.dataset.countdownLabel ?? '';
    const ended = remaining === 'ended';
    el.textContent = ended ? 'Ended' : `${label} ${remaining}`.trim();
    el.classList.toggle('ended', ended);
  });
}

export function startCountdownTicker(): void {
  if (started) return;
  started = true;
  tick();
  setInterval(tick, 1000);
}

/**
 * A `<p>` carrying the `[data-deadline]`/`data-countdown-label` pair `tick()`
 * above reads every second, plus the absolute time alongside it. Shared by
 * `eventCard.ts` and `bannersView.ts` so this contract lives in one place.
 */
export function renderCountdownRow(label: string, unixSeconds: number): HTMLElement {
  const row = document.createElement('p');
  row.className = 'event-time-row';
  const countdown = document.createElement('span');
  countdown.className = 'countdown';
  countdown.dataset.deadline = String(unixSeconds);
  countdown.dataset.countdownLabel = label;
  row.appendChild(countdown);
  const absolute = document.createElement('span');
  absolute.className = 'event-time-absolute';
  absolute.textContent = ` (${formatAbsolute(unixSeconds)})`;
  row.appendChild(absolute);
  return row;
}
