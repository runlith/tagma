import type { JournalBatch } from '@tagma/server/graph/contract/wire/journal';
import { describe, expect, it } from 'vitest';
import { journalRows, runRange } from './rows.js';

const at = (day: number, hour: number): string => new Date(2026, 9, day, hour, 0).toISOString();
const NOW = new Date(2026, 9, 4, 12, 0).getTime();

const batch = (id: number, blockName: string, sessionId: number | null, day: number, ops = ['update']): JournalBatch => ({
  blockName,
  sessionId,
  ops,
  entries: 1,
  firstEventId: id,
  lastEventId: id,
  firstTs: at(day, 9),
  lastTs: at(day, 9),
});

describe('journalRows', () => {
  it('separates the feed into Today, Yesterday and dated days', () => {
    const rows = journalRows([batch(5, 'a', 1, 4), batch(4, 'b', 1, 3), batch(3, 'c', 1, 1)], NOW);
    expect(rows.flatMap((row) => (row.kind === 'day' ? [row.label] : []))).toEqual(['Today', 'Yesterday', 'Oct 1']);
  });

  it('collapses adjacent batches of one author on one block into one run', () => {
    const rows = journalRows([batch(6, 'a', 1, 4, ['answer']), batch(5, 'a', 1, 4, ['create']), batch(4, 'a', 2, 4)], NOW);
    const runs = rows.flatMap((row) => (row.kind === 'run' ? [row] : []));
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ entries: 2, ops: ['create', 'answer'], sessionId: 1 });
    expect(runs[0]?.batches).toHaveLength(2);
    expect(runRange(runs[0]!)).toEqual({ from: 4, to: 6 });
  });

  it('keeps a departure separate from the restored local history of the same author', () => {
    const moved = { name: 'original', title: 'Before the move', destination: { graph: 'target-root', label: 'Target' } };
    const rows = journalRows(
      [batch(6, 'history', 1, 4, ['restore']), { ...batch(5, 'history', 1, 4, ['depart']), moved }, batch(4, 'history', 1, 4)],
      NOW,
    );
    const runs = rows.flatMap((row) => (row.kind === 'run' ? [row] : []));
    expect(runs).toHaveLength(3);
    expect(runs.map((run) => [run.blockName, run.moved])).toEqual([
      ['history', undefined],
      ['history', moved],
      ['history', undefined],
    ]);
    expect(runRange(runs[1]!)).toEqual({ from: 4, to: 5 });
  });

  it('keeps one author on one block apart across a day boundary', () => {
    const rows = journalRows([batch(6, 'a', 1, 4), batch(5, 'a', 1, 3)], NOW);
    expect(rows.filter((row) => row.kind === 'run')).toHaveLength(2);
  });
});
