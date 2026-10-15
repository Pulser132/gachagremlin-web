/**
 * Events-parity golden-fixture generator.
 *
 * Runs the site's wiki parser (the same `parseEventPage` path `showEvent`
 * uses) over the curated inputs in tests/fixtures/parity/inputs.json at a
 * fixed `now`, and writes tests/fixtures/parity/events.golden.json. The bot
 * pins a copy of that file and asserts its own parser matches it (bot issue
 * Pulser132/GachaGremlin#27), so drift on either side fails a test.
 *
 * Run: npm run gen:parity
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eventKey } from '../src/data/reminders.ts';
import { parseEventPage } from '../src/data/wiki/eventPage.ts';
import { normalizeNewlines } from '../src/data/wiki/parser.ts';
import type { EventStatus, GameKey, RegionUnix } from '../src/types.ts';

const FIXTURES = join(import.meta.dirname, '..', 'tests', 'fixtures');
const PARITY = join(FIXTURES, 'parity');
export const GOLDEN_PATH = join(PARITY, 'events.golden.json');

interface Inputs {
  now: number;
  events: { game: GameKey; title: string; fixture: string }[];
}

export interface GoldenEvent {
  game: GameKey;
  title: string;
  eventKey: string;
  status: EventStatus;
  globalTime: boolean;
  startUnix: RegionUnix | null;
  endUnix: RegionUnix | null;
}

export interface Golden {
  /** Unix seconds every status below was computed at. */
  now: number;
  events: GoldenEvent[];
}

export function buildGolden(): Golden {
  const inputs: Inputs = JSON.parse(readFileSync(join(PARITY, 'inputs.json'), 'utf-8'));
  const events = inputs.events.map((input) => {
    const wikitext = normalizeNewlines(readFileSync(join(FIXTURES, input.fixture), 'utf-8'));
    const { event } = parseEventPage(input.game, input.title, input.title, wikitext, inputs.now);
    return {
      game: event.game,
      title: input.title,
      eventKey: eventKey(event),
      status: event.status,
      globalTime: event.globalTime,
      startUnix: event.startUnix,
      endUnix: event.endUnix,
    };
  });
  return { now: inputs.now, events };
}

export function serializeGolden(golden: Golden): string {
  return JSON.stringify(golden, null, 2) + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(GOLDEN_PATH, serializeGolden(buildGolden()));
  console.log(`wrote ${GOLDEN_PATH}`);
}
