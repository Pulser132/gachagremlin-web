/**
 * Turns a {@link PortraitsSummary} (scripts/portraits.ts's `--summary-file`
 * output) into the weekly CI workflow's two decisions: whether to open a pull
 * request, and whether to open or update a removal-tracking issue.
 *
 * Per the locked spec (§3.3): a removal in even one game cancels the PR for
 * the whole run — nothing distinguishes a real delisting from a bad API call
 * except a human reading the tracking issue, so no generated file from this
 * run should land unreviewed.
 */
import type { GameSummary, PortraitsSummary } from './portraits.ts';

export interface Decision {
  hasRemovals: boolean;
  hasAdditions: boolean;
}

export function decide(summary: PortraitsSummary): Decision {
  return {
    // `refused` (not a bare `removed.length > 0` check) is the field that
    // means "the generator would not write this without --force"; CI never
    // passes --force, but a removal the generator *did* accept and write is
    // not this run's problem to flag.
    hasRemovals: summary.games.some((g) => g.refused),
    hasAdditions: summary.games.some((g) => g.wrote && g.added.length > 0),
  };
}

/** Renders one `### game` section per game with names, or `''` if none qualify. */
function renderGameSections(games: GameSummary[], names: (g: GameSummary) => string[]): string[] {
  const lines: string[] = [];
  for (const g of games) {
    const list = names(g);
    if (list.length) lines.push(`### ${g.game}`, '', ...list.map((name) => `- ${name}`), '');
  }
  return lines;
}

export function renderIssueBody(games: GameSummary[]): string {
  return [
    'The weekly portrait-manifest sweep found names that no longer resolve to a wiki icon.',
    '',
    'No pull request was opened for this run — nothing distinguishes a real ' +
      'delisting from a wiki API call having a bad day except a human reading ' +
      'this list.',
    '',
    ...renderGameSections(games, (g) => g.removed),
    'Once confirmed, run `npm run gen:portraits -- --force` locally to accept ' +
      'the removal, then open the PR by hand.',
  ].join('\n');
}

export function renderPrBody(games: GameSummary[]): string {
  return [
    'Weekly portrait-manifest sweep — pure additions, no names removed.',
    '',
    ...renderGameSections(games, (g) => (g.wrote ? g.added : [])),
  ].join('\n');
}
