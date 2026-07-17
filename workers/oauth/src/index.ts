/**
 * OAuth token exchange for GachaGremlin cloud sync.
 *
 * The app is a static site, so it cannot hold the Google OAuth client secret.
 * This Worker is the one confidential piece: it exchanges an authorization
 * code (from the GIS popup code client) for tokens, and refreshes access
 * tokens later. It is stateless — refresh tokens live only in the user's
 * browser, never here.
 *
 * Endpoints (POST, JSON):
 *   /token    {code}          → {access_token, refresh_token, expires_in}
 *   /refresh  {refresh_token} → {access_token, expires_in}
 *
 * Google's `invalid_grant` (revoked or expired refresh token) is mapped to
 * 401 so the client can treat it as "auth is dead, ask the user to reconnect"
 * without parsing Google's error vocabulary.
 */

interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Only the app's own origins may use this Worker. Everything else gets 403 —
 * without a matching Access-Control-Allow-Origin a browser page couldn't read
 * the response anyway, but refusing outright also keeps non-browser callers
 * from using the Worker as an open token-exchange proxy. */
const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'https://pulser132.github.io']);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
      return new Response('Forbidden', { status: 403 });
    }
    const cors: Record<string, string> = {
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: cors });
    }

    const path = new URL(request.url).pathname;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    let params: URLSearchParams;
    if (path === '/token' && typeof body?.code === 'string') {
      params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: body.code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        // GIS popup-mode code clients are issued against the reserved
        // 'postmessage' redirect; the exchange must name the same one.
        redirect_uri: 'postmessage',
      });
    } else if (path === '/refresh' && typeof body?.refresh_token === 'string') {
      params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: body.refresh_token,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
      });
    } else {
      return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400, headers: cors });
    }

    const upstream = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;

    // Whitelist fields both ways; never proxy Google's raw envelope through.
    const out = upstream.ok
      ? { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in }
      : { error: data.error, error_description: data.error_description };
    const status = upstream.ok ? 200 : data.error === 'invalid_grant' ? 401 : upstream.status;
    return new Response(JSON.stringify(out), { status, headers: cors });
  },
};
