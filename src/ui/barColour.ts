/** Bar colour from an item's own art (PRD "Bar colour"). */

export interface BarColour {
  bg: string;
  text: string;
}

/** Decoded RGBA pixels, or null when there is nothing to read. */
export type PixelLoader = (url: string) => Promise<ArrayLike<number> | null>;

const SAT_MIN = 0.35;
const SAT_MAX = 0.8;
const LIGHT_MIN = 0.3;
const LIGHT_MAX = 0.7;
/** Below this weight a pixel is effectively grey and not worth picking. */
const MIN_WEIGHT = 0.02;
const WHITE = '#ffffff';
const DARK = '#14141a';
const SAMPLE_SIZE = 24;
const HUE_BUCKETS = 12;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Finds the dominant hue (the 30-degree bucket with the most total vibrancy,
 * so one stray bright pixel cannot outvote a whole region), then takes that
 * bucket's most vibrant opaque pixel. Vibrancy is saturation weighted by
 * closeness to mid-lightness. The pick is clamped into a readable range and
 * text is white or dark by contrast. Returns null for empty, transparent or
 * greyscale input; the caller then keeps the category colour.
 */
export function pickColour(pixels: ArrayLike<number>): BarColour | null {
  const totals = new Array<number>(HUE_BUCKETS).fill(0);
  const bests = new Array<{ weight: number; hsl: [number, number, number] } | null>(HUE_BUCKETS).fill(null);
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const hsl = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
    const [hue, sat, light] = hsl;
    const weight = sat * (1 - Math.abs(2 * light - 1));
    if (weight <= MIN_WEIGHT) continue;
    const bucket = Math.floor(hue / (360 / HUE_BUCKETS)) % HUE_BUCKETS;
    totals[bucket] += weight;
    if (!bests[bucket] || weight > bests[bucket]!.weight) bests[bucket] = { weight, hsl };
  }
  const top = totals.indexOf(Math.max(...totals));
  const pick = bests[top]?.hsl;
  if (!pick) return null;
  const bg = hslToHex(pick[0], clamp(pick[1], SAT_MIN, SAT_MAX), clamp(pick[2], LIGHT_MIN, LIGHT_MAX));
  return { bg, text: contrastRatio(bg, WHITE) >= contrastRatio(bg, DARK) ? WHITE : DARK };
}

/** Draws the image into a 24x24 canvas. Rejects on load failure or a tainted canvas. */
export const canvasPixelLoader: PixelLoader = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        resolve(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });

/** A bar and the art URL its colour is read from. */
export interface TintTarget {
  btn: HTMLElement;
  url: string | null;
}

export type ColourSource = (url: string | null) => Promise<BarColour | null>;

/** Resolves a colour per image URL, cached for the session (failures too). Never rejects. */
export function createColourSource(load: PixelLoader = canvasPixelLoader): ColourSource {
  const cache = new Map<string, Promise<BarColour | null>>();
  return (url) => {
    if (!url) return Promise.resolve(null);
    let hit = cache.get(url);
    if (!hit) {
      hit = load(url).then(
        (px) => (px ? pickColour(px) : null),
        () => null,
      );
      cache.set(url, hit);
    }
    return hit;
  };
}

export const sessionColourSource: ColourSource = createColourSource();

/** Tints each bar once its colour resolves; a null result leaves the category colour. */
export async function applyBarColours(
  bars: TintTarget[],
  source: ColourSource = sessionColourSource,
): Promise<void> {
  await Promise.all(
    bars.map(async ({ btn, url }) => {
      const colour = await source(url);
      if (!colour) return;
      btn.style.backgroundColor = colour.bg;
      btn.style.color = colour.text;
    }),
  );
}
