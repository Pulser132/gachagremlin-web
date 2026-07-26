import { describe, expect, it } from 'vitest';
import { decide, renderIssueBody, renderPrBody } from '../scripts/portraitsDecision.ts';
import type { GameSummary } from '../scripts/portraits.ts';

function game(overrides: Partial<GameSummary>): GameSummary {
  return { game: 'hsr', added: [], removed: [], refused: false, wrote: false, ...overrides };
}

describe('decide', () => {
  it('reports neither a removal nor an addition for a clean, unchanged run', () => {
    const result = decide({ games: [game({})] });
    expect(result).toEqual({ hasRemovals: false, hasAdditions: false });
  });

  it('reports an addition when a game wrote new names and nothing was removed', () => {
    const result = decide({ games: [game({ added: ['Kafka'], wrote: true })] });
    expect(result).toEqual({ hasRemovals: false, hasAdditions: true });
  });

  it('reports a removal when a game refused, even if another game only added', () => {
    const result = decide({
      games: [game({ game: 'hsr', removed: ['Acheron'], refused: true }), game({ game: 'zzz', added: ['Ellen'], wrote: true })],
    });
    expect(result).toEqual({ hasRemovals: true, hasAdditions: true });
  });

  it('reports nothing for a game with no portrait config at all — an empty summary', () => {
    const result = decide({ games: [] });
    expect(result).toEqual({ hasRemovals: false, hasAdditions: false });
  });

  it('does not flag a removal that --force already accepted and wrote', () => {
    // planWrite(--force): removed is still populated for the log, but refused
    // is false and write is true. CI never passes --force, but the decision
    // should key off "the generator would not write this", not merely
    // "something disappeared from the sweep".
    const result = decide({ games: [game({ removed: ['Acheron'], refused: false, wrote: true })] });
    expect(result).toEqual({ hasRemovals: false, hasAdditions: false });
  });
});

describe('renderIssueBody', () => {
  it('names exactly which names disappeared, grouped per game', () => {
    const body = renderIssueBody([
      game({ game: 'hsr', removed: ['Acheron', 'Kafka'], refused: true }),
      game({ game: 'zzz', added: ['Ellen'], wrote: true }), // not a removal — must not appear
    ]);
    expect(body).toContain('hsr');
    expect(body).toContain('Acheron');
    expect(body).toContain('Kafka');
    expect(body).not.toContain('zzz');
    expect(body).not.toContain('Ellen');
  });

  it('tells a human how to accept the removal', () => {
    const body = renderIssueBody([game({ removed: ['Acheron'], refused: true })]);
    expect(body).toContain('--force');
  });
});

describe('renderPrBody', () => {
  it('lists exactly the added names, grouped per game', () => {
    const body = renderPrBody([
      game({ game: 'hsr', added: ['Kafka'], wrote: true }),
      game({ game: 'zzz', added: [], wrote: false }), // unchanged — must not appear
    ]);
    expect(body).toContain('hsr');
    expect(body).toContain('Kafka');
    expect(body).not.toContain('zzz');
  });
});
