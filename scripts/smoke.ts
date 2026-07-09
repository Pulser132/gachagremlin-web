/**
 * Manual live-fetch smoke check: list + show one current event per game,
 * printing name/status/end walltime so it can be eyeballed against each
 * wiki's own Duration section.
 *
 * Run: npx tsx scripts/smoke.ts
 *
 * Node's fetch (unlike a browser's) lets us set a real User-Agent, and
 * Fandom still 403s bot-like default UAs outside the browser, so this
 * script sends the same descriptive UA the bot uses.
 */
import { GAME_KEYS, USER_AGENT } from '../src/data/wiki/games.ts';
import { listEvents, showEvent } from '../src/data/wiki/fetch.ts';

async function main() {
  for (const game of GAME_KEYS) {
    const { current } = await listEvents(game, USER_AGENT);
    const title = current[0];
    if (!title) {
      console.log(`${game}: no current events listed`);
      continue;
    }
    const ev = await showEvent(game, title, USER_AGENT);
    console.log(
      `${game}: ${JSON.stringify(ev.name)} | status=${ev.status} | global=${ev.globalTime} | end_walltime=${ev.endWalltime}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
