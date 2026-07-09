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

`npm test` runs 47 tests, mostly against saved wiki fixtures (`tests/fixtures/`, copied from
the bot repo) rather than live network calls, so CI doesn't depend on Fandom's uptime:

- `tests/parser.test.ts`, `tests/times.test.ts` — wikitext parsing and per-region time math,
  ported line-for-line from the bot's own test suite (same expected Unix timestamps).
- `tests/cache.test.ts` — the localStorage TTL cache: fresh hits, expiry, stale-on-error
  fallback, force-refresh.
- `tests/eventCard.test.ts`, `tests/format.test.ts` — region-time resolution and countdown
  formatting.

## Deployment

Every push to `main` runs the test suite, builds, and deploys to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (the official
`actions/deploy-pages` flow). No manual steps once the workflow is in place.

## Architecture

```
src/
  types.ts             GameKey, Region, EventStatus, EventInfo, GameEvents
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
  ui/
    app.ts               page shell: tabs, region picker, sections, refresh
    eventCard.ts           one event's card
    countdown.ts             shared 1s ticker for all countdowns
    format.ts                 countdown + absolute-time formatting
  styles.css            responsive, dark/light via prefers-color-scheme
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
