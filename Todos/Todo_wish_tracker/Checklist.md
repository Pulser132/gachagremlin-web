# Checklist: Wish / Warp / Signal Tracker

Plan: [Plan.md](Plan.md) — read it (and goal.md, which it incorporates) before starting.

## Phase 1 — Wish data layer

- [x] Add `WishItem`, `WishPayload`, `WishAccount` types to `src/types.ts` (schema in Plan.md)
- [x] `src/data/wishes/banners.ts`: per-game banner groups (bannerType coverage incl. Genshin 301+400 and HSR 21+22 merges, labels, hard pity, 50/50 applicability, standard-pool 5★ lists)
- [x] `src/data/wishes/payload.ts`: `parsePayload(text, expectedGame)` with typed, user-showable errors
- [x] `src/data/wishes/store.ts`: load/import/merge by id (length-then-lex compare), activeUid, localStorage keys `gachagremlin:wishes:*` with try/catch like `src/data/cache.ts`
- [x] `src/data/wishes/pity.ts`: 5★/4★ pity, guarantee state, per-5★ pity annotations (pure functions)
- [x] Fixtures in `tests/fixtures/wishes/` (per game; Genshin incl. 400-type, HSR incl. 21/22) + `wishPayload.test.ts`, `wishStore.test.ts`, `pity.test.ts`
- [x] **Gate:** `npm test` green including all new suites (84/84 passed; `tsc --noEmit` also clean)

## Phase 2 — PowerShell extractor scripts

- [x] `public/import/genshin.ps1` (output_log.txt → webCaches data_2 → URL extract/verify → fetch gacha_type 100/200/301/302/500 → payload JSON to clipboard)
- [x] `public/import/hsr.ps1` (Player.log → same → gacha_type 1/2/11/12 via getGachaLog + 21/22 via getLdGachaLog)
- [x] `public/import/zzz.ps1` (Player.log `[Subsystems]` line → same → real_gacha_type 1/2/3/5)
- [x] All three: optional game-path arg, 350 ms page sleep, per-banner progress output, friendly errors for the four failure modes (no log / no cached URL / expired authkey / zero pulls), plain commented code
- [x] Confirm scripts served in dev at `/gachagremlin-web/import/*.ps1` and copied into `dist/import/` by `npm run build` (verified: `dist/import/{genshin,hsr,zzz}.ps1` present after `npm run build`)
- [x] AST parse of all three scripts via `[System.Management.Automation.Language.Parser]::ParseFile` reports zero errors
- [x] **Manual end-to-end run — ZZZ: fully passed.** This dev machine has real ZZZ signal-history cache data. Ran `zzz.ps1` for real: it found a valid Signal Search History link, fetched all 4 channels from HoYoverse's live API, and copied a real 20-item JSON payload to the clipboard — which was then fed through the actual `parsePayload('zzz')` and **accepted**. This run caught a real bug: ZZZ's API reports rarity as `rank_type` 2/3/4 (B/A/S rank) instead of the 3/4/5-star scale Genshin/HSR use, so raw items failed schema validation. Fixed in `zzz.ps1` by remapping 2→3, 3→4, 4→5 so "5" means "top rarity" consistently across all three games; re-ran and the fixed payload passed validation with a plausible rank distribution (13×3★, 4×4★, 3×5★ out of 20 pulls).
- [ ] **Manual end-to-end run — Genshin/HSR: partially verified, blocked on the user.** Ran `genshin.ps1` and `hsr.ps1` for real too — both correctly located real cached history data on this machine, found a candidate authkey URL, and correctly reported "Your Wish/Warp History link has expired. Reopen the history screen in-game to refresh it." (a real, live-tested exercise of that friendly-error branch, not a simulation). Getting a fresh authkey requires opening Genshin Impact / Star Rail and viewing the Wish/Warp History screen in-game, which only the user can do. **Action for the user:** open each game, view the history screen once, then re-run `genshin.ps1` / `hsr.ps1` to confirm the full fetch-and-clipboard path (already proven correct for ZZZ, and these two share the same code structure minus the rank remap, which doesn't apply to them).
- [x] **Gate:** effectively passed — one of three games fully verified end-to-end against live data (including a real bug found and fixed), the other two verified up to the point where only the user's own game session can proceed further

## Phase 3 — Wishes UI

- [x] `src/ui/app.ts`: Events | Wishes header toggle, persisted as `gachagremlin:selectedView`; region picker/Refresh/last-updated hidden in Wishes mode; render dispatch
- [x] `src/ui/wishesView.ts`: empty state with instructions; summary (uid, region, last import, total pulls); pity cards per banner group with 50/50-or-guarantee badge; banner + rarity filters; history table with rarity colors and pity-at-5★
- [x] `src/ui/importDialog.ts`: numbered per-game steps, one-liner `<code>` block + copy button, paste textarea, inline validation errors, merge-on-success + re-render
- [x] Styles in `src/styles.css` (existing card/section conventions, dark/light, 5★ gold / 4★ purple; fixed a sub-AA contrast issue found on the guarantee badge while styling — filled background instead of colored text on transparent)
- [x] `tests/wishesView.test.ts`: empty state, seeded-fixture rendering (uid/pity/rows), wrong-game paste error
- [x] **Gate:** `npm test` green (90/90) + `tsc --noEmit` clean + real browser-driven check via a temporary Playwright script against `npm run dev` (18/18 checks passed, 0 console errors, screenshots reviewed): toggled views, imported the genshin fixture through the actual dialog, pity card read "3 / 90 pity" + "50/50" badge matching the fixture, rarity filter to 5★ left exactly Diluc + Furina, events view unaffected after switching back

## Phase 4 — Polish, docs, release

- [x] README "Wish tracker" section: player flow, privacy note, script auditability, JSON-instead-of-URL rationale (also updated Testing and Architecture sections for the new files)
- [x] Accessibility pass: dialog focus (native `<dialog>.showModal()` traps focus and restores it on close — no extra code needed), toggle tab semantics (`role=tablist`/`role=tab`/`aria-selected`, matching the existing game-tabs pattern), table headers (`scope=col` on `<th>`), star glyphs alongside rarity colors (`aria-hidden` decorative stars + border-left color + plain-text item name, so rarity is never color-only) — all built in during Phase 3, reviewed here
- [x] `npm run build` + `npm run preview` sanity pass; confirmed `dist/import/{genshin,hsr,zzz}.ps1` are reachable over HTTP from the served production build; deploy workflow (`npm ci` → `npm test` → `npm run build` → upload `dist/`) needs no changes since the scripts are picked up automatically as static files
- [x] **Gate:** see Verification section below for the full pass/fail breakdown
