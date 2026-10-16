// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeliverableHint } from '../src/data/deliverableHint.ts';
import { renderDeliverableHint } from '../src/ui/deliverableHint.ts';
import { ReminderApiError } from '../src/data/reminderApi.ts';

const api = (deliverable: boolean) => ({ me: vi.fn(async () => ({ id: 'u1', deliverable })) });

beforeEach(() => localStorage.clear());

describe('createDeliverableHint', () => {
  it('shows the hint when /v1/me says deliverable is false', async () => {
    const h = createDeliverableHint(api(false), () => 'u1');
    await h.check();
    expect(h.visible()).toBe(true);
  });

  it('shows nothing when deliverable is true', async () => {
    const h = createDeliverableHint(api(true), () => 'u1');
    await h.check();
    expect(h.visible()).toBe(false);
  });

  it('treats a failed /v1/me as no hint, not an error', async () => {
    const h = createDeliverableHint({ me: vi.fn(async () => { throw new ReminderApiError('network', 'x'); }) }, () => 'u1');
    await expect(h.check()).resolves.toBeUndefined();
    expect(h.visible()).toBe(false);
  });

  it('stays dismissed for that user across reloads, but not for another user', async () => {
    const h = createDeliverableHint(api(false), () => 'u1');
    await h.check();
    h.dismiss();
    expect(h.visible()).toBe(false);
    const again = createDeliverableHint(api(false), () => 'u1');
    await again.check();
    expect(again.visible()).toBe(false);
    const other = createDeliverableHint(api(false), () => 'u2');
    await other.check();
    expect(other.visible()).toBe(true);
  });

  it('hides when signed out and notifies subscribers on change', async () => {
    let user: string | null = 'u1';
    const h = createDeliverableHint(api(false), () => user);
    const fn = vi.fn();
    h.subscribe(fn);
    await h.check();
    expect(fn).toHaveBeenCalled();
    user = null;
    expect(h.visible()).toBe(false);
  });

  it('forgets a stale answer when a later check says deliverable', async () => {
    let ok = false;
    const h = createDeliverableHint({ me: async () => ({ id: 'u1', deliverable: ok }) }, () => 'u1');
    await h.check();
    ok = true;
    await h.check();
    expect(h.visible()).toBe(false);
  });
});

describe('renderDeliverableHint', () => {
  it('explains the shared-server requirement, links to join, and is dismissible', () => {
    const onDismiss = vi.fn();
    const el = renderDeliverableHint('https://discord.gg/abc', onDismiss);
    expect(el.textContent).toContain('share a server');
    expect(el.classList.contains('error')).toBe(false);
    const a = el.querySelector('a')!;
    expect(a.href).toBe('https://discord.gg/abc');
    expect(a.rel).toContain('noopener');
    (el.querySelector('button') as HTMLButtonElement).click();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('omits the link when no invite is configured', () => {
    const el = renderDeliverableHint('', () => {});
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('share a server');
  });
});
