// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyBarColours, contrastRatio, createColourSource, pickColour } from '../src/ui/barColour.ts';

const px = (...rgba: number[][]) => Uint8ClampedArray.from(rgba.flat());
const chan = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
const hsl = (hex: string) => {
  const [r, g, b] = [0, 1, 2].map((i) => chan(hex, i) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  return { s: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), l };
};

describe('pickColour', () => {
  it('prefers the vibrant pixel over greys and near-black/white', () => {
    const c = pickColour(px([128, 128, 128, 255], [250, 250, 250, 255], [20, 20, 20, 255], [200, 40, 40, 255]));
    expect(c).not.toBeNull();
    expect(hsl(c!.bg).s).toBeGreaterThan(0.34);
    expect(chan(c!.bg, 0)).toBeGreaterThan(chan(c!.bg, 1)); // still red
  });

  it('weights saturation by closeness to mid-lightness', () => {
    // Both fully saturated, but the blue one is nearer mid-lightness.
    const c = pickColour(px([255, 200, 200, 255], [40, 40, 220, 255]));
    expect(chan(c!.bg, 2)).toBeGreaterThan(chan(c!.bg, 0));
  });

  it('clamps saturation to 35-80% and lightness to 30-70%', () => {
    for (const pixel of [[255, 0, 0, 255], [250, 235, 235, 255], [60, 50, 50, 255], [120, 110, 110, 255]]) {
      const { s, l } = hsl(pickColour(px(pixel))!.bg);
      expect(s).toBeGreaterThanOrEqual(0.34);
      expect(s).toBeLessThanOrEqual(0.81);
      expect(l).toBeGreaterThanOrEqual(0.29);
      expect(l).toBeLessThanOrEqual(0.71);
    }
  });

  it('switches text to whichever of white/dark has higher contrast', () => {
    const light = pickColour(px([200, 200, 60, 255]))!;
    const dark = pickColour(px([30, 30, 200, 255]))!;
    expect(light.text).toBe('#14141a');
    expect(dark.text).toBe('#ffffff');
    for (const c of [light, dark]) {
      const other = c.text === '#ffffff' ? '#14141a' : '#ffffff';
      expect(contrastRatio(c.bg, c.text)).toBeGreaterThanOrEqual(contrastRatio(c.bg, other));
    }
  });

  it('lets a dominant hue outvote one stray, slightly more vibrant pixel', () => {
    const muted = [170, 60, 60, 255];
    const stray = [30, 30, 255, 255];
    const c = pickColour(px(...Array.from({ length: 20 }, () => muted), stray))!;
    expect(chan(c.bg, 0)).toBeGreaterThan(chan(c.bg, 2));
  });

  it('returns null (use the category colour) for empty, greyscale or transparent input', () => {
    expect(pickColour(new Uint8ClampedArray(0))).toBeNull();
    expect(pickColour(px([90, 90, 90, 255], [200, 200, 200, 255]))).toBeNull();
    expect(pickColour(px([255, 0, 0, 0]))).toBeNull();
  });
});

describe('colour source', () => {
  const red = px([200, 40, 40, 255]);

  it('falls back (null) when the load fails or there is no image', async () => {
    const failing = createColourSource(async () => {
      throw new Error('tainted');
    });
    expect(await failing('https://x/a.png')).toBeNull();
    const none = createColourSource(async () => null);
    expect(await none('https://x/b.png')).toBeNull();
    expect(await createColourSource(async () => red)(null)).toBeNull();
  });

  it('caches per URL', async () => {
    let calls = 0;
    const src = createColourSource(async () => {
      calls++;
      return red;
    });
    await src('u');
    await src('u');
    expect(calls).toBe(1);
  });

  it('applyBarColours leaves a bar on its category colour when the load fails', async () => {
    const good = document.createElement('button');
    const bad = document.createElement('button');
    const src = createColourSource(async (url) => {
      if (url === 'bad') throw new Error('x');
      return red;
    });
    await applyBarColours(
      [
        { btn: good, url: 'good' },
        { btn: bad, url: 'bad' },
      ],
      src,
    );
    expect(good.style.backgroundColor).not.toBe('');
    expect(good.style.color).not.toBe('');
    expect(bad.style.backgroundColor).toBe('');
    expect(bad.style.color).toBe('');
  });
});
