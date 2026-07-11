# Goal: Wish / Warp / Signal Tracker

Add a gacha pull tracker to GachaGremlin Web for all three supported games:

- **Genshin Impact** — Wishes
- **Honkai: Star Rail** — Warps
- **Zenless Zone Zero** — Signal Searches

Players import their pull history by running a PowerShell one-liner (hosted by this
site) while their in-game pull history is on screen, then pasting the result into the
site. The site shows pity counters, guarantee status, and a browsable pull history —
the same experience as paimon.moe, starrailstation.com, and stardb.gg, but fully
client-side.

## Background

### Reference sites and their import flow

| Game | Reference | Import page |
| --- | --- | --- |
| Genshin | paimon.moe | https://paimon.moe/wish/import |
| HSR | Star Rail Station | https://starrailstation.com/en/warp#import |
| ZZZ | stardb.gg | https://stardb.gg/en/zzz/signal-import |

All three use the same mechanism. The player opens the pull-history screen in game
(this makes the game's embedded webview cache an **authenticated API URL** containing a
short-lived `authkey`). The site shows a PowerShell one-liner such as
`iwr -useb stardb.gg/signal | iex` that downloads and runs a hosted script. The script:

1. **Finds the game install path** by parsing the Unity player log under
   `%USERPROFILE%\AppData\LocalLow\`:
   - Genshin: `miHoYo\Genshin Impact\output_log.txt` — regex for a path containing
     `GenshinImpact_Data` (global) / `YuanShen_Data` (CN)
   - HSR: `Cognosphere\Star Rail\Player.log` — line `Loading player data from ...`;
     fallback `Player-prev.log`
   - ZZZ: `miHoYo\ZenlessZoneZero\Player.log` — line prefix
     `[Subsystems] Discovering subsystems at path `, strip trailing `/UnitySubsystems`;
     fallback `Player-prev.log`
2. **Reads the webview cache**: picks the highest-version folder under
   `<game>/webCaches/` and reads `Cache/Cache_Data/data_2` (a Chromium simple-cache
   file). The file is locked while the game runs, so it is copied to a temp file first.
3. **Extracts candidate URLs**: splits the raw cache text on `1/0/`, keeps segments
   that start with `http` and contain `getGachaLog` (HSR also `getLdGachaLog`; the
   Genshin script matches `webview_gacha` segments with `game_biz=`), and pulls the URL
   out with the regex `https?://[^\x00-\x20\x7F-\xFF]+`.
4. **Verifies**: normalizes each candidate (truncate after `&end_id=` and append
   `end_id=0`), sorts by the URL's `timestamp` param descending, and GETs each until
   one returns JSON with `retcode == 0`.
5. **Outputs**: copies the working URL to the clipboard with `Set-Clipboard`; the
   player pastes it into the site.

### Why we diverge in one step

The reference sites take the pasted authkey URL and fetch the pull history **on their
servers**. This site is a static GitHub Pages deployment with no backend, and the
HoYoverse gacha API sends no CORS headers, so the browser cannot fetch that URL itself.
Third-party CORS proxies were considered and rejected (the authkey would transit an
untrusted party, and proxies break without notice).

**Resolution**: our hosted scripts do the fetching themselves. After step 4 above, the
script pages through every banner type of the gacha API (page `size=20`, `end_id`
cursor set to the last item's `id`, short sleep between requests to respect rate
limits) and copies a **compact JSON payload** to the clipboard instead of the bare URL.
The player-visible flow is identical to the reference sites: run one-liner → paste
clipboard into site.

### Gacha API details (global servers)

> Verify all endpoints, hosts, and banner-type IDs against the real cached URLs during
> implementation — they change occasionally and new banner types get added.

- **Genshin**: `https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog`
  - `gacha_type`: 100 novice, 200 standard, 301 character event (items inside may
    report `gacha_type` 400 for the second concurrent character banner), 302 weapon,
    500 chronicled
- **HSR**: `https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getGachaLog`
  - `gacha_type`: 1 stellar (standard), 2 departure (novice), 11 character event,
    12 light cone; collab banners (21 character, 22 light cone) are served by the
    sibling endpoint `getLdGachaLog`
- **ZZZ**: `https://public-operation-nap-sg.hoyoverse.com/common/gacha_record/api/getGachaLog`
  - `real_gacha_type`: 1 standard, 2 exclusive (limited agent), 3 w-engine, 5 bangboo

Common query params: `authkey`, `authkey_ver`, `sign_type`, `game_biz`, `lang`,
`size`, `gacha_type` (or `real_gacha_type`), `end_id`. Each item in `data.list` has a
unique, monotonically increasing `id` plus `uid`, `name`, `item_type`, `rank_type`,
`time`, and the banner type. The `authkey` expires roughly a day after the history
screen was opened, and reopening the screen refreshes it.

## Player flow (what we're building)

1. Player opens the wish/warp/signal history screen in the game on PC.
2. On the site's new **Wishes** area, player picks their game and copies the one-liner,
   e.g. `iwr -useb https://pulser132.github.io/gachagremlin-web/import/genshin.ps1 | iex`
3. Player runs it in Windows PowerShell. The script finds the authkey URL, fetches the
   full history from every banner, prints progress, and copies a JSON payload to the
   clipboard.
4. Player pastes the payload into the site's import box. The site validates it, merges
   it with any previously imported pulls (dedupe by item `id`), and stores it in
   localStorage.
5. The site renders per-banner pity counters and the pull history.

## Requirements

### 1. PowerShell extractor scripts (`public/import/`)

Three scripts served by GitHub Pages (Vite copies `public/` into the site root, so
they resolve to `https://pulser132.github.io/gachagremlin-web/import/<game>.ps1`):

- `genshin.ps1`, `hsr.ps1`, `zzz.ps1`
- Modeled directly on the reference scripts (log parsing → newest
  `webCaches/<version>/Cache/Cache_Data/data_2` → temp copy → `1/0/` split →
  URL regex → `retcode == 0` verification, newest `timestamp` first)
- Then fetch all pages of all banner types for that game and
  `Set-Clipboard` a compact JSON payload:
  `{ "game": "...", "uid": "...", "exportedAt": ..., "items": [...] }`
- Accept an optional game-path argument like the ZZZ reference script (for players
  whose logs don't reveal the install path)
- Friendly, actionable error messages for the known failure modes: game never run /
  log missing, history screen not opened yet (no cached URL), expired authkey
  (`retcode != 0` on every candidate), cache file unreadable
- Plainly written and commented — players are told to pipe these into `iex`, so the
  source must be easy to audit; no obfuscation, no external downloads beyond the
  HoYoverse API itself
- Global servers only for v1 (no CN log paths or hosts)

### 2. Wishes UI (`src/ui/`)

- A new **Wishes** area alongside the existing events view, per game (reuse the
  existing game-tab pattern and `GameKey` from `src/types.ts`; game-appropriate
  wording: Wishes / Warps / Signals)
- **Import dialog**: per-game step-by-step instructions mirroring the reference sites
  (open history in game → run one-liner → paste result), a copy button for the
  one-liner, a textarea for the payload, validation errors shown inline
- **Pity counters** per banner: pulls since last 5★ and last 4★, and 50/50 vs
  guarantee state where the concept applies (character-event banners; ZZZ exclusive
  channel), derived from the imported history
- **Pull history table**: filterable by banner type and rarity, rarity color
  highlighting, item name, time, and pity count per 5★
- Show imported `uid` and last-import time; re-import merges rather than replaces

### 3. Data layer (`src/data/`)

- A wish-storage module following the existing conventions: localStorage keys under a
  `gachagremlin:wishes:<game>:<uid>` style prefix (see prefix pattern in
  `src/data/cache.ts`, `loadPref`/`savePref` try/catch style in `src/ui/app.ts`)
- Payload validation (shape, game matches selected tab, non-empty items)
- Merge on import: union by item `id`, sorted by `id`; never lose older pulls that
  have aged out of the API's ~6-month window
- Pity calculation module: pure functions over the stored list so they are trivially
  unit-testable

### 4. Tests (`tests/`, Vitest + happy-dom, existing setup)

- JSON fixtures with small synthetic pull histories per game
- Unit tests for: payload validation (accept/reject), merge/dedupe behavior,
  pity and guarantee calculations (including 400-type second character banner in
  Genshin and `getLdGachaLog` collab types in HSR), and import-dialog rendering
- `npm test` must stay green; the deploy workflow runs it before publishing

## Constraints

- **No backend, no proxies.** Everything runs in the player's PowerShell session or
  their browser. The authkey is only ever sent to HoYoverse's own API.
- Do not persist the authkey URL anywhere (not in the payload, not in localStorage).
- Scripts and site must degrade gracefully: import is additive to the existing events
  feature and must not affect it.
- Keep to the repo's stack: vanilla TypeScript, imperative DOM, no new runtime
  dependencies.

## Stretch (later phases, not v1)

- Stats dashboard: lifetime totals, 5★ luck vs expected, 50/50 win rate, per-banner
  breakdowns
- Export/backup and cross-device restore (download/upload JSON)
- Multiple accounts per game with a uid switcher
- CN-region support (CN log paths, `YuanShen_Data`, CN API hosts)
- Support for standard paste-a-URL import from other trackers via SRGF/UIGF
  interchange formats

## Verification

- `npm test` passes with the new suites.
- Manual end-to-end on a machine with at least one of the games installed:
  1. Open the in-game history screen, run the hosted one-liner from the deployed site
     (or `npm run dev` + a locally served script) in Windows PowerShell
  2. Confirm the script reports progress and lands JSON on the clipboard
  3. Paste into the import dialog; confirm uid, pull counts, and pity match the
     in-game history screen
  4. Re-run the import and confirm counts are unchanged (dedupe works)
- Error paths: run a script with the game closed and history never opened → readable
  error message, no stack trace.
