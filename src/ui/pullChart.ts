/**
 * "Pulls per month" — a single-series area chart of the account's import
 * history over time, filling the last cell of the banner-card grid. Inline
 * SVG, no dependencies: 2px line + ~10% wash in the game accent, hairline
 * gridlines, mono tick labels, and a crosshair + tooltip on hover.
 *
 * Uses --accent-icon rather than raw --accent for the series: it's the same
 * vivid accent in dark mode but the darkened AA-safe variant in light mode
 * (see the --accent-icon comment in styles.css).
 */
import type { WishItem } from '../types.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Internal viewBox coordinates. The SVG scales to its grid cell (~250-380px),
// so these are chosen so 10-unit tick text renders at roughly 8.5-12.5px.
const W = 300;
const H = 170;
const MARGIN = { top: 10, right: 8, bottom: 24, left: 34 };

interface MonthBin {
  key: string; // "YYYY-MM"
  count: number;
}

/** Counts pulls per calendar month, filling gap months with zero so quiet
 * stretches read as lulls instead of being silently skipped. */
export function binByMonth(items: WishItem[]): MonthBin[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.time.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return [];

  const keys = [...counts.keys()].sort();
  const [endYear, endMonth] = keys[keys.length - 1].split('-').map(Number);
  let [year, month] = keys[0].split('-').map(Number);

  const bins: MonthBin[] = [];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    bins.push({ key, count: counts.get(key) ?? 0 });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return bins;
}

/** Smallest "nice" (1/2/5 ladder) step so that 2 steps cover `max` — the y
 * axis then reads 0 / step / 2·step with clean numbers. */
function niceHalfStep(max: number): number {
  const target = max / 2;
  const pow = 10 ** Math.floor(Math.log10(Math.max(target, 1)));
  for (const mult of [1, 2, 5, 10]) {
    const step = mult * pow;
    if (target <= step) return step;
  }
  return 10 * pow;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function tickText(x: number, y: number, text: string, anchor: 'start' | 'middle' | 'end'): SVGTextElement {
  const t = svgEl('text', {
    x: String(x),
    y: String(y),
    'text-anchor': anchor,
    'font-size': '10',
    fill: 'var(--text-muted)',
    'font-family': 'var(--font-mono)',
  });
  t.textContent = text;
  return t;
}

/** Renders the chart card. `itemLabel` is the game's own word for a pull
 * ("Wishes" / "Warps" / "Signal Searches"), used in the title and tooltip. */
export function renderPullChart(items: WishItem[], itemLabel: string): HTMLElement {
  const card = document.createElement('article');
  card.className = 'banner-card chart-card';

  const head = document.createElement('div');
  head.className = 'banner-card-head';
  const title = document.createElement('h3');
  title.className = 'banner-card-title';
  title.textContent = `${itemLabel} per month`;
  head.appendChild(title);
  card.appendChild(head);

  const bins = binByMonth(items);
  if (bins.length < 2) {
    const note = document.createElement('p');
    note.className = 'chart-empty';
    note.textContent = 'Not enough months of history to chart yet.';
    card.appendChild(note);
    return card;
  }

  const plotW = W - MARGIN.left - MARGIN.right;
  const plotH = H - MARGIN.top - MARGIN.bottom;
  const maxCount = Math.max(...bins.map((b) => b.count));
  const step = niceHalfStep(maxCount);
  const yMax = 2 * step;

  const x = (i: number) => MARGIN.left + (i / (bins.length - 1)) * plotW;
  const y = (v: number) => MARGIN.top + plotH - (v / yMax) * plotH;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  svg.setAttribute('aria-label', `${itemLabel} per month, ${bins[0].key} to ${bins[bins.length - 1].key}`);

  // Horizontal gridlines + y ticks at 0 / step / 2·step — recessive hairlines.
  for (const v of [0, step, yMax]) {
    svg.appendChild(
      svgEl('line', {
        x1: String(MARGIN.left),
        x2: String(W - MARGIN.right),
        y1: String(y(v)),
        y2: String(y(v)),
        stroke: 'var(--border)',
        'stroke-width': '1',
      }),
    );
    svg.appendChild(tickText(MARGIN.left - 5, y(v) + 3, v.toLocaleString(), 'end'));
  }

  // X ticks: at most 4, evenly spaced across the months — "YYYY-MM" labels
  // are wide, and the tooltip names every month anyway.
  const tickCount = Math.min(4, bins.length);
  for (let t = 0; t < tickCount; t++) {
    const i = Math.round((t / (tickCount - 1)) * (bins.length - 1));
    const anchor = t === 0 ? 'start' : t === tickCount - 1 ? 'end' : 'middle';
    svg.appendChild(tickText(x(i), H - MARGIN.bottom + 14, bins[i].key, anchor));
  }

  // Area wash + 2px line in the series color.
  const linePoints = bins.map((b, i) => `${x(i)},${y(b.count)}`);
  svg.appendChild(
    svgEl('path', {
      d: `M ${linePoints.join(' L ')} L ${x(bins.length - 1)},${y(0)} L ${x(0)},${y(0)} Z`,
      fill: 'var(--accent-icon)',
      opacity: '0.12',
    }),
  );
  svg.appendChild(
    svgEl('path', {
      d: `M ${linePoints.join(' L ')}`,
      fill: 'none',
      stroke: 'var(--accent-icon)',
      'stroke-width': '2',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }),
  );

  // Hover layer: crosshair + marker dot (with a surface ring) + HTML tooltip.
  const crosshair = svgEl('line', {
    y1: String(MARGIN.top),
    y2: String(H - MARGIN.bottom),
    stroke: 'var(--border)',
    'stroke-width': '1',
    visibility: 'hidden',
  });
  svg.appendChild(crosshair);
  const dot = svgEl('circle', {
    r: '4.5',
    fill: 'var(--accent-icon)',
    stroke: 'var(--surface)',
    'stroke-width': '2',
    visibility: 'hidden',
  });
  svg.appendChild(dot);

  const wrap = document.createElement('div');
  wrap.className = 'pull-chart';
  wrap.appendChild(svg);

  const tooltip = document.createElement('div');
  tooltip.className = 'pull-chart-tooltip';
  tooltip.hidden = true;
  wrap.appendChild(tooltip);

  wrap.addEventListener('mousemove', (event) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const internalX = ((event.clientX - rect.left) / rect.width) * W;
    const i = Math.min(
      bins.length - 1,
      Math.max(0, Math.round(((internalX - MARGIN.left) / plotW) * (bins.length - 1))),
    );
    const bin = bins[i];

    crosshair.setAttribute('x1', String(x(i)));
    crosshair.setAttribute('x2', String(x(i)));
    crosshair.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', String(x(i)));
    dot.setAttribute('cy', String(y(bin.count)));
    dot.setAttribute('visibility', 'visible');

    tooltip.textContent = `${bin.key} · ${bin.count.toLocaleString()} ${itemLabel.toLowerCase()}`;
    tooltip.hidden = false;
    // Position over the hovered month, in the wrapper's coordinate space.
    const scale = rect.width / W;
    tooltip.style.left = `${(x(i) * scale).toFixed(1)}px`;
    tooltip.style.top = `${(y(bin.count) * scale).toFixed(1)}px`;
  });
  wrap.addEventListener('mouseleave', () => {
    crosshair.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  });

  card.appendChild(wrap);
  return card;
}
