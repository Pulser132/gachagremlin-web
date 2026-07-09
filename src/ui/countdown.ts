/**
 * One shared 1-second ticker for the whole page, rather than a setInterval
 * per card — updates every `[data-deadline]` element's text each tick and
 * flips it to "Ended" once its deadline passes.
 */
import { formatCountdown } from './format.ts';

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
