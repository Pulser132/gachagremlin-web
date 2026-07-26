/**
 * CI glue for the weekly portrait-manifest workflow: reads the JSON a
 * `npm run gen:portraits -- --summary-file <path>` run wrote, and appends the
 * decision to `$GITHUB_OUTPUT` so later workflow steps can branch on it
 * without re-parsing logs.
 *
 * Run: `npx tsx scripts/ci-portraits-decide.ts <summary-file>`
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { decide, renderIssueBody, renderPrBody } from './portraitsDecision.ts';
import type { PortraitsSummary } from './portraits.ts';

function setOutput(outputFile: string, name: string, value: string): void {
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`;
  appendFileSync(outputFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function main(): void {
  const [summaryPath] = process.argv.slice(2);
  if (!summaryPath) throw new Error('usage: ci-portraits-decide.ts <summary-file>');

  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) throw new Error('GITHUB_OUTPUT is not set — this script is meant to run inside a workflow step');

  const summary: PortraitsSummary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const { hasRemovals, hasAdditions } = decide(summary);

  setOutput(outputFile, 'has_removals', String(hasRemovals));
  setOutput(outputFile, 'has_additions', String(hasAdditions));
  if (hasRemovals) setOutput(outputFile, 'issue_body', renderIssueBody(summary.games));
  if (hasAdditions && !hasRemovals) setOutput(outputFile, 'pr_body', renderPrBody(summary.games));
}

main();
