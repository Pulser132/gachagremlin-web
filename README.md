# GachaGremlin Web

A static site that shows current and upcoming events for **Genshin Impact**, **Honkai: Star
Rail**, and **Zenless Zone Zero** — live countdowns, rewards, eligibility, and HoYoLAB links —
without needing Discord. It's the sibling site to the
[GachaGremlin Discord bot](https://github.com/Pulser132/GachaGremlin), which tracks the same
events and pings subscribers before they end.

**Live:** https://pulser132.github.io/gachagremlin-web/

## How it works

There is **no backend**. The page fetches the three games' Fandom wikis directly from your
browser via the public MediaWiki API (`origin=*` gets a permissive CORS response — verified,
see `src/data/wiki/client.ts`), parses the wikitext client-side, and caches the parsed result in
`localStorage` for 30 minutes so revisits render instantly without hammering the wikis.

Pick a game, pick your server region (America / Europe / Asia / TW-HK-MO "SAR", Genshin only),
and every event shows a live countdown plus its absolute end time in *your* local timezone.

## Wish tracker

The **Wishes** tab (next to Events) tracks pity, 50/50 status, and full pull history for
Genshin Wishes, Star Rail Warps, and ZZZ Signal Searches — client-side, same as the events
feature.

**Player flow**, mirroring how [paimon.moe](https://paimon.moe/wish/import),
[starrailstation.com](https://starrailstation.com/en/warp#import), and
[stardb.gg](https://stardb.gg/en/zzz/signal-import) do it:

1. Open the Wish/Warp/Signal History screen in the game on your PC.
2. Click "Import" on the site, copy the one-liner shown for your game (e.g.
   `iwr -useb https://pulser132.github.io/gachagremlin-web/import/genshin.ps1 | iex`), paste it
   into Windows PowerShell, and press Enter.
3. The script (hosted under [`public/import/`](public/import/), served as a static file — read
   it before you run it) finds the history link the game already cached locally, downloads your
   full pull history from HoYoverse's own API, and copies the result to your clipboard.
4. Paste the clipboard contents into the site's import box. It's validated, merged with any
   previously imported pulls (so re-importing never loses history that's aged out of the API's
   ~6-month window), and stored in `localStorage`.

**Why a script instead of just pasting a link**, like the reference sites: those sites fetch
your history server-side once you paste an authenticated link. This site has no server, and
HoYoverse's API doesn't send CORS headers, so a browser can't fetch it directly either. Rather
than route your data through a third-party CORS proxy, the hosted scripts do the fetching
themselves and hand back plain JSON — no game credentials, no third parties, nothing leaves
your machine except requests to HoYoverse's own API.

**Already have history exported from paimon.moe, Star Rail Station, or stardb.gg?** The same
paste box (and a file-upload option next to it) also accepts a
[UIGF v4](https://uigf.org/en/standards/uigf.html) export — the community interchange format
those sites and most other trackers support. GachaGremlin detects which shape you gave it
automatically, so there's no format picker: paste or upload either kind of file and it just
works. See `src/data/wishes/uigf.ts` for the exact field mapping, including the ZZZ rarity
remap (its API reports rank as B/A/S rather than the 3/4/5-star scale Genshin/HSR use).

See [`Todos/Todo_wish_tracker/goal.md`](Todos/Todo_wish_tracker/goal.md) for the full design
rationale, including exactly how the reference sites' scripts work under the hood.

## Local development

Requires Node 22+.

```bash
npm install
npm run dev       # http://localhost:5173/gachagremlin-web/
npm test           # Vitest: wiki parser + time-math + cache tests
npm run build       # type-check + production build to dist/
npm run preview     # serve the production build locally
```

Two extra scripts:

```bash
npx tsx scripts/smoke.ts        # live check: fetches one real event per game
```

## Testing

`npm test` runs against saved wiki fixtures (`tests/fixtures/`, copied from the bot repo) and
synthetic wish-history fixtures (`tests/fixtures/wishes/`) rather than live network calls, so CI
doesn't depend on Fandom's or HoYoverse's uptime:

- `tests/parser.test.ts`, `tests/times.test.ts` — wikitext parsing and per-region time math,
  ported line-for-line from the bot's own test suite (same expected Unix timestamps).
- `tests/cache.test.ts` — the localStorage TTL cache: fresh hits, expiry, stale-on-error
  fallback, force-refresh.
- `tests/eventCard.test.ts`, `tests/format.test.ts` — region-time resolution and countdown
  formatting.
- `tests/wishPayload.test.ts` — import payload validation (accept/reject cases) and the
  native-vs-UIGF format dispatcher.
- `tests/uigfPayload.test.ts` — UIGF v4 export conversion: field mapping per game, multi-account
  files, the ZZZ rank remap, and rejecting pre-v4/malformed/incomplete files.
- `tests/wishStore.test.ts` — localStorage merge/dedupe by id, per-uid and per-game isolation.
- `tests/pity.test.ts` — pity counts and 50/50 guarantee state, including banner-group merging
  (Genshin 301+400, HSR 21+22 collab).
- `tests/wishesView.test.ts` — the Wishes view and import dialog (paste and file-upload paths)
  against seeded fixtures.

The three PowerShell import scripts (`public/import/*.ps1`) aren't exercised by `npm test` —
there's no game installed in CI to generate real cache data. They're syntax-checked via
PowerShell's own parser instead; verifying them end-to-end needs a Windows machine with at
least one of the games installed and its history screen opened once.

## Deployment

Every push to `main` runs the test suite, builds, and deploys to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (the official
`actions/deploy-pages` flow). No manual steps once the workflow is in place.

## Architecture

```
src/
  types.ts             GameKey, Region, EventStatus, EventInfo, GameEvents,
                         WishItem, WishPayload, WishAccount
  data/
    source.ts           EventSource interface
    cache.ts             localStorage TTL cache, wraps any EventSource
    wiki/
      games.ts            per-game host/index-page/server-offset config
      client.ts            MediaWiki API fetch (origin=*)
      parser.ts             wikitext -> structured fields
      times.ts               wall-clock -> per-region Unix, global-time handling
      fetch.ts                assembles one event's full details
      wikiSource.ts             EventSource impl: the only one in v1
    wishes/
      banners.ts            per-game banner groups, hard pity, standard-pool 5-star lists
      payload.ts             parseAnyImport: detects native vs UIGF, parsePayload validates ours
      uigf.ts                 parseUigfPayload: converts a UIGF v4 export to our WishPayload shape
      store.ts                localStorage merge/dedupe by id, active-uid pointer
      pity.ts                  pure pity/guarantee math over a sorted item list
  ui/
    app.ts               page shell: tabs, view toggle, region picker, sections, refresh
    eventCard.ts           one event's card
    wishesView.ts           the Wishes tab: pity cards, filterable history table
    importDialog.ts          the import dialog: instructions, one-liner, paste box
    countdown.ts             shared 1s ticker for all countdowns
    format.ts                 countdown + absolute-time formatting
  styles.css            responsive, dark/light via prefers-color-scheme
public/
  import/               genshin.ps1, hsr.ps1, zzz.ps1 — served as static files, see below
```

Most of `src/data/wiki/` is a straight TypeScript port of the bot's own wiki layer
(`src/gachagremlin/wiki/*.py` in the bot repo) — same parsing rules, same per-region time math,
same edge cases (version-gated starts, global-time events, missing data). See that repo's
`docs/architecture.md` for the underlying wall-clock model if you're debugging a wrong time.

### The `EventSource` interface

```ts
interface EventSource {
  fetchEvents(game: GameKey): Promise<GameEvents>;
}
```

`WikiSource` (fetches Fandom directly) is the only implementation today. It's designed so a
future `BotApiSource` — reading the Discord bot's already-polled cache over HTTP instead of
re-fetching the wikis — can be dropped in later without touching any UI code.

### Chrome extension compatibility

The whole site is a static bundle with no server assumptions, no `eval`, and everything reached
via `fetch` — that's intentionally Manifest V3-safe, so this codebase (particularly
`src/data/` and `src/ui/`) should port into an extension's popup with minimal changes when that
becomes a priority.

## Out of scope (v1)

No reminders, notifications, or accounts — that's the Discord bot's job. See
[`Todos/Todo_website/goal.md`](https://github.com/Pulser132/GachaGremlin/blob/main/Todos/Todo_website/goal.md)
in the bot repo for the full requirements this was built against.
