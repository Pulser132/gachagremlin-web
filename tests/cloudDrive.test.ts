import { describe, expect, it, vi } from 'vitest';
import { CloudError, loadCloudBackup, saveCloudBackup, type FetchLike } from '../src/data/cloud/drive.ts';

/** Minimal Response stand-in — enough for the drive module's json()/text()/ok
 * usage, without pulling in a fetch polyfill. */
function res(body: unknown, init: { status?: number; ok?: boolean } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

/** A fetch stub that answers calls in order and records what it was asked. */
function fakeFetch(responses: (Response | Error)[]): { impl: FetchLike; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses[i++];
    if (next === undefined) throw new Error(`unexpected fetch call #${i}: ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return { impl, calls };
}

const TOKEN = 'test-token';

describe('loadCloudBackup', () => {
  it('returns null when no backup exists yet (first-ever sync)', async () => {
    const { impl, calls } = fakeFetch([res({ files: [] })]);
    expect(await loadCloudBackup(TOKEN, impl)).toBeNull();
    expect(calls).toHaveLength(1); // find only, no download
    expect(calls[0].url).toContain('spaces=appDataFolder');
  });

  it('finds then downloads, returning the parsed data and file id', async () => {
    const payload = { app: 'gachagremlin', schemaVersion: 1 };
    const { impl, calls } = fakeFetch([res({ files: [{ id: 'file-1', modifiedTime: '2026-07-14T00:00:00Z' }] }), res(payload)]);

    const hit = await loadCloudBackup(TOKEN, impl);
    expect(hit).toEqual({ data: payload, fileId: 'file-1', modifiedTime: '2026-07-14T00:00:00Z' });
    expect(calls[1].url).toBe('https://www.googleapis.com/drive/v3/files/file-1?alt=media');
  });

  it('sends the bearer token on every request', async () => {
    const { impl, calls } = fakeFetch([res({ files: [{ id: 'f' }] }), res({})]);
    await loadCloudBackup(TOKEN, impl);
    for (const call of calls) {
      expect((call.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it('raises rather than reporting "no backup" when the cloud file is corrupt', async () => {
    // Reporting null here would make the next push silently overwrite a file
    // that may hold real data we simply failed to parse.
    const bad = { ...res({}), json: async () => JSON.parse('{{{') } as Response;
    const { impl } = fakeFetch([res({ files: [{ id: 'f' }] }), bad]);
    await expect(loadCloudBackup(TOKEN, impl)).rejects.toMatchObject({ kind: 'other' });
  });
});

describe('saveCloudBackup', () => {
  it('finds then creates via multipart when no file exists', async () => {
    const { impl, calls } = fakeFetch([res({ files: [] }), res({ id: 'new-file' })]);

    expect(await saveCloudBackup(TOKEN, { hello: 'world' }, undefined, impl)).toBe('new-file');
    expect(calls).toHaveLength(2);

    const create = calls[1];
    expect(create.url).toContain('uploadType=multipart');
    expect(create.init?.method).toBe('POST');

    const contentType = (create.init?.headers as Record<string, string>)['Content-Type'];
    expect(contentType).toMatch(/^multipart\/related; boundary=/);

    // Body must be well-formed multipart carrying both the metadata part
    // (targeting appDataFolder) and the payload part.
    const boundary = contentType.split('boundary=')[1];
    const body = create.init?.body as string;
    expect(body.startsWith(`--${boundary}\r\n`)).toBe(true);
    expect(body.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
    expect(body).toContain('"parents":["appDataFolder"]');
    expect(body).toContain('"name":"gachagremlin-backup.json"');
    expect(body).toContain('{"hello":"world"}');
  });

  it('finds then updates via media PATCH when a file already exists', async () => {
    const { impl, calls } = fakeFetch([res({ files: [{ id: 'file-1' }] }), res({})]);

    expect(await saveCloudBackup(TOKEN, { a: 1 }, undefined, impl)).toBe('file-1');
    expect(calls[1].url).toBe('https://www.googleapis.com/upload/drive/v3/files/file-1?uploadType=media');
    expect(calls[1].init?.method).toBe('PATCH');
    expect(calls[1].init?.body).toBe('{"a":1}');
  });

  it('skips the find when the caller already knows the file id', async () => {
    const { impl, calls } = fakeFetch([res({})]);

    expect(await saveCloudBackup(TOKEN, { a: 1 }, 'known-id', impl)).toBe('known-id');
    expect(calls).toHaveLength(1); // straight to the PATCH
    expect(calls[0].url).toContain('/files/known-id?uploadType=media');
  });

  it('fails loudly if a create returns no file id', async () => {
    const { impl } = fakeFetch([res({ files: [] }), res({})]);
    await expect(saveCloudBackup(TOKEN, {}, undefined, impl)).rejects.toMatchObject({ kind: 'other' });
  });
});

describe('error mapping', () => {
  /** A Drive API error envelope, as Google actually returns it. */
  const driveError = (code: number, reason: string, message: string) => ({
    error: { code, message, errors: [{ reason, message }] },
  });

  it.each([
    [401, 'unauthorized'],
    [429, 'rate-limited'],
    [500, 'other'],
    [404, 'other'],
  ])('maps HTTP %i to a %s CloudError', async (status, kind) => {
    const { impl } = fakeFetch([res('boom', { status })]);
    const error = await loadCloudBackup(TOKEN, impl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudError);
    expect((error as CloudError).kind).toBe(kind);
    expect((error as CloudError).status).toBe(status);
  });

  it.each(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded'])(
    'maps a 403 with reason %s to rate-limited',
    async (reason) => {
      const { impl } = fakeFetch([res(driveError(403, reason, 'Rate Limit Exceeded'), { status: 403 })]);
      const error = await loadCloudBackup(TOKEN, impl).catch((e: unknown) => e);
      expect((error as CloudError).kind).toBe('rate-limited');
    },
  );

  // 403 is ambiguous: it covers quota AND "you never enabled the Drive API",
  // which is the likelier one when someone first wires up their own OAuth
  // client. Calling that rate-limiting would tell them to wait for a problem
  // that waiting cannot fix.
  it('does NOT call a disabled Drive API rate-limiting, and surfaces Google’s own fix', async () => {
    const googleText =
      'Google Drive API has not been used in project 279198206125 before or it is disabled. ' +
      'Enable it by visiting https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=279198206125 then retry.';
    const { impl } = fakeFetch([res(driveError(403, 'accessNotConfigured', googleText), { status: 403 })]);

    const error = (await loadCloudBackup(TOKEN, impl).catch((e: unknown) => e)) as CloudError;
    expect(error.kind).not.toBe('rate-limited');
    expect(error.kind).toBe('other');
    // The message must carry the actionable part through to the user.
    expect(error.message).toContain('has not been used in project');
    expect(error.message).toContain('console.developers.google.com');
  });

  it('maps a 403 with no parseable body to other rather than guessing rate-limited', async () => {
    const { impl } = fakeFetch([res('<html>Forbidden</html>', { status: 403 })]);
    const error = await loadCloudBackup(TOKEN, impl).catch((e: unknown) => e);
    expect((error as CloudError).kind).toBe('other');
  });

  it('maps a thrown request (offline/blocked) to a network CloudError', async () => {
    const { impl } = fakeFetch([new TypeError('Failed to fetch')]);
    const error = await loadCloudBackup(TOKEN, impl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudError);
    expect((error as CloudError).kind).toBe('network');
  });

  it('defaults to the real fetch when none is injected', async () => {
    // Guards the default-parameter wiring: no injection means global fetch.
    const spy = vi.fn(async () => res({ files: [] }));
    vi.stubGlobal('fetch', spy);
    await loadCloudBackup(TOKEN);
    expect(spy).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
