import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import { makeStorage } from '@runlith/layer/testing';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { expect, test } from 'vitest';
import { ReaderMarks } from '$lib/shared/reading/ReaderMarks.svelte.js';
import { groupLines, LineCache, threadLines } from './columnLines.js';
import { ThreadForest, threadTree } from './forest.js';
import { ThreadFolds } from './threadFolds.svelte.js';

const NOW = '2026-01-01T02:00:00.000Z';

const row = (id: string, parentThreadId: string | null, over: Partial<ThreadListRow> = {}): ThreadListRow =>
  ({
    id,
    projectId: 1,
    title: id,
    name: id,
    agentId: 'tagma',
    life: 'idle',
    activeRunId: null,
    activeRunStartedAt: null,
    liveSpellStartedAt: null,
    outcome: null,
    harness: null,
    phase: null,
    parentThreadId,
    readerOrderAt: NOW,
    pinnedAt: null,
    archivedAt: null,
    ...over,
  }) as unknown as ThreadListRow;

const working = (id: string): ThreadListRow =>
  row(id, 'lead', { life: 'working', activeRunId: `run-${id}`, activeRunStartedAt: NOW, liveSpellStartedAt: NOW });

const done = (id: string): ThreadListRow =>
  row(id, 'lead', {
    outcome: {
      runId: `run-${id}`,
      status: 'completed',
      failureReason: null,
      failure: null,
      hostStateFailure: false,
      finishedAt: NOW,
      isSeen: false,
    },
  });

test('finished children wait behind one stub and working ones past five behind another, each opened by its fold', () => {
  const busy = ['w0', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
  const [lead] = threadTree([row('lead', null), done('d0'), ...busy.map(working), done('d1')]);
  const folds = new ThreadFolds({ tileId: 1 }, new ReaderMarks(makeStorage()));
  const draw = () =>
    threadLines(
      lead as NonNullable<typeof lead>,
      { folds, activeId: null, filtering: false },
      { depth: 0, decor: 'shelf', drop: 'loose' },
    ).map((line) => line.key);

  expect(draw()).toEqual(['lead', 'w0', 'w1', 'w2', 'w3', 'w4', 'stub:more-working:lead', 'stub:finished:lead']);

  folds.toggleMore('lead');
  expect(draw()).toEqual(['lead', ...busy, 'stub:more-working:lead', 'stub:finished:lead']);

  folds.toggleStub('lead');
  expect(draw()).toEqual(['lead', ...busy, 'stub:more-working:lead', 'stub:finished:lead', 'd0', 'd1']);
});

test('pinned finished children stand after every working fold and before the finished one, which an unpinning drag keeps even when empty', () => {
  const busy = ['w0', 'w1', 'w2', 'w3', 'w4', 'w5'];
  const [lead] = threadTree([row('lead', null), ...busy.map(working), { ...done('kept'), pinnedAt: NOW }, done('d0')]);
  const [alone] = threadTree([row('lead', null), { ...done('kept'), pinnedAt: NOW }]);
  const folds = new ThreadFolds({ tileId: 1 }, new ReaderMarks(makeStorage()));
  const draw = (node: typeof lead, unpinning: string | null = null) =>
    threadLines(
      node as NonNullable<typeof node>,
      { folds, activeId: null, filtering: false, unpinning },
      { depth: 0, decor: 'shelf', drop: 'loose' },
    ).map((line) => line.key);

  expect(draw(lead)).toEqual(['lead', 'w0', 'w1', 'w2', 'w3', 'w4', 'stub:more-working:lead', 'kept', 'stub:finished:lead']);
  expect(draw(alone)).toEqual(['lead', 'kept']);
  expect(draw(alone, 'lead')).toEqual(['lead', 'kept', 'stub:finished:lead']);
});

test('an idle ancestor stays visible until its whole subtree is idle and returns when a descendant wakes', () => {
  const forest = new ThreadForest();
  for (const held of [row('lead', null), done('middle'), row('leaf', 'middle')]) forest.put(held);
  const folds = new ThreadFolds({ tileId: 1 }, new ReaderMarks(makeStorage()));
  const cache = new LineCache();
  const draw = () =>
    threadLines(forest.node('lead')!, { folds, activeId: null, filtering: false, cache }, { depth: 0, decor: 'shelf', drop: 'loose' }).map(
      (line) => line.key,
    );

  expect(draw()).toEqual(['lead', 'stub:finished:lead']);
  for (const life of ['working', 'awaiting', 'stalled', 'idle', 'working', 'idle'] as const) {
    forest.put(
      row('leaf', 'middle', {
        life,
        activeRunId: life === 'idle' ? null : 'run-leaf',
        activeRunStartedAt: life === 'idle' ? null : NOW,
        liveSpellStartedAt: life === 'idle' ? null : NOW,
      }),
    );
    expect(draw()).toEqual(life === 'idle' ? ['lead', 'stub:finished:lead'] : ['lead', 'middle', 'leaf']);
  }
});

test('a closed parent draws no child lines, and a filter draws every child whatever the folds say', () => {
  const [lead] = threadTree([row('lead', null), working('w0'), done('d0')]);
  const folds = new ThreadFolds({ tileId: 1 }, new ReaderMarks(makeStorage()));
  folds.toggle('lead');
  const place = { depth: 0, decor: 'shelf', drop: 'loose' } as const;
  const node = lead as NonNullable<typeof lead>;

  expect(threadLines(node, { folds, activeId: null, filtering: false }, place).map((line) => line.key)).toEqual(['lead']);
  expect(threadLines(node, { folds, activeId: null, filtering: true }, place).map((line) => line.key)).toEqual(['lead', 'w0', 'd0']);
});

test('a worktree being created heads its members in the same line index the keyboard and the reveal walk', () => {
  const [member] = threadTree([row('member', null)]);
  const folds = new ThreadFolds({ tileId: 1 }, new ReaderMarks(makeStorage()));
  const creation = {
    id: 'c1',
    label: 'feature',
    phase: 'checkout',
    problem: null,
    retry: null,
    rootId: null,
    threadId: null,
    threadName: null,
  } as const;
  const grouping = {
    groups: [],
    nowhere: [],
    creating: new Map([['c1', [member as NonNullable<typeof member>]]]),
    away: new Map(),
    crumbs: new Map(),
    groupOf: new Map(),
  };

  const lines = groupLines(grouping, { folds, activeId: null, filtering: false }, '', modelCatalog([]), () => true, [creation]);

  expect(lines.map((line) => line.key)).toEqual(['creating:c1', 'member']);
});

test('a change under one parent rebuilds the lines of its path and hands back the very lines of every other subtree', () => {
  const forest = new ThreadForest();
  for (const held of [row('lead', null), working('a'), working('b'), { ...working('a1'), parentThreadId: 'a' }]) forest.put(held);
  const folds = new ThreadFolds({ tileId: 1 }, new ReaderMarks(makeStorage()));
  const cache = new LineCache();
  const draw = () =>
    threadLines(
      forest.node('lead') as NonNullable<ReturnType<typeof forest.node>>,
      { folds, activeId: null, filtering: false, cache },
      { depth: 0, decor: 'shelf', drop: 'loose' },
    );
  const before = draw();

  forest.put({ ...(forest.row('a1') as ThreadListRow), title: 'renamed' });
  const after = draw();

  const byKey = (lines: readonly { readonly key: string }[]) => new Map(lines.map((line) => [line.key, line]));
  expect(after.map((line) => line.key)).toEqual(before.map((line) => line.key));
  expect(byKey(after).get('b')).toBe(byKey(before).get('b'));
  expect(byKey(after).get('a1')).not.toBe(byKey(before).get('a1'));
  expect(byKey(after).get('lead')).not.toBe(byKey(before).get('lead'));

  folds.toggle('a');
  expect(draw().map((line) => line.key)).toEqual(['lead', 'b', 'a']);
});
