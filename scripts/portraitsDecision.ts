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
    hasRemovals: summary.games.some((g) => g.removed.length > 0),
    hasAdditions: summary.games.some((g) => g.wrote && g.added.length > 0),
  };
}

export function renderIssueBody(games: GameSummary[]): string {
  const removals = games.filter((g) => g.removed.length > 0);
  const lines = [
    'The weekly portrait-manifest sweep found names that no longer resolve to a wiki icon.',
    '',
    'No pull request was opened for this run — nothing distinguishes a real ' +
      'delisting from a wiki API call having a bad day except a human reading ' +
      'this list.',
    '',
  ];
  for (const g of removals) {
    lines.push(`### ${g.game}`, '', ...g.removed.map((name) => `- ${name}`), '');
  }
  lines.push(
    'Once confirmed, run `npm run gen:portraits -- --force` locally to accept ' +
      'the removal, then open the PR by hand.',
  );
  return lines.join('\n');
}

export function renderPrBody(games: GameSummary[]): string {
  const additions = games.filter((g) => g.wrote && g.added.length > 0);
  const lines = ['Weekly portrait-manifest sweep — pure additions, no names removed.', ''];
  for (const g of additions) {
    lines.push(`### ${g.game}`, '', ...g.added.map((name) => `- ${name}`), '');
  }
  return lines.join('\n');
}
