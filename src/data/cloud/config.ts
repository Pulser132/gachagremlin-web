/**
 * Cloud-sync configuration.
 *
 * The OAuth client ID is deliberately a plain constant, not a secret: OAuth
 * client IDs are public by design (they ship in the JS bundle of every
 * client-side Google integration). What protects the user is the consent
 * screen plus the authorized-JavaScript-origin allowlist on the Cloud project,
 * neither of which the ID alone can bypass.
 *
 * Provisioned: Cloud project "Gacha Gremlin", client "Gacha Gremlin Drive Login".
 * Both origins below are registered as *Authorized JavaScript origins* (not
 * redirect URIs — the GIS popup code client exchanges against the reserved
 * `postmessage` redirect, which needs no registration; the redirect list is
 * deliberately empty):
 *   http://localhost:5173      (vite dev)
 *   https://pulser132.github.io (GitHub Pages)
 *
 * The matching *client secret* is never in this repo: it lives only in the
 * Cloudflare Worker (workers/oauth/) that performs the code exchange and
 * token refresh.
 *
 * Origin matching is exact, so http://127.0.0.1:5173 is NOT the registered
 * http://localhost:5173 — use the localhost form Vite prints.
 *
 * Blanking the ID is the supported way to turn cloud sync off (a fork with no
 * project of its own): `isCloudConfigured()` then returns false and no cloud UI
 * renders. Note it only tests for non-empty, so a malformed or whitespace-padded
 * ID still reads as configured and fails later, at Google.
 */

export const GOOGLE_CLIENT_ID =
  "279198206125-431h76al03m2724hi2an0vl62limbc1h.apps.googleusercontent.com";

/** The one Drive scope this app uses: its own hidden appDataFolder, nothing
 * else in the user's Drive. */
export const DRIVE_APPDATA_SCOPE =
  "https://www.googleapis.com/auth/drive.appdata";

/**
 * The Cloudflare Worker (workers/oauth/) that holds the OAuth client secret
 * and performs the authorization-code exchange plus access-token refresh.
 * The DEV branch targets `wrangler dev` so local testing never touches
 * production. Fill in the production URL after `npx wrangler deploy`.
 */
export const OAUTH_WORKER_URL = import.meta.env.DEV
  ? "http://localhost:8787"
  : "https://gachagremlin-oauth.REPLACE-WITH-ACCOUNT.workers.dev";

/** Filename inside appDataFolder. Same name as the manual export, because the
 * contents are the same `BackupFile` payload. */
export const CLOUD_BACKUP_FILENAME = "gachagremlin-backup.json";

/** False until a real client ID and worker URL are set; callers must hide all
 * cloud UI. */
export function isCloudConfigured(): boolean {
  return GOOGLE_CLIENT_ID.length > 0 && OAUTH_WORKER_URL.length > 0;
}
