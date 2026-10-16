const UNITS: [label: string, ms: number][] = [
  ['y', 365 * 86_400_000],
  ['mo', 30 * 86_400_000],
  ['w', 7 * 86_400_000],
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000],
];

/** Compact age of a past timestamp ("2h ago"); anything under a minute (or in the future) is "just now". */
export function relativeAge(then: number, now: number = Date.now()): string {
  const age = now - then;
  for (const [label, ms] of UNITS) {
    if (age >= ms) return `${Math.floor(age / ms)}${label} ago`;
  }
  return 'just now';
}
