# HSR and ZZZ banner-listing pages and pool-template fields: verified against the live wikis

*Researched 2026-09-10, against the live `honkai-star-rail.fandom.com` and
`zenless-zone-zero.fandom.com`, and the live repo.*

## Question

Issue #32 (child of wayfinder issue #31) asks whether the Genshin-derived
Banners approach (`docs/research/banner-feature-fandom-sourcing.md`,
ADR-0002) — `action=parse&prop=text` for the Lua/DPL-rendered
Current/Upcoming listing, `action=parse&prop=wikitext` for clean per-Banner
infobox + pool templates — carries over to Honkai: Star Rail and Zenless
Zone Zero unchanged, and whether the prior (unverified) issue #31 notes on
page titles and template field names hold up against a live re-check.

## Answer

**HSR: yes, carries over almost exactly.** The listing page is `Warp`
(`https://honkai-star-rail.fandom.com/wiki/Warp`), which is Lua+DPL-driven
in the same shape as Genshin's `Wish` (`{{#invoke:Warp List|main|warps=
{{#DPL:...}}}}`), has the same `Current_Event_Warps` /
`Upcoming_Event_Warps` heading-id pair, and renders to the same
`<table class="wikitable thc tdc1">` category-row shape with embedded,
pre-sized `<img>` thumbnails. Per-Banner detail pages are clean
`{{Warp|...}}` + `{{Warp Pool|...}}` wikitext. The prior issue #31 field
names for both Character Event Warp and Light Cone Event Warp banners are
**confirmed correct, verbatim, no discrepancy**.

**ZZZ: no — the "one overview page" assumption from issue #31 is wrong.**
There is no ZZZ page that plays `Wish`/`Warp`'s role. `Signal Search` is a
prose overview page with zero Current/Upcoming data and no DPL invocation
anywhere in its wikitext. The actual per-channel Current/Upcoming listings
live on each channel-type page separately — `Exclusive Channel` and
`W-Engine Channel` — each invoking a *different* template than Genshin/HSR's
`{{Wish List}}`/`{{Warp List}}`: `{{Current Signal Search|<Channel> Signal
Searches}}`, which is a raw `{{#DPL:...}}` (no `{{#invoke:...}}` Lua wrapper)
scoped to that one channel's category. The rendered HTML is also a
**different DOM shape entirely** — not a `<table class="wikitable...">`,
but a sequence of `<div><b>Current Event Run</b></div>` / `<div class="notice
hatnote ... dablink">Main article: <a>...</a></div>` / `<div
class="countdownevent hidden">` blocks, with **no embedded banner thumbnail
image** at all (Genshin/HSR's listing table embeds a pre-sized `<img
src>`; ZZZ's does not — image resolution has to come from the per-banner
page's `{{Signal Search Infobox|image=...}}` field plus a separate
`imageinfo` call). Per-Banner detail pages are, however, clean
`{{Signal Search Infobox|...}}` + `{{Signal Search Pool|...}}` wikitext,
and the prior issue #31 field names for both Exclusive Channel and
W-Engine Channel banners are **confirmed correct, verbatim, no
discrepancy** on the field-name text itself — the discrepancy is entirely
in the listing-page architecture around them, not the per-banner template
fields.

**Cloudflare gating matches Genshin's pattern exactly on both wikis**:
`curl` against a rendered `/wiki/...` page or `/robots.txt`, with or
without a browser User-Agent, returns HTTP 403 with the same "Just a
moment..." JS-challenge body on both `honkai-star-rail.fandom.com` and
`zenless-zone-zero.fandom.com`. Every `api.php` call in this investigation
succeeded (HTTP 200) — and, on both hosts, succeeded even with `curl`'s
default (non-browser) User-Agent, no browser UA needed for `api.php`
specifically. `src/data/wiki/games.ts` already has the right hostnames
(`honkai-star-rail.fandom.com`, `zenless-zone-zero.fandom.com`) and its
comment already correctly anticipated ZZZ's per-channel-page reality by
naming `Exclusive Channel` (not `Signal Search`) as the unset candidate —
this research confirms that guess and adds `W-Engine Channel` as its
sibling.

## Findings

All fetched live, 2026-09-10, via `curl -A "<browser UA>"
https://<host>/api.php?...`. WebFetch was tried first and failed with the
same tool-side HTTP 402 "Payment Required" seen in the Genshin research
(reproduced here too, see Gaps); `curl` was used for every finding below.
Both `curl` with a browser UA and `curl` with its own default UA succeeded
identically against `api.php` on both hosts (see Finding 9) — unlike the
Genshin doc, a browser UA was not actually required for the API calls here,
though one was used throughout for consistency with that prior research.

1. **HSR listing page found: `Warp`.** Its own wikitext
   (`https://honkai-star-rail.fandom.com/api.php?action=parse&page=Warp&prop=wikitext&format=json&formatversion=2`)
   contains, verbatim:
   ```
   ===Current Event Warps===
   {{Warp List|no_past=1|no_upcoming=1|no_headers=1}}

   ===Upcoming Event Warps===
   {{Warp List|no_past=1|no_current=1|no_headers=1}}
   ```
   confirming the same heading/template split as Genshin's `Wish`. The page
   also opens with `{{Stub|Collab Warp info.}}` — the wiki itself flags this
   page as incomplete regarding collab banners, worth knowing if a collab
   banner is ever missing from the rendered table.

2. **HSR listing mechanism is Lua + DPL, same shape as Genshin.**
   `https://honkai-star-rail.fandom.com/api.php?action=parse&page=Template:Warp_List&prop=wikitext&format=json&formatversion=2`
   returned:
   ```
   <includeonly>{{#invoke:Warp List
   |main
   |warps={{#DPL:
   |namespace=
   |category=Warp
   |uses=Template:Warp
   |notcategory=Recurring Warps
   |notcategory=Permanent Warps
   |mode=userformat
   |include={Change History}:1,{Warp¦Phantom Warp Format}
   |secseparators=version=,;
   |ordermethod=sortkey
   }}}}</includeonly>
   ```
   Structurally identical to Genshin's `Template:Wish_List` (same
   `{{#invoke:...|main|...={{#DPL:...}}}}` wrapper, `category=Warp` in place
   of `category=Wish`).

3. **HSR section anchors, via `prop=sections`**:
   `https://honkai-star-rail.fandom.com/api.php?action=parse&page=Warp&prop=sections&format=json&formatversion=2`
   returned, among others:
   ```
   {"line":"Current Event Warps","number":"2.1","anchor":"Current_Event_Warps"}
   {"line":"Upcoming Event Warps","number":"2.2","anchor":"Upcoming_Event_Warps"}
   ```
   Section index `3` = Current, `4` = Upcoming (confirmed by fetching both
   below).

4. **HSR rendered Current-section HTML is the same table shape as Genshin.**
   `https://honkai-star-rail.fandom.com/api.php?action=parse&page=Warp&prop=text&section=3&format=json&formatversion=2`
   returned (trimmed to one category row):
   ```html
   <table class="wikitable thc tdc1"><tbody><tr><th>Type</th><th>Warps</th></tr>
   <tr><th colspan="2"><a href="/wiki/Version/4.5" title="Version/4.5">Version 4.5</a>: August 26, 2026 — September 12, 2026</th></tr>
   <tr><td><a href="/wiki/Character_Event_Warp" title="Character Event Warp">Character<br />Event</a></td>
   <td><div class="warp-banners"><div><span typeof="mw:File"><a href="/wiki/Summer_Chorus/2026-08-26" title="Summer Chorus/2026-08-26">
   <img alt="Summer Chorus 2026-08-26" src="https://static.wikia.nocookie.net/houkai-star-rail/images/5/5f/Summer_Chorus_2026-08-26.png/revision/latest/scale-to-width-down/250?cb=20260906145806" .../>
   </a></span><br /><a href="/wiki/Summer_Chorus/2026-08-26" title="Summer Chorus/2026-08-26">Summer Chorus</a></div>
   <div>... A Rainbow onto Twilight ...</div></div></td></tr>
   <tr><td><a href="/wiki/Light_Cone_Event_Warp" title="Light Cone Event Warp">Light<br />Cone<br />Event</a></td>
   <td><div class="warp-banners">... Brilliant Fixation ... Bygone Reminiscence ...</div></td></tr>
   ...
   </tbody></table>
   ```
   Same `wikitable thc tdc1` class, same `<div class="warp-banners">`
   wrapper (Genshin uses `wish-banners` — one word different, same shape),
   same embedded pre-sized (`250`px) CDN `<img src>` per banner. The only
   HSR-specific wrinkle: this table also carries **historical, no-longer-
   current rows** grouped under `<th colspan="2">` version headers (Version
   4.5, 4.4, 3.4 all appeared in the same "Current Event Warps" section
   fetch) — a `no_past=1` DPL flag exists in the template invocation
   (finding 2) but visibly did not fully suppress older rows in this live
   fetch; a real parser would need to pick the *first* version block per
   type, not assume the whole table is "current."
   `img src` also legitimately falls back to a `data:image/gif;base64,...`
   1x1 placeholder with the real URL moved to `data-src` for lazy-loaded
   rows further down the table (standard Fandom lazy-load behavior) — a
   parser must read `data-src` as a fallback when `src` is a data URI.

5. **HSR per-Banner detail pages confirmed, both types.**
   Character Event Warp —
   `https://honkai-star-rail.fandom.com/api.php?action=parse&page=Summer%20Chorus%2F2026-08-26&prop=wikitext&format=json&formatversion=2`:
   ```
   {{Warp
   |name              = Summer Chorus 2026-08-26
   |image             = Summer Chorus 2026-08-26.png
   |type              = Character Event
   ...
   }}
   ...
   {{Warp Pool
   |character_5_F = Robin • Summeretto
   |character_4_F = Dan Heng; Qingque; Gallagher
   |character_5   = Bailu; Blade; Bronya; Clara; Fu Xuan; Gepard; Himeko; Seele; Welt; Yanqing
   |character_4   = Arlan; Asta; Guinaifen; ... (full standard-pool list)
   |lightcone_4   = A Secret Vow; After the Charmony Fall; ...
   |lightcone_3   = Adversarial; Amber (Light Cone); Arrows; ...
   }}
   ```
   Light Cone Event Warp —
   `https://honkai-star-rail.fandom.com/api.php?action=parse&page=Brilliant%20Fixation%2F2026-08-26&prop=wikitext&format=json&formatversion=2`:
   ```
   {{Warp
   |name              = Brilliant Fixation 2026-08-26
   |image             = Brilliant Fixation 2026-08-26.png
   |type              = Light Cone Event
   ...
   }}
   ...
   {{Warp Pool
   |lightcone_5_F = Rise and Sing
   |lightcone_4_F = Dream's Montage; Geniuses' Greetings; A Little Getaway
   |lightcone_5   = But the Battle Isn't Over; In the Name of the World; ...
   |character_4   = Arlan; Asta; Dan Heng; Gallagher; ...
   |lightcone_4   = A Secret Vow; After the Charmony Fall; ...
   |lightcone_3   = Adversarial; Amber (Light Cone); Arrows; ...
   }}
   ```
   Collab check — `Of the Beginning, Enuma Elish/2026-07-24`
   (`https://honkai-star-rail.fandom.com/api.php?action=parse&page=Of%20the%20Beginning%2C%20Enuma%20Elish%2F2026-07-24&prop=wikitext&format=json&formatversion=2`)
   confirmed `|type = Character Collaboration` — matching the prior notes'
   `"<Kind> Collaboration"` pattern.
   **No discrepancy versus the prior (unverified) issue #31 notes**: field
   names for both banner types, and the `type` value pattern, match
   exactly — `character_5_F`/`character_4_F`/`character_5`/`character_4`/
   `lightcone_4`/`lightcone_3` for character banners,
   `lightcone_5_F`/`lightcone_4_F`/`lightcone_5`/`character_4`/`lightcone_4`/
   `lightcone_3` for light cone banners.

6. **ZZZ's `Signal Search` page is a prose overview with no Current/Upcoming
   data at all — the single biggest discrepancy from issue #31's framing.**
   Full wikitext
   (`https://zenless-zone-zero.fandom.com/api.php?action=parse&page=Signal%20Search&prop=wikitext&format=json&formatversion=2`)
   is ~5.6KB of prose describing four channels (`==Stable Channel==`,
   `==Exclusive Channel==`, `==W-Engine Channel==`, `==Bangboo Channel==`)
   plus `==Other Languages==`/`==Change History==`/`==Navigation==` — no
   `{{...List}}` or `{{#DPL:...}}` invocation anywhere, no "Current"/
   "Upcoming" heading. Confirmed independently via `prop=sections`
   (`https://zenless-zone-zero.fandom.com/api.php?action=parse&page=Signal%20Search&prop=sections&format=json&formatversion=2`),
   whose full section list is just:
   ```
   Stable Channel, Exclusive Channel, W-Engine Channel, Bangboo Channel,
   Other Languages, Change History, Navigation
   ```
   There is no ZZZ page playing `Wish`/`Warp`'s "one overview page with a
   Current/Upcoming table" role. `src/data/wiki/games.ts`'s own comment
   already anticipated this by naming `Exclusive Channel` (not `Signal
   Search`) as the unset v1 candidate for ZZZ's `bannerIndexPage` — this
   finding confirms that instinct was right and issue #31's implicit
   "Signal-Search-equivalent overview page" framing was not.

7. **ZZZ's real per-channel listing lives on `Exclusive Channel` and
   `W-Engine Channel`, each invoking a different template than Genshin/HSR.**
   `Exclusive Channel`'s wikitext
   (`https://zenless-zone-zero.fandom.com/api.php?action=parse&page=Exclusive%20Channel&prop=wikitext&format=json&formatversion=2`)
   contains:
   ```
   ==Current & Upcoming Signal Searches==
   {{Current Signal Search|Exclusive Channel Signal Searches}}
   ```
   `W-Engine Channel`'s wikitext has the identical pattern, parameterized
   differently:
   ```
   ==Current & Upcoming Signal Searches==
   {{Current Signal Search|W-Engine Channel Signal Searches}}
   ```
   `Template:Current Signal Search`'s own wikitext
   (`https://zenless-zone-zero.fandom.com/api.php?action=parse&page=Template:Current%20Signal%20Search&prop=wikitext&format=json&formatversion=2`)
   shows it is a **raw `{{#DPL:...}}`** (no `{{#invoke:...}}` Lua wrapper,
   unlike Genshin/HSR's list templates), taking the channel name as
   parameter `{{{1}}}` and filtering
   `category=Signal Searches&{{{1|{{PAGENAME}}}}}` for the current run and
   `category=Signal Searches&Upcoming Content&{{{1|{{PAGENAME}}}}}` for the
   upcoming run — an AND-combined category filter scoped per-channel-page,
   structurally different from Genshin/HSR's single `category=Wish`/
   `category=Warp` covering the whole listing page in one query. `prop=
   sections` on `Exclusive Channel`
   (`https://zenless-zone-zero.fandom.com/api.php?action=parse&page=Exclusive%20Channel&prop=sections&format=json&formatversion=2`)
   gives the heading id as `Current_&_Upcoming_Signal_Searches` (note the
   literal `&`, not `_and_` or an escaped form) at section index `5`; the
   same section on `W-Engine Channel` is index `3`.

8. **ZZZ's rendered Current/Upcoming HTML is a different DOM shape entirely
   — no table, no embedded thumbnail.**
   `https://zenless-zone-zero.fandom.com/api.php?action=parse&page=Exclusive%20Channel&prop=text&section=5&format=json&formatversion=2`
   returned (trimmed):
   ```html
   <div><b>Current Event Run</b></div>
   <div role="note" data-nosnippet="" class="notice hatnote context-link main dablink">
     Main article: <a href="/wiki/Axiom_of_Captivation/2026-09-09" title="Axiom of Captivation/2026-09-09">Axiom of Captivation/2026-09-09</a>
   </div>
   <div class="countdownevent hidden">
     <div><span class="countdownevent-region">Asia</span><hr />Ends in:<br />
       <big><span ... class="countdown" style="display:none;">
         <span class="countdowndate" style="font-weight:bold">September 30, 2026 03:59:59 AM UTC</span>
       </span></big>
     </div>
     ... (Europe, America regions repeated) ...
   </div>
   <div role="note" ... class="notice hatnote context-link main dablink">
     Main article: <a href="/wiki/Bloodmoon_Rising/2026-09-09" ...>Bloodmoon Rising/2026-09-09</a>
   </div>
   ... (second countdown block) ...
   <hr /><div><b>Upcoming Event Run</b></div>
   <div role="note" ...>Main article: <a href="/wiki/Cindernite_Respite/2026-09-30" ...>Cindernite Respite/2026-09-30</a></div>
   ... <div role="note" ...>Main article: <a href="/wiki/Cold_Rain_Wanes_in_the_Night/2026-09-30" ...>Cold Rain Wanes in the Night/2026-09-30</a></div>
   ```
   No `<table>`, no `<img>` anywhere in this fragment — banner artwork is
   simply not present in the listing HTML for ZZZ. The only usable signal
   per banner is the linked page title (which is exactly the dated
   per-Banner page slug) plus a same-shaped `countdownevent` block giving
   per-region start/end times. `W-Engine Channel`'s section 3 fetch
   (`https://zenless-zone-zero.fandom.com/api.php?action=parse&page=W-Engine%20Channel&prop=text&section=3&format=json&formatversion=2`)
   returned the byte-identical shape, just with `Crimson Thirst/2026-09-09`
   and `Neon Fantasies/2026-09-09` as current, `Crimson Moon Casket/2026-09-30`
   and `Frostfall Sickle/2026-09-30` as upcoming. **This confirms two
   concurrent banners per channel per run is normal for ZZZ** (both
   `Exclusive Channel` and `W-Engine Channel` list two "Current Event Run"
   entries each), the ZZZ analogue of Genshin's 301/400 concurrent character
   banners — and cross-checked directly: `Axiom of Captivation/2026-09-09`
   and `Bloodmoon Rising/2026-09-09` are both confirmed `|type = Exclusive
   Channel` in their own infoboxes (finding 10), i.e. genuinely the same
   channel, not one Exclusive + one W-Engine mislabeled.

9. **ZZZ per-Banner detail pages confirmed, both channel types — field
   names match the prior issue #31 notes exactly.**
   Exclusive Channel —
   `https://zenless-zone-zero.fandom.com/api.php?action=parse&page=Axiom%20of%20Captivation%2F2026-09-09&prop=wikitext&format=json&formatversion=2`:
   ```
   {{Signal Search Infobox
   |name              = Axiom of Captivation 2026-09-09
   |image             = Axiom of Captivation 2026-09-09.png
   |type              = Exclusive Channel
   ...
   }}
   ...
   {{Signal Search Pool
   |agent_S_F    = Nangong Yu
   |agent_A_F    = Anton Ivanov;Nicole Demara
   |agent_S      = Alexandrina Sebastiane;Grace Howard;Koleda Belobog;Nekomiya Mana;Soldier 11;Von Lycaon;Caesar King;Zhu Yuan;Tsukishiro Yanagi
   |agent_A      = Anby Demara;Ben Bigger;Billy Kid;Corin Wickes;Komano Manato;Luciana de Montefio;Pan Yinhu;Piper Wheel;Pulchra Fellini;Seth Lowell;Soukaku
   |w-engine_A   = Bashful Demon; Big Cylinder; Box Cutter; ...
   |w-engine_B   = (Identity) Base;(Identity) Inflection;(Lunar) Decrescent;...
   }}
   ```
   W-Engine Channel —
   `https://zenless-zone-zero.fandom.com/api.php?action=parse&page=Crimson%20Thirst%2F2026-09-09&prop=wikitext&format=json&formatversion=2`:
   ```
   {{Signal Search Infobox
   |name              = Crimson Thirst 2026-09-09
   |image             = Crimson Thirst 2026-09-09.png
   |type              = W-Engine Channel
   ...
   }}
   ...
   {{Signal Search Pool
   |w-engine_S_F = Crimson Thirst
   |w-engine_A_F = Drill Rig - Red Axis; The Vault
   |agent_A      = Anby Demara;Anton Ivanov;Ben Bigger;Billy Kid;Corin Wickes;Komano Manato;Luciana de Montefio;Nicole Demara;Pan Yinhu;Piper Wheel;Pulchra Fellini;Seth Lowell;Soukaku
   |w-engine_S   = Fusion Compiler;Hellfire Gears;Steel Cushion;The Brimstone;The Restrained;Weeping Cradle;Tusks of Fury;Riot Suppressor Mark VI;Timeweaver
   |w-engine_A   = Bashful Demon; Big Cylinder; Box Cutter; ...
   |w-engine_B   = (Identity) Base;(Identity) Inflection;(Lunar) Decrescent;...
   }}
   ```
   **No discrepancy versus the prior (unverified) issue #31 notes** on
   field names: `agent_S_F`/`agent_A_F`/`agent_S`/`agent_A`/`w-engine_A`/
   `w-engine_B` for Exclusive Channel, `w-engine_S_F`/`w-engine_A_F`/
   `agent_A`/`w-engine_S`/`w-engine_A`/`w-engine_B` for W-Engine Channel —
   both match exactly. One addition the prior notes didn't mention: a
   third rank tier, `w-engine_B` (B-Rank W-Engines), appears in the
   standard pool on both channel types — not itself a discrepancy (the
   prior notes' `w-engine_B` field was already listed) but worth flagging
   since it's a rank tier below A that has no S/A counterpart character
   equivalent in HSR's scheme, i.e. ZZZ's standard pool has one more rarity
   tier than HSR's/Genshin's do.

10. **Cloudflare gating identical to Genshin's pattern on both wikis; `api.php` needs no browser UA either.**
    ```
    curl (no UA)      https://honkai-star-rail.fandom.com/wiki/Warp        -> 403
    curl (browser UA) https://honkai-star-rail.fandom.com/wiki/Warp        -> 403
    curl (no UA)      https://honkai-star-rail.fandom.com/robots.txt       -> 403
    curl (browser UA) https://honkai-star-rail.fandom.com/robots.txt       -> 403
    curl (no UA)      https://zenless-zone-zero.fandom.com/wiki/Exclusive_Channel -> 403
    curl (browser UA) https://zenless-zone-zero.fandom.com/wiki/Exclusive_Channel -> 403
    curl (no UA)      https://zenless-zone-zero.fandom.com/robots.txt      -> 403
    curl (browser UA) https://zenless-zone-zero.fandom.com/robots.txt      -> 403
    ```
    Response body in every 403 case (both hosts) starts:
    ```html
    <!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=Edge">
    <meta name="robots" content="noindex,nofollow">
    ...
    ```
    the same Cloudflare JS-challenge page Genshin's research found — byte-
    identical template, different per-request `nonce`. By contrast, every
    `api.php` call in findings 1-9 above returned HTTP 200, and — unlike
    what the Genshin doc's phrasing implied was necessary — a browser UA
    turned out **not** to be required for `api.php` on either HSR or ZZZ:
    ```
    curl (no UA) https://honkai-star-rail.fandom.com/api.php?action=parse&page=Warp&prop=wikitext&format=json&formatversion=2 -> 200
    curl (no UA) https://zenless-zone-zero.fandom.com/api.php?action=parse&page=Signal%20Search&prop=wikitext&format=json&formatversion=2 -> 200
    ```
    Net effect: identical to Genshin — rendered-page/robots.txt scraping is
    actively Cloudflare-gated on all three wikis, `api.php` is not, and
    this repo's API-only approach generalizes across all three games
    without needing any UA spoofing at all for the API calls themselves
    (WebFetch — this environment's own fetch tool — still failed with the
    same HTTP 402 tool-side error seen in the Genshin research; `curl` was
    the working fallback here too, see Gaps).

11. **Category-listing fallback discovery works the same way on both wikis.**
    `https://honkai-star-rail.fandom.com/api.php?action=query&list=categorymembers&cmtitle=Category:Warp&cmlimit=10&format=json&formatversion=2`
    returned a mixed list of banner-series and dated banner-occurrence
    pages (`Butterfly on Swordtip/2023-04-26`, `Brilliant Fixation/2023-04-26`,
    `Departure Warp`, `Stellar Warp`, ...) — same historical-archive shape
    Genshin's `Category:Wish` had.
    `https://zenless-zone-zero.fandom.com/api.php?action=query&list=categorymembers&cmtitle=Category:Signal%20Searches&cmlimit=10&format=json&formatversion=2`
    returned the ZZZ equivalent (`'Till the Ends of the Sky/2026-08-19`,
    `Alone in a Shared Dream/2025-11-05`, `An Outstanding Partner`, ...) —
    confirming `Category:Signal Searches` (not `Category:Signal Search`,
    plural) is the right category name on that wiki, as a fallback/archive
    source parallel to Genshin's `Category:Wish` and HSR's `Category:Warp`.

12. **Existing repo config (`src/data/wiki/games.ts`, `src/data/wishes/banners.ts`)
    checked read-only, no edits made.** `games.ts` already has the correct
    live hostnames (`honkai-star-rail.fandom.com`, `zenless-zone-zero.fandom.com`)
    and correctly leaves `bannerIndexPage` unset for both `hsr` and `zzz`,
    with a comment naming `Warp` and `Exclusive Channel` as the (at-the-time
    unverified) candidates — both are now confirmed real, live pages, with
    the caveat (finding 6-8) that ZZZ needs **two** page references
    (`Exclusive Channel` and `W-Engine Channel`), not one, since there is no
    single ZZZ listing page the way there is for Genshin and HSR.
    `banners.ts`'s `GAME_BANNER_CONFIGS` group labels (`Character Event
    Warp`, `Light Cone Event Warp`, `Collaboration Character Warp`,
    `Collaboration Light Cone Warp` for HSR; `Exclusive Channel`,
    `W-Engine Channel` for ZZZ) match the wiki's own `type` field values
    and listing category link text found live in findings 4-9 — no
    contradiction found between the existing pity-config vocabulary and
    live wiki labels for either game.

## Gaps / open questions

- WebFetch (this environment's fetch tool) failed with HTTP 402 "Payment
  Required" on every URL tried here, reproducing the same tool-side issue
  the Genshin research hit — `curl` was the fallback for every finding
  above, same as that prior research. Still unrelated to Fandom itself.
- HSR's "Current Event Warps" table (finding 4) visibly still contained
  clearly-past rows (Version 3.4, dated July 2025) alongside the genuinely
  current Version 4.5 row, despite the template invocation passing
  `no_past=1`. Not independently re-verified *why* — possibly `no_past`
  only suppresses banners whose `time_end` has passed by a wider margin, or
  a wiki-side inconsistency in how old rows get re-categorized out of
  `Category:Warp`. Either way, a real parser cannot assume "first row per
  type = current" without also checking that row's own dates/version
  block, unlike Genshin's simpler current-only-Wish table.
- ZZZ's `Stable Channel` and `Bangboo Channel` (the two permanent,
  non-rotating channels) were not investigated for whether they also carry
  a `{{Current Signal Search|...}}` invocation or Current/Upcoming section
  — out of scope since they're not event-limited "banners" in the domain
  sense (`CONTEXT.md`'s Banner concept implies a fixed window), but worth
  confirming before assuming only two ZZZ channel pages need
  `bannerIndexPage`-style config.
- Did not verify a ZZZ page where only one banner (not two) is currently
  live for a given channel — both `Exclusive Channel` and `W-Engine
  Channel` happened to have exactly two concurrent current + two upcoming
  entries at fetch time (2026-09-10), so the *single-banner* rendering
  shape (does the `<hr/>` separator or `<b>Upcoming Event Run</b>` label
  still appear identically when there's only one?) is unconfirmed.
- Did not fetch `imageinfo` for a ZZZ banner's infobox `image` field to
  byte-confirm the resolved CDN URL the way the Genshin doc did (finding 5
  there) — flagged here as still-open since finding 8 established ZZZ's
  listing HTML has no thumbnail at all, making that `imageinfo` round-trip
  load-bearing (not just a nice-to-have optimization) for ZZZ specifically,
  unlike Genshin/HSR where the listing table already embeds a usable
  thumbnail URL.
- HSR's `{{Stub|Collab Warp info.}}` tag on the `Warp` page itself (finding
  1) suggests the wiki maintainers consider collab-banner coverage on that
  page incomplete — not independently chased further, but a reason to
  treat HSR's collab-banner rows in the rendered table as possibly less
  reliable than the regular Character/Light Cone Event rows.

## Recommendation

**HSR needs no new parser shape** — `src/data/wiki/parser.ts`'s planned
Genshin `<table class="wikitable...">`/`<div class="wish-banners">` walker
(per ADR-0002's recommendation) can be reused near-verbatim for HSR's
`<table class="wikitable thc tdc1">`/`<div class="warp-banners">` shape;
only the class-name lookup needs to accept both `wish-banners` and
`warp-banners` (or take it as a parameter), and the "pick current, not
past, rows" logic needs to also filter by row date/version rather than
trusting `no_past=1` to have already done it (see Gaps).

**ZZZ needs a materially different fetch and parse path, not a variant of
the Genshin/HSR one:**
- `src/data/wiki/games.ts`'s `GameConfig.bannerIndexPage` (currently a
  single optional string) can't represent ZZZ as-is — ZZZ needs **two**
  listing pages per game (`Exclusive Channel`, `W-Engine Channel`), each
  independently fetched and each contributing one "Banner category" row,
  rather than one page whose rendered HTML already contains both
  categories the way Genshin's `Wish`/HSR's `Warp` do. This is a shape
  change to `GameConfig`, not just a new value (e.g. `bannerIndexPages:
  string[]` or per-category page refs), and affects `hasBannerIndexPage`'s
  boolean-presence check too.
- The rendered-HTML parser for ZZZ needs to be a **new, third shape**
  alongside the table-walker above: read the sequence of `<div class="notice
  hatnote ... dablink">Main article: <a href="/wiki/X">X</a></div>` +
  adjacent `<div class="countdownevent hidden">` pairs, grouped by the
  preceding `<div><b>Current Event Run</b></div>` / `<div><b>Upcoming Event
  Run</b></div>` marker — there is no table to walk, and no image URL to
  read from this fragment at all.
- Because ZZZ's listing carries no thumbnail, `showBanner`'s per-page
  detail fetch (`action=parse&prop=wikitext`) becomes the *only* source of
  the banner's `image` field for ZZZ, and `resolveImageUrl`'s `imageinfo`
  call becomes mandatory on the hot path rather than an optional
  cross-check — unlike Genshin/HSR, where the listing table's own `<img
  src>` can be used directly and the imageinfo call is only needed as a
  fallback or for higher-resolution art.
- `{{Signal Search Pool}}` and `{{Warp Pool}}` fields parse with the exact
  same semicolon-split convention `{{Wish Pool}}` already established
  (confirmed in findings 5 and 9), so `parseInfobox`'s sibling for
  `{{Wish|...}}` can be extended to also recognize `{{Warp|...}}` and
  `{{Signal Search Infobox|...}}` by template name, and the pool-field
  parser is genuinely reusable across all three games — only the *set* of
  field-name prefixes differs (`character_`/`weapon_` for Genshin,
  `character_`/`lightcone_` for HSR, `agent_`/`w-engine_` for ZZZ), which a
  per-game field-name map (not per-game parser logic) can handle.
