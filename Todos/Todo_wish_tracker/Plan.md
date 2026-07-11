# Plan: Wish / Warp / Signal Tracker

Goal: [goal.md](goal.md) — add a gacha pull tracker (Genshin Wishes, HSR Warps, ZZZ
Signals) to GachaGremlin Web. Players run a site-hosted PowerShell one-liner while
their in-game pull history is on screen; the script extracts the authenticated gacha
API URL from the game's webview cache, fetches the full history itself, and copies a
JSON payload to the clipboard; the player pastes it into the site, which computes
pity/guarantee and shows the history. Fully client-side — the site stays a static
GitHub Pages deployment.

## Context

The site (Vite + vanilla TS, no framework, no backend) currently only tracks in-game
events. The import flow deliberately mirrors paimon.moe / starrailstation.com /
stardb.gg. The one divergence (documented in goal.md): those sites fetch history
server-side from a pasted authkey URL; we have no server and the HoYoverse API sends
no CORS headers, so **our scripts fetch the history themselves** and the player pastes
JSON instead of a URL. goal.md contains the full research on how the reference
scripts work and the API endpoints/banner types — read it before implementing; it is
part of this plan.

## Decision log

| # | Decision | Source |
| --- | --- | --- |
| 1 | Import flow mirrors the reference sites: one-liner `iwr -useb <pages-url>/import/<game>.ps1 \| iex`, run while history is on screen, paste clipboard into site | User |
| 2 | Scripts fetch the full history and emit JSON (no CORS proxy, no backend); authkey never persisted anywhere | User (goal.md) |
| 3 | Wishes UI is a **mode toggle** (Events \| Wishes) in the existing header; game tabs apply to both views; region picker, Refresh, and last-updated only render in Events mode; selected view persisted like game/region | Interview |
| 4 | Payload is **custom minimal JSON** (schema below), not UIGF/SRGF; interchange formats stay a stretch goal | Interview |
| 5 | Three self-contained scripts (`genshin.ps1`, `hsr.ps1`, `zzz.ps1`), no shared module — mirrors the reference sites and keeps each script independently auditable | Planner |
| 6 | Wish domain types go in `src/types.ts` alongside `EventInfo` (repo keeps shared domain types in one module) | Planner |
| 7 | `bannerType` on each item = the item's own `gacha_type` from the API (ZZZ: the queried `real_gacha_type`). The UI groups Genshin 400 with 301 and HSR 21/22 as the collab pair for pity purposes | Planner |
| 8 | 50/50 vs guarantee is derived by checking whether the most recent 5★ on a limited banner is in a hardcoded standard-pool list per game (maintained constant in `banners.ts` — the approach every reference tracker uses) | Planner |
| 9 | Storage: `gachagremlin:wishes:<game>:<uid>` holds `{uid, region, items, updatedAt}`; `gachagremlin:wishes:<game>:activeUid` names the uid the UI shows. v1 UI shows the active (most recently imported) uid only; a uid switcher is stretch | Planner |
| 10 | Item `id`s are numeric strings too big for `Number`; compare by length-then-lexicographic (no BigInt needed) for sorting and merge | Planner |
| 11 | Scripts sleep ~350 ms between API pages (mirrors reference-site pacing, avoids `retcode -110` rate limiting) | Planner |
| 12 | Global servers only in v1; CN paths/hosts out of scope | User (goal.md) |
| 13 | PowerShell scripts are not exercised in CI (no game, no cache). Gate = AST syntax parse via `[System.Management.Automation.Language.Parser]::ParseFile` + manual end-to-end run on a machine with a game installed | Planner |

## Architecture sketch

```
public/import/
  genshin.ps1  hsr.ps1  zzz.ps1     # served at <pages-url>/import/<game>.ps1
src/types.ts                        # + WishItem, WishPayload, WishAccount
src/data/wishes/
  banners.ts    # per-game banner groups: api param, label, hard pity, guarantee
                # semantics, standard-pool 5★ names (decision 8)
  payload.ts    # parsePayload(text, expectedGame) -> WishPayload | typed errors
  store.ts      # load/save/merge per (game, uid); activeUid; localStorage try/catch
  pity.ts       # pure fns: pityCounts(items, group), guaranteeState(items, group)
src/ui/
  app.ts        # + view toggle (decision 3); renders events or wishes view
  wishesView.ts # empty state / summary (uid, last import) / pity cards / history
                # table with banner+rarity filters
  importDialog.ts # <dialog>: per-game steps, one-liner + copy button, textarea,
                  # inline validation errors
tests/
  fixtures/wishes/*.json            # small synthetic histories per game
  wishPayload.test.ts  wishStore.test.ts  pity.test.ts  wishesView.test.ts
```

Payload schema (contract between scripts and site — defined once in Phase 1, scripts
must emit exactly this):

```json
{
  "game": "genshin | hsr | zzz",
  "uid": "701234567",
  "region": "<region param from the authkey URL, e.g. os_usa>",
  "exportedAt": 1783731000,
  "items": [
    { "id": "1783600000001234567", "bannerType": "301", "name": "Furina",
      "itemType": "Character", "rank": "5", "time": "2026-07-09 21:14:00" }
  ]
}
```

`items` sorted ascending by id, all fields strings as the API returns them.

## Phases

### Phase 1 — Wish data layer (schema contract, storage, pity math)

Foundational: defines the payload contract Phase 2 scripts emit and Phase 3 UI reads.
Pure TS + tests, no UI, no scripts.

1. Add `WishItem`, `WishPayload`, `WishAccount` to `src/types.ts` (schema above).
2. `src/data/wishes/banners.ts`: per-game banner-group table — group key, display
   label (Wishes/Warps/Signals wording), which `bannerType` values it covers
   (Genshin: 100, 200, 301+400, 302, 500; HSR: 1, 2, 11, 12, 21+22 collab;
   ZZZ: 1, 2, 3, 5), hard pity (90/80 per goal.md), whether 50/50 applies, and the
   standard-pool 5★ name list per game (comment: must be updated when HoYo adds
   standard units).
3. `src/data/wishes/payload.ts`: `parsePayload(text, expectedGame)` — JSON parse,
   shape check, game match, non-empty items, uid present; return typed error strings
   the dialog can show verbatim.
4. `src/data/wishes/store.ts`: `loadAccount(game, uid)`, `getActiveAccount(game)`,
   `importPayload(payload)` (merge = union by `id` using decision-10 comparison; never
   drop existing items), `setActiveUid`. localStorage under decision-9 keys, wrapped
   in try/catch like `readCache`/`writeCache` in `src/data/cache.ts:23-40`.
5. `src/data/wishes/pity.ts`: for a banner group — 5★ pity, 4★ pity, guarantee state
   (decision 8), and per-5★ pity annotations for the history table. Pure functions
   over a sorted item list.
6. Tests + fixtures: `tests/fixtures/wishes/` synthetic histories (one per game;
   Genshin fixture includes 400-type items, HSR fixture includes 21/22);
   `wishPayload.test.ts` (accept/reject cases), `wishStore.test.ts` (merge, dedupe,
   aged-out pulls retained, activeUid), `pity.test.ts` (counts, guarantee flips after
   losing/winning 50/50, group merging).

**Gate:** `npm test` green, including all new suites.

### Phase 2 — PowerShell extractor scripts

The riskiest external-facing piece; doing it right after the contract exists lets
manual end-to-end validation start early. Model each script on the reference scripts
documented in goal.md (§ "How the three reference scripts work") — same log paths,
cache handling, URL extraction, and verification, then the added fetch loop.

1. `public/import/genshin.ps1`, `hsr.ps1`, `zzz.ps1` — each self-contained
   (decision 5), plainly commented for auditability, structure:
   a. TLS 1.2 + `$ProgressPreference = "SilentlyContinue"`; optional game-path arg.
   b. Locate install path from the per-game Unity log (paths/patterns in goal.md),
      with `Player-prev.log` fallbacks where the references have them.
   c. Highest-version folder under `webCaches/`, copy `Cache/Cache_Data/data_2` to a
      temp file, read raw, delete temp.
   d. Split on `1/0/`, keep `http` segments containing `getGachaLog` (HSR also
      `getLdGachaLog`), extract with `https?://[^\x00-\x20\x7F-\xFF]+`, truncate at
      `&end_id=` → append `end_id=0`, sort by `timestamp` param descending.
   e. Verify candidates until `retcode == 0`.
   f. Fetch loop: for each banner param (Genshin `gacha_type` 100/200/301/302/500;
      HSR `gacha_type` 1/2/11/12 on `getGachaLog` and 21/22 on `getLdGachaLog`;
      ZZZ `real_gacha_type` 1/2/3/5): page `size=20`, `end_id` cursor from last item,
      sleep 350 ms (decision 11), until a short/empty page. Print per-banner progress.
   g. Build the Phase-1 payload (game, uid from first item, `region` param from the
      URL, exportedAt, items ascending by id), `ConvertTo-Json -Compress -Depth 4`,
      `Set-Clipboard`, print success + pull count.
   h. Friendly errors, no stack traces: log missing (game never run), no cached URL
      (history screen not opened), all candidates fail verification (authkey expired —
      reopen history), zero pulls.
2. Confirm Vite serves them in dev (`npm run dev` →
   `http://localhost:5173/gachagremlin-web/import/genshin.ps1`) and that `npm run
   build` lands them in `dist/import/`.

**Gate:** all three parse cleanly via
`powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile(...)"`
(zero errors), **and** one manual end-to-end run on a machine with at least one game
installed puts valid Phase-1 JSON on the clipboard (verified by pasting through
`parsePayload`).

### Phase 3 — Wishes UI

1. `src/ui/app.ts`: add the Events | Wishes toggle to the header (decision 3) —
   follow the existing tab-button pattern (`src/ui/app.ts:46-63`); persist under
   `gachagremlin:selectedView` via the existing `loadPref`/`savePref`
   (`src/ui/app.ts:14-29`); hide region picker, Refresh, and last-updated in Wishes
   mode; `render()` dispatches to the events flow (unchanged) or `renderWishesView`.
2. `src/ui/wishesView.ts`: for the active account (store `getActiveAccount`):
   - no data → empty state with per-game import instructions and an Import button;
   - data → summary line (uid, region, last-import time, total pulls), pity cards per
     banner group (5★/4★ pity, hard pity, 50/50-or-guarantee badge where applicable),
     filter controls (banner group + rarity), history table (name, type, rarity color
     class, time, banner, pity-at-5★), newest first. Import button always available;
     re-import merges (Phase 1 store).
3. `src/ui/importDialog.ts`: `<dialog>` with numbered steps mirroring the reference
   sites (open history in game → run one-liner → paste), the game's one-liner in a
   `<code>` block with a copy button (`navigator.clipboard.writeText` with
   selection-fallback), a paste textarea, Import button running `parsePayload` +
   `importPayload`, inline error text on failure, close + re-render on success.
   One-liner URL: `https://pulser132.github.io/gachagremlin-web/import/<game>.ps1`.
4. Styling in `src/styles.css` following existing card/section classes; keep
   dark/light support (`prefers-color-scheme` already in place). Rarity colors:
   5★ gold, 4★ purple.
5. `tests/wishesView.test.ts` (happy-dom, like `tests/eventCard.test.ts`): empty
   state renders instructions; after seeding localStorage with a fixture payload the
   view shows correct uid, pity numbers, and table rows; import dialog rejects a
   wrong-game payload with a visible error.

**Gate:** `npm test` green; manual check on `npm run dev` — toggle views, import a
fixture payload via the dialog, pity cards and table match the fixture's expected
values, events view unaffected.

### Phase 4 — Polish, docs, release

1. README: new "Wish tracker" section — player flow, privacy note (authkey only goes
   to HoYoverse; nothing leaves the browser/localStorage), script auditability, the
   CORS rationale for pasting JSON instead of a URL.
2. Accessibility pass on the new UI: dialog focus handling, `role=tab` semantics on
   the view toggle, table headers, color-independent rarity indication (e.g. star
   glyphs next to color).
3. `npm run build` + `npm run preview` sanity pass; confirm deploy workflow
   (`.github/workflows/deploy.yml`) needs no changes (scripts are static assets).

**Gate:** full Verification section below passes on the preview build.

## Verification

Maps to goal.md's Verification section:

1. `npm test` passes (payload, store, pity, view suites + existing 47).
2. Manual end-to-end with a real game: open in-game history → run the hosted
   one-liner in Windows PowerShell → script reports progress and copies JSON →
   paste into the import dialog → uid, counts, and current pity match the in-game
   history screen.
3. Re-import immediately: totals unchanged (dedupe), `updatedAt` refreshed.
4. Error paths: script run with game closed / history never opened prints a readable
   message, no stack trace; wrong-game paste shows an inline dialog error.
5. Events view behaves exactly as before in Events mode (no regression).
