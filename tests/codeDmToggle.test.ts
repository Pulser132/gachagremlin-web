// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { buildCodeDmToggle as build } from '../src/ui/codeDmToggle.ts';
import { ReminderApiError, type CodeDmState } from '../src/data/reminderApi.ts';
import dms from './fixtures/codes/code-dms.json';
import dmsHsrOn from './fixtures/codes/code-dms-hsr-on.json';

const buildCodeDmToggle: typeof build = (game, a) => {
  const el = build(game, a);
  document.body.appendChild(el);
  return el;
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const box = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[type=checkbox]')!;
const msg = (el: HTMLElement) => el.querySelector('[role=status]')!.textContent;

function api(over: Partial<{ codeDms: () => Promise<CodeDmState>; setCodeDms: (c: Partial<CodeDmState>) => Promise<CodeDmState> }> = {}) {
  return { codeDms: vi.fn(async () => dms as CodeDmState), setCodeDms: vi.fn(async () => dmsHsrOn as CodeDmState), ...over };
}

describe('buildCodeDmToggle', () => {
  it('reflects the server state for the current game', async () => {
    const on = buildCodeDmToggle('genshin', api());
    const off = buildCodeDmToggle('hsr', api());
    expect(box(on).disabled).toBe(true); // until loaded
    await flush();
    expect(box(on).checked).toBe(true);
    expect(box(on).disabled).toBe(false);
    await flush();
    expect(box(off).checked).toBe(false);
  });

  it('sends a partial PUT for the current game and adopts the returned state', async () => {
    const a = api();
    const el = buildCodeDmToggle('hsr', a);
    await flush();
    box(el).click();
    await flush();
    expect(a.setCodeDms).toHaveBeenCalledWith({ hsr: true });
    expect(box(el).checked).toBe(true);
  });

  it('on 422 dms_closed shows the hint and leaves the toggle off', async () => {
    const a = api({ setCodeDms: async () => { throw new ReminderApiError('dms_closed', 'x', 422, 'dms_closed'); } });
    const el = buildCodeDmToggle('hsr', a);
    await flush();
    box(el).click();
    await flush();
    expect(box(el).checked).toBe(false);
    expect(msg(el)).toContain('open your DMs and try again');
  });

  it('shows a network failure as failed, reverts, and does not retry or queue', async () => {
    const setCodeDms = vi.fn(async (): Promise<CodeDmState> => { throw new ReminderApiError('network', 'offline'); });
    const a = api({ setCodeDms });
    const el = buildCodeDmToggle('hsr', a);
    await flush();
    box(el).click();
    await flush();
    expect(box(el).checked).toBe(false);
    expect(msg(el)).toMatch(/failed/i);
    await flush();
    expect(setCodeDms).toHaveBeenCalledTimes(1);
  });

  it('explains 401 and 429', async () => {
    for (const [kind, text] of [['unauthorized', /sign in/i], ['rate-limited', /too many/i]] as const) {
      const el = buildCodeDmToggle('hsr', api({ setCodeDms: async () => { throw new ReminderApiError(kind, 'x'); } }));
      await flush();
      box(el).click();
      await flush();
      expect(box(el).checked).toBe(false);
      expect(msg(el)).toMatch(text);
    }
  });

  it('turning off reverts to on if the write fails', async () => {
    const el = buildCodeDmToggle('genshin', api({ setCodeDms: async () => { throw new ReminderApiError('network', 'offline'); } }));
    await flush();
    box(el).click();
    await flush();
    expect(box(el).checked).toBe(true);
  });

  it('keeps the toggle disabled and says so when the initial read fails', async () => {
    const el = buildCodeDmToggle('hsr', api({ codeDms: async () => { throw new ReminderApiError('network', 'offline'); } }));
    await flush();
    expect(box(el).disabled).toBe(true);
    expect(msg(el)).toMatch(/couldn't/i);
  });
});
