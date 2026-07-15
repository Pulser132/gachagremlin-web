/**
 * Google Drive appDataFolder access — the network edge of cloud sync.
 *
 * Deliberately narrow: the rest of the app only ever asks to "load the cloud
 * backup" or "save the cloud backup". Drive's concepts (file ids, multipart
 * bodies, upload endpoints, query syntax) stop here, so swapping in another
 * provider later means writing a sibling module, not touching sync.ts.
 *
 * Raw `fetch` rather than Google's JS client library, matching the repo's
 * no-runtime-dependency constraint — these four requests are all we need.
 *
 * `fetchImpl` is injected via a default parameter, the same convention the
 * repo already uses for clocks (`now: () => number = Date.now`), so tests can
 * pass a stub without any global mocking machinery.
 */
import { CLOUD_BACKUP_FILENAME } from './config.ts';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

export type CloudErrorKind =
  /** Token missing, expired, or rejected — the caller may re-auth and retry once. */
  | 'unauthorized'
  /** Drive quota / too many requests — back off and try later. */
  | 'rate-limited'
  /** The request never completed (offline, DNS, blocked). */
  | 'network'
  /** Anything else, including malformed responses. */
  | 'other';

export class CloudError extends Error {
  readonly kind: CloudErrorKind;
  readonly status?: number;
  constructor(kind: CloudErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'CloudError';
    this.kind = kind;
    this.status = status;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Shape of a Drive API error body (the parts we care about). */
interface DriveErrorBody {
  error?: {
    message?: string;
    errors?: { reason?: string }[];
  };
}

/** The 403 reasons that genuinely mean "back off and retry later". Every
 * other 403 is a configuration problem that retrying will never fix. */
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded']);

/**
 * Maps a non-OK response onto a typed error.
 *
 * HTTP status alone is not enough for 403: Drive returns it both for quota
 * exhaustion AND for "the Drive API isn't enabled on this project" — opposite
 * fixes, and the latter is by far the likelier one when someone first wires up
 * their own OAuth client. Treating every 403 as rate-limiting told those users
 * to "try again in a few minutes", which would never work. So we read Google's
 * machine-readable `reason` and only claim rate-limiting when it says so;
 * anything else falls through to `other`, which surfaces Google's own message —
 * for a disabled API that text names the project and links the enable page.
 */
async function errorFor(response: Response): Promise<CloudError> {
  let raw = '';
  let body: DriveErrorBody | null = null;
  try {
    raw = await response.text();
    body = JSON.parse(raw) as DriveErrorBody;
  } catch {
    // non-JSON or unreadable body — the status still tells us something
  }

  // Google's own `error.message` is more useful than the raw envelope.
  const detail = (body?.error?.message ?? raw).slice(0, 300);
  const message = `Drive request failed (${response.status})${detail ? `: ${detail}` : ''}`;
  const reason = body?.error?.errors?.[0]?.reason ?? '';

  if (response.status === 401) return new CloudError('unauthorized', message, response.status);
  if (response.status === 429) return new CloudError('rate-limited', message, response.status);
  if (response.status === 403 && RATE_LIMIT_REASONS.has(reason)) {
    return new CloudError('rate-limited', message, response.status);
  }
  return new CloudError('other', message, response.status);
}

/** Wraps fetch so a thrown request (offline, blocked) becomes a typed
 * `network` error rather than a raw TypeError leaking upward. */
async function request(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (e) {
    throw new CloudError('network', `Could not reach Google Drive: ${(e as Error).message}`);
  }
  if (!response.ok) throw await errorFor(response);
  return response;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

interface DriveFileRef {
  id: string;
  modifiedTime?: string;
}

/** Finds our backup file in appDataFolder, or null on a first-ever sync. */
async function findFile(token: string, fetchImpl: FetchLike): Promise<DriveFileRef | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name='${CLOUD_BACKUP_FILENAME}' and trashed=false`,
    fields: 'files(id,modifiedTime)',
    pageSize: '1',
  });
  const response = await request(fetchImpl, `${DRIVE_FILES_URL}?${params}`, { headers: authHeaders(token) });
  let body: { files?: DriveFileRef[] };
  try {
    body = (await response.json()) as { files?: DriveFileRef[] };
  } catch (e) {
    throw new CloudError('other', `Drive returned an unreadable file list: ${(e as Error).message}`);
  }
  return body.files?.[0] ?? null;
}

export interface CloudBackupHit {
  /** The parsed file contents. Opaque here — sync.ts hands it straight to
   * importBackup, which owns validation. */
  data: unknown;
  fileId: string;
  modifiedTime?: string;
}

/**
 * Loads the cloud backup, or null when none exists yet.
 * @param fetchImpl injectable for tests; defaults to the real fetch.
 */
export async function loadCloudBackup(token: string, fetchImpl: FetchLike = fetch): Promise<CloudBackupHit | null> {
  const file = await findFile(token, fetchImpl);
  if (!file) return null;

  const response = await request(fetchImpl, `${DRIVE_FILES_URL}/${file.id}?alt=media`, { headers: authHeaders(token) });
  let data: unknown;
  try {
    data = await response.json();
  } catch (e) {
    // A corrupt/truncated cloud file must not read as "no backup" — that would
    // silently overwrite it on the next push. Surface it instead.
    throw new CloudError('other', `Cloud backup is not readable JSON: ${(e as Error).message}`);
  }
  return { data, fileId: file.id, modifiedTime: file.modifiedTime };
}

/** Builds the multipart/related body Drive wants for a create-with-metadata. */
function multipartBody(metadata: unknown, content: string, boundary: string): string {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/**
 * Writes the backup to appDataFolder, creating it on first use and updating it
 * after. Returns the file id, which the caller can pass back as
 * `knownFileId` to skip the lookup next time.
 *
 * @param knownFileId skips the find when the caller already located the file
 *   (the merge path learns it from loadCloudBackup). The push-only path has no
 *   id, so it looks the file up first — otherwise it would create a duplicate.
 * @param fetchImpl injectable for tests; defaults to the real fetch.
 */
export async function saveCloudBackup(
  token: string,
  content: unknown,
  knownFileId?: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const json = JSON.stringify(content);
  const fileId = knownFileId ?? (await findFile(token, fetchImpl))?.id;

  if (fileId) {
    await request(fetchImpl, `${DRIVE_UPLOAD_URL}/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json; charset=UTF-8' },
      body: json,
    });
    return fileId;
  }

  const boundary = `gachagremlin-${Math.random().toString(36).slice(2)}`;
  const metadata = { name: CLOUD_BACKUP_FILENAME, parents: ['appDataFolder'] };
  const response = await request(fetchImpl, `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody(metadata, json, boundary),
  });

  let created: { id?: string };
  try {
    created = (await response.json()) as { id?: string };
  } catch (e) {
    throw new CloudError('other', `Drive did not return a file id: ${(e as Error).message}`);
  }
  if (!created.id) throw new CloudError('other', 'Drive did not return a file id for the new backup.');
  return created.id;
}
