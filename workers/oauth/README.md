# gachagremlin-oauth

Tiny stateless Cloudflare Worker that holds the Google OAuth **client secret**
and performs the authorization-code exchange / access-token refresh for cloud
sync. Free tier is far more than enough (a couple of requests per user per
hour of active use).

## One-time setup

1. Google Cloud Console → APIs & Services → Credentials → open the
   "Gacha Gremlin Drive Login" web client → copy the **Client secret**.
   Do **not** add any redirect URI — the popup code flow uses the reserved
   `postmessage` redirect, which needs no registration.
2. Make sure the OAuth consent screen is **In production** (not Testing) —
   Testing-status refresh tokens expire after 7 days.
3. Deploy:

   ```sh
   cd workers/oauth
   npx wrangler login                          # once
   npx wrangler secret put GOOGLE_CLIENT_SECRET  # paste the secret
   npx wrangler deploy                         # prints the workers.dev URL
   ```

4. Paste the printed `https://gachagremlin-oauth.<account>.workers.dev` URL
   into `OAUTH_WORKER_URL` in `src/data/cloud/config.ts`.

## Local development

Create a git-ignored `.dev.vars` file in this directory:

```
GOOGLE_CLIENT_SECRET=...
```

Then `npx wrangler dev` (serves on http://localhost:8787, which is what the
app's dev build targets). Smoke test:

```sh
curl -X POST http://localhost:8787/refresh \
  -H "Origin: http://localhost:5173" -H "Content-Type: application/json" \
  -d '{"refresh_token":"bogus"}'
# → 401 {"error":"invalid_grant",...}  proves the exchange path works
```
