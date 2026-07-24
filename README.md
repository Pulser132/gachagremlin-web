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

## Reminders

Bell any upcoming or active event (the 🔔 on its card) to track it. When you open the site, a
"starting/ending soon" banner lists your tracked events whose start or end falls within 72 hours,
each with a live countdown. Because there's no backend, these reminders only surface **while the
page is open** — for pings that reach you when the site is closed, the
[Discord bot](https://github.com/Pulser132/GachaGremlin) does the same tracking off the same event
data. Subscriptions live in `localStorage` (and travel in backups, below), keyed by a stable event
identity the bot can share.

## Wish tracker

The **Wishes** tab (next to Events) tracks pity, 50/50 status, and full pull history for
Genshin Wishes, Star Rail Warps, and ZZZ Signal Searches — client-side, same as the events
feature.

**Player flow**, mirroring the same approach several existing wish/warp/signal trackers use:

1. Open the Wish/Warp/Signal History screen in the game on your PC.
2. Click "Import" on the site, copy the one-liner shown for your game (e.g.
   `iwr -useb https://pulser132.github.io/gachagremlin-web/import/genshin.ps1 | iex`), paste it
   into Windows PowerShell, and press Enter.
3. The script (hosted under [`public/import/`](public/import/), served as a static file — read
   it before you run it) finds the history link the game already cached locally, downloads your
   full pull history from HoYoverse's own API, and copies the result (plain JSON) to your
   clipboard — verified reliable through `Set-Clipboard` even for multi-megabyte histories, so
   there's no practical size where paste stops working. It also saves a backup copy to a temp
   file, in case clipboard access itself is restricted in your setup.
4. Paste the clipboard contents into the site's import box and click Import (a "Choose File"
   picker is there too, for the backup file or a UIGF/backup export from another tracker — a
   browser can't read a file from a typed path for security reasons, so it always needs an actual
   file selection, not a pasted path). It's validated, merged with any previously imported pulls
   — deduplicated even across two different import sources for the same pulls, e.g. a backup
   import and the PowerShell script overlapping (`src/data/wishes/dedupe.ts`) — so re-importing
   never loses or duplicates history, and stored in `localStorage`.

**Why a script instead of just pasting a link**, like the reference sites: those sites fetch
your history server-side once you paste an authenticated link. This site has no server, and
HoYoverse's API doesn't send CORS headers, so a browser can't fetch it directly either. Rather
than route your data through a third-party CORS proxy, the hosted scripts do the fetching
themselves and hand back plain JSON — no game credentials, no third parties, nothing leaves
your machine except requests to HoYoverse's own API.

**Already have history exported from another tracker?** The same paste box (and a file picker
next to it) also accepts:

- A [UIGF v4](https://uigf.org/en/standards/uigf.html) export — the community interchange
  format most trackers support, covering all three games. See `src/data/wishes/uigf.ts` for the
  exact field mapping, including the ZZZ rarity remap (its API reports rank as B/A/S rather
  than the 3/4/5-star scale Genshin/HSR use).
- A **Genshin tracker's local-data backup** (a "Local Data" export feature offered by one
  popular community Genshin tracker) — **Genshin only**. This isn't UIGF, it's that tracker's
  own save-data shape: pulls are stored by item slug with no name or rarity of their own, so the
  converter (`src/data/wishes/`) resolves each slug through a bundled lookup table extracted
  from that tracker's own open-source item database, and synthesizes a sortable id since the
  format has no per-pull id either. **Other trackers have their own site-specific backup formats
  too, but importing those (as opposed to a UIGF export) isn't implemented yet** — the import
  dialog says so if you try on the Warps or Signal Searches tab.

GachaGremlin detects which shape you gave it automatically, so there's no format picker: paste
or upload the file and it just works (or tells you clearly why it can't).

See [`Todos/Todo_wish_tracker/goal.md`](Todos/Todo_wish_tracker/goal.md) for the full design
rationale, including exactly how the reference sites' scripts work under the hood.

### The Wish Counter

Once history is imported, each banner (Character Event, Weapon, Standard, …) gets a card showing
lifetime pulls and their premium-currency cost (Primogems / Stellar Jade / Polychromes at 160 per
pull), current 5★ and 4★ pity with a progress "fuse" toward hard pity, the 50/50 → guaranteed
state, and an expandable list of your recent 5★s with the pity each one took. A pulls-per-month
area chart (inline SVG, hover for the exact month) fills out the grid.

Below the cards, the full pull history is a table you can filter by banner and rarity. Each row
gets a hand-drawn category icon (person for Character/Agent, blade for Weapon, clipped-corner
card for Light Cone, hex bolt for W-Engine, robot head for Bangboo — `src/ui/itemIcons.ts`) since
there's no per-item art available to a static site with no asset pipeline. It opens showing your
**latest 100 pulls**, with a 10 / 50 / 100 / All selector so a multi-thousand-pull history doesn't
render all at once.

### Multiple accounts

Each game can hold several UIDs — a main and an alt, say. A dropdown in the Wishes header switches
between them, and you can nickname each one or delete a stored UID (behind a confirmation, since it
drops that account's pulls). Imports always save to the UID **in the imported data**: so if you
import pulls for a different account than the one you're viewing, they land on the correct UID, the
view swaps to it, and a notice explains what happened rather than silently overwriting the account
you were looking at.

Multiple accounts also creates a script-side wrinkle: if you've opened the History screen for more
than one account on the same PC, the game's cache can hold a still-valid link for each of them, and
the earlier scripts silently picked whichever one happened to sort first — which could quietly hand
you the wrong account's history with no indication anything was off. The import scripts now probe
every still-valid cached link, and if more than one distinct account turns up, print all of them and
say which one they picked (the most recently opened) before downloading anything. To target a
specific account instead, pass its UID as a second argument (leave the path blank to keep
auto-detect): `iex "& { $(irm <script-url>) } '' '100000001'"`.

### Backup & restore

"Export all data" writes every account, nickname, reminder, and preference to a single
`gachagremlin-backup.json` file. "Import backup" merges it back in — never overwriting: pulls are
unioned and de-duplicated, so restoring an older backup can't lose newer history. This is the guard
against a cleared browser cache, and deliberately the same payload cloud save moves.

### Cloud save

"Connect Google Drive" automates that guard: the same `gachagremlin-backup.json` payload is kept in
your **own** Google Drive, in the hidden per-app
[`appDataFolder`](https://developers.google.com/workspace/drive/api/guides/appdata) — invisible in
your Drive UI, readable only by this app, via a scope (`drive.appdata`) that can't touch anything
else in your Drive. Still no backend: data moves between your browser and your Drive, nothing else.

Sync runs on page load and (debounced) after any change, plus a manual "Sync now". It's
**pull → merge → push**: cloud data is merged in locally first, then the union is pushed back. Since
the merge unions and de-duplicates, two devices can't clobber each other's pulls — losing a write
race just means the union lands on the next sync. Your UI preferences and which account you're
viewing are *filled in only when absent*, so an unattended sync never reverts a setting you just
picked on this device.

The access token lives in memory only and is never persisted — a client-side flow gets no refresh
token, so it's silently re-requested against your live Google session and you'll see "Reconnect" if
that lapses. Google's script is loaded **lazily**, only once you engage cloud sync: if you never
connect, the site makes zero requests to Google and works fully offline.

Cloud sync is off unless a Google OAuth client ID is configured (`src/data/cloud/config.ts`). This
repo ships with a real one, so the cloud row renders by default. Forking? Blank `GOOGLE_CLIENT_ID`
and no cloud UI appears at all — or point it at your own Cloud project, registering both of your
origins as *Authorized JavaScript origins* (the token client uses a popup, so the redirect-URI list
stays empty) and enabling the Drive API on it.

## Local development

Requires Node 22+.

```bash
npm install
npm run dev       # http://localhost:5173/gachagremlin-web/
npm test           # Vitest: wiki, time-math, cache, wishes, reminders, backup, cloud sync
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
  format-detection dispatcher (native script output vs UIGF vs a tracker's local-data backup).
- `tests/uigfPayload.test.ts` — UIGF v4 export conversion: field mapping per game, multi-account
  files, the ZZZ rank remap, and rejecting pre-v4/malformed/incomplete files.
- The Genshin tracker local-data backup converter has its own suite: slug -> name/rarity
  resolution, synthesized id ordering, rejecting unrecognized items, and the "not supported yet"
  message when this format is used on the HSR/ZZZ tabs.
- `tests/wishStore.test.ts` — localStorage merge/dedupe by id, per-uid and per-game isolation,
  plus multi-account management (list/nickname/delete, active-uid repointing) and the
  backup-restore merge.
- `tests/wishDedupe.test.ts` — the cross-source dedupe in `src/data/wishes/dedupe.ts`: content
  grouping, id-scheme partitioning (real HoYoverse ids vs. synthesized backup ids), keeping only
  the most trustworthy scheme when they describe the same pull, and repair-on-read for accounts
  polluted before the fix.
- `tests/itemIcons.test.ts` — per-category icon selection (character/agent, weapon, light cone,
  W-Engine, bangboo, unknown fallback) and the accessible label text.
- `tests/pity.test.ts` — pity counts and 50/50 guarantee state, including banner-group merging
  (Genshin 301+400).
- `tests/reminders.test.ts` — the stable event key (stable across whitespace/case, distinct per
  game/type/name) and toggling/listing subscriptions.
- `tests/backup.test.ts` — whole-app export/import round-trip through a cleared cache, merge
  de-duplication, reminder union, preference restore, and rejecting non-GachaGremlin or
  wrong-version files (including the typed `UnsupportedBackupVersionError` cloud sync branches on),
  plus the `fill-if-absent` view-state mode sync uses.
- `tests/cloudDrive.test.ts` — the Drive REST edge against a stubbed fetch: find→create vs
  find→update, skipping the lookup when the file id is known, well-formed multipart bodies, and
  every HTTP status → `CloudError` kind mapping.
- `tests/cloudSync.test.ts` — the sync algorithm: cloud data lands locally *before* the upload
  snapshot is taken, push-only skips the download, a newer-schema cloud file aborts without any
  upload, 401 → silent re-auth → retry, debounce collapsing, and destructive-beats-merge when
  requests queue.
- `tests/cloudAuth.test.ts` — token caching/expiry, silent re-request, script-load failure
  rejecting rather than hanging, and a storage dump proving the token is never persisted.
- `tests/cloudFooter.test.ts`, `tests/cloudTriggers.test.ts` — the footer's cloud row across
  configured/connected/error states, and the trigger→mode map per call site (bell off and delete
  must schedule push-only, account switching must schedule nothing).
- `tests/wishesView.test.ts` — the Wishes view (Wish Counter cards, account switcher, the
  import-mismatch notice, the history size selector) and import dialog (paste and file-upload
  paths) against seeded fixtures.
- `tests/eventCard.test.ts` also covers the reminder bell (shown for upcoming/active events,
  toggles the subscription).

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
    reminders.ts         opt-in event-reminder subscriptions (localStorage), stable event key
    backup.ts            whole-app export/restore to one JSON file (merge-based, versioned)
    cloud/
      config.ts           OAuth client id (placeholder = cloud sync off), scope, filename
      gis.d.ts            hand-written ambient types for Google Identity Services
      auth.ts              lazy GIS load; token in memory only, never persisted
      drive.ts              appDataFolder REST: load/save the backup, typed CloudError
      sync.ts                pull -> merge -> push; push-only after a delete; debounce
    wiki/
      games.ts            per-game host/index-page/server-offset config
      client.ts            MediaWiki API fetch (origin=*)
      parser.ts             wikitext -> structured fields
      times.ts               wall-clock -> per-region Unix, global-time handling
      fetch.ts                assembles one event's full details
      wikiSource.ts             EventSource impl: the only one in v1
    wishes/
      banners.ts            per-game banner groups, hard pity, standard-pool 5-star lists
      payload.ts             parseAnyImport: detects which import shape it was given, routes accordingly
      uigf.ts                 converts a UIGF v4 export to our WishPayload shape
      + a Genshin-only converter for one tracker's local-data backup format, with a
        bundled item slug -> {name, rarity} lookup extracted from that tracker's own data
      dedupe.ts                cross-source dedupe: same pull imported under two id schemes
                                 (real API id vs. synthesized backup id) collapses to one
      store.ts                localStorage merge/dedupe by id, per-uid accounts + nicknames,
                                active-uid pointer, list/delete, backup-restore merge
      pity.ts                  pure pity/guarantee math over a sorted item list
  ui/
    app.ts               page shell: tabs, view toggle, region picker, sections, refresh,
                           reminder banner, backup/restore footer
    eventCard.ts           one event's card, with a reminder bell
    wishesView.ts           the Wishes tab: account switcher, "Wish Counter" banner cards,
                             pulls-per-month chart, paginated + filterable history table
    itemIcons.ts             per-category (Character/Weapon/Light Cone/W-Engine/Bangboo) inline
                               SVG glyphs for the history table's Item column
    uidSwitcher.ts           the account (UID) dropdown: switch, rename, guarded delete
    pullChart.ts             inline-SVG pulls-per-month area chart with hover tooltip
    importDialog.ts          the import dialog: instructions, one-liner, paste box + file picker
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

**One exception: cloud sync.** It loads Google's identity script from `accounts.google.com` at
runtime, and MV3's CSP forbids remote code. An extension build would either omit
`src/data/cloud/` (everything else is untouched — sync is additive and nothing depends on it) or
swap `auth.ts` for `chrome.identity`, which is the native way to do OAuth in an extension anyway.
The rest of the MV3 claim above still holds.

## Roadmap / out of scope

In-app reminders (opt-in, page-open only), multiple local accounts per game, and cloud save now
exist — see above. Still out of scope for the site itself: **background** notifications, which
remain the Discord bot's job.

Cloud save's known v1 limits, both fixable with deletion tombstones (a follow-up): a deleted
account only stays deleted if no *other* device still holds it — one that does re-adds it on its
next sync. And there's no Google-account identity check, so on a shared computer, connecting a
second Google account merges both people's data locally. See
[`Todos/Todo_website/goal.md`](https://github.com/Pulser132/GachaGremlin/blob/main/Todos/Todo_website/goal.md)
in the bot repo for the full requirements this was built against.
