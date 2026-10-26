import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { bench, describe } from 'vitest';
import { ThreadForest } from './forest.js';

const WIDTH_BUDGET = 8;
const ROUNDS = 4_000;

const row = (id: string, parentThreadId: string | null, order: number, over: Partial<ThreadListRow> = {}): ThreadListRow =>
  ({
    id,
    projectId: 1,
    title: id,
    life: 'idle',
    activeRunId: null,
    activeRunStartedAt: null,
    liveSpellStartedAt: null,
    outcome: null,
    parentThreadId,
    name: id,
    agentId: 'tagma',
    harness: null,
    phase: null,
    readerOrderAt: new Date(Date.UTC(2026, 0, 1, 0, order)).toISOString(),
    pinnedAt: null,
    archivedAt: null,
    ...over,
  }) as unknown as ThreadListRow;

function filled(roots: number, widest: number): ThreadForest {
  const forest = new ThreadForest();
  for (let root = 0; root < roots; root += 1) forest.put(row(`root-${root}`, null, root));
  forest.put(row('lead', null, roots + 1, { life: 'working', activeRunId: 'run:lead', liveSpellStartedAt: '2026-01-01T00:00:00.000Z' }));
  for (let child = 0; child < widest; child += 1) forest.put(row(`leaf-${child}`, 'lead', child % 500));
  return forest;
}

function changing(forest: ThreadForest): () => void {
  let turn = 0;
  return () => {
    turn += 1;
    forest.put(row('leaf-1', 'lead', 1, { updatedAt: String(turn) } as never));
  };
}

function seconds(work: () => void): number {
  const started = performance.now();
  for (let round = 0; round < ROUNDS; round += 1) work();
  return performance.now() - started;
}

const narrow = seconds(changing(filled(500, 5)));
const broad = seconds(changing(filled(500, 500)));
if (broad > narrow * WIDTH_BUDGET) {
  throw new Error(`one change under 500 siblings cost ${(broad / narrow).toFixed(1)}x one under 5 (budget ${WIDTH_BUDGET}x)`);
}

describe('one thread changes in a list of 1000 threads', () => {
  const few = changing(filled(500, 5));
  const many = changing(filled(500, 500));
  bench('under 5 siblings', few);
  bench('under 500 siblings', many);
});
