// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createCodeDms } from '../src/data/codeDms.ts';
import { renderCodeDmToggle } from '../src/ui/codeDmToggle.ts';
import { ReminderApiError, type CodeDmState } from '../src/data/reminderApi.ts';
import dms from './fixtures/codes/code-dms.json';
import dmsHsrOn from './fixtures/codes/code-dms-hsr-on.json';

const api = (over: Record<string, unknown> = {}) => ({
  codeDms: vi.fn(async () => dms as CodeDmState),
  setCodeDms: vi.fn(async (_c: Partial<CodeDmState>) => dmsHsrOn as CodeDmState),
  ...over,
});
const fails = (kind: ConstructorParameters<typeof ReminderApiError>[0]) => async (): Promise<CodeDmState> => {
  throw new ReminderApiError(kind, 'x');
};

describe('createCodeDms', () => {
  it('adopts the server state on load', async () => {
    const c = createCodeDms(api());
    await c.load();
    expect(c.getState()).toEqual({ dms, busy: false, error: null });
  });

  it('sends a partial PUT and adopts the returned full state', async () => {
    const a = api();
    const c = createCodeDms(a);
    await c.load();
    await c.set('hsr', true);
    expect(a.setCodeDms).toHaveBeenCalledWith({ hsr: true });
    expect(c.getState().dms).toEqual(dmsHsrOn);
  });

  it('keeps the old state and records the kind when a write fails, with no retry', async () => {
    const a = api({ setCodeDms: vi.fn(fails('dms_closed')) });
    const c = createCodeDms(a);
    await c.load();
    await c.set('hsr', true);
    expect(c.getState().dms).toEqual(dms);
    expect(c.getState().error).toEqual({ op: 'write', kind: 'dms_closed' });
    expect(a.setCodeDms).toHaveBeenCalledTimes(1);
  });

  it('maps a non-API throw to other, and a failed read to op read', async () => {
    const c = createCodeDms(api({ codeDms: async () => { throw new TypeError('boom'); } }));
    await c.load();
    expect(c.getState()).toMatchObject({ dms: null, error: { op: 'read', kind: 'other' } });
  });

  it('ignores a call while one is in flight', async () => {
    const a = api();
    const c = createCodeDms(a);
    const first = c.load();
    await c.set('hsr', true);
    await first;
    expect(a.setCodeDms).not.toHaveBeenCalled();
  });

  it('notifies subscribers until they unsubscribe', async () => {
    const c = createCodeDms(api());
    const fn = vi.fn();
    const off = c.subscribe(fn);
    await c.load();
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    await c.load();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('renderCodeDmToggle', () => {
  const box = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input')!;
  const note = (el: HTMLElement) => el.querySelector('[role=status]')!.textContent;
  const ready = { dms: dms as CodeDmState, busy: false, error: null };

  it('reflects the current game and is disabled until loaded or while busy', () => {
    expect(box(renderCodeDmToggle('genshin', ready, () => {})).checked).toBe(true);
    expect(box(renderCodeDmToggle('hsr', ready, () => {})).checked).toBe(false);
    expect(box(renderCodeDmToggle('hsr', { ...ready, dms: null }, () => {})).disabled).toBe(true);
    expect(box(renderCodeDmToggle('hsr', { ...ready, busy: true }, () => {})).disabled).toBe(true);
  });

  it('passes the wanted value to onToggle', () => {
    const onToggle = vi.fn();
    const el = renderCodeDmToggle('hsr', ready, onToggle);
    document.body.appendChild(el);
    box(el).click();
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it.each([
    ['dms_closed', 'write', /open your DMs and try again/],
    ['network', 'write', /failed/],
    ['unauthorized', 'write', /sign in/i],
    ['rate-limited', 'write', /too many/i],
    ['network', 'read', /couldn't load/i],
  ] as const)('explains %s on %s', (kind, op, text) => {
    expect(note(renderCodeDmToggle('hsr', { ...ready, error: { op, kind } }, () => {}))).toMatch(text);
  });

  it('shows the unchanged (off) state after a failed write', () => {
    const el = renderCodeDmToggle('hsr', { ...ready, error: { op: 'write', kind: 'dms_closed' } }, () => {});
    expect(box(el).checked).toBe(false);
  });
});
