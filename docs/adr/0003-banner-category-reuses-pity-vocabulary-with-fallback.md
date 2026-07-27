# Banner category reuses banners.ts's group keys, falling back to the wiki's own label when unmapped

`GAME_BANNER_CONFIGS` (`src/data/wishes/banners.ts`) already names every Banner group for
pity-tracking purposes (novice, standard, character, weapon, chronicled, ...). The Banners
tab needed its own notion of "category" to group cards under section headers, and we
considered two options: reuse those same group keys as the display feature's vocabulary,
or define an independent category enum scoped to the display feature alone (the two are
sourced differently — wiki HTML for display, pull-history `gacha_type` for pity — so a
separate vocabulary would have been defensible).

We chose to reuse `banners.ts`'s keys, so "which Banner group is this" means the same thing
in both features rather than drifting into two near-synonymous vocabularies. The wrinkle:
`banners.ts` is a closed, hand-maintained set, and the wiki is not — it can start listing a
category (e.g. a hypothetical future "Lighttrace Wish") before anyone's updated
`banners.ts` to add a matching pity group. Rather than let a missing config entry silently
hide a real, currently-running Banner, an unmapped category still renders, grouped under
the wiki's own row label as a plain display string. `banners.ts` gets updated independently,
on its own schedule, to add pity math for it — that update is a config change, not a
prerequisite for the Banner showing up. This is also why card grouping itself reads
category rows dynamically from whatever the wiki's Current Event Wishes table has at fetch
time, rather than a hardcoded Character/Weapon pair — Genshin has more than two Banner
groups (novice, standard, chronicled) that simply don't happen to be "current" today.
