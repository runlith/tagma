import { expect, test } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { journalBatches } from './eventLog.js';
import { type ActEntry } from '../contract/service/acts.js';
import { signedCall } from '../../invocation/testing/call.js';

function entries(rows: { id: number; op: ActEntry['op']; blockId: number; sessionId?: number }[]): ActEntry[] {
  return rows
    .map((row) => ({ sessionId: null, callId: null, projectId: null, ...row, ts: new Date(row.id), payload: '{}', act: null }))
    .sort((a, b) => b.id - a.id);
}

test('a run breaks on another writer taking the same block, not on interleaving', () => {
  const batches = journalBatches(
    entries([
      { id: 1, op: 'create', blockId: 10, sessionId: 1 },
      { id: 2, op: 'create', blockId: 20, sessionId: 2 },
      { id: 3, op: 'update', blockId: 10, sessionId: 1 },
      { id: 4, op: 'update', blockId: 10, sessionId: 2 },
      { id: 5, op: 'update', blockId: 10, sessionId: 2 },
    ]),
  );
  expect(batches.map((batch) => [batch.blockId, batch.sessionId, batch.entries])).toEqual([
    [10, 2, 2],
    [10, 1, 2],
    [20, 2, 1],
  ]);
  const first = batches[1];
  expect(first?.ops).toEqual(['create', 'update']);
  expect(first?.firstEventId).toBe(1);
  expect(first?.lastEventId).toBe(3);
});

test('batches come newest-first by last entry', () => {
  const rows = entries([
    { id: 1, op: 'create', blockId: 10 },
    { id: 2, op: 'create', blockId: 20 },
    { id: 3, op: 'update', blockId: 10 },
  ]);
  expect(journalBatches(rows).map((batch) => batch.blockId)).toEqual([10, 20]);
});

test('a blockless entry joins no batch', () => {
  const row: ActEntry = {
    id: 1,
    ts: new Date(1),
    sessionId: null,
    callId: null,
    projectId: null,
    op: 'project_remove',
    blockId: null,
    payload: '{}',
  };
  expect(journalBatches([row])).toEqual([]);
});

layer(demoGraphLayer(), { excludeTestServices: true })('graph journal', (it) => {
  it.effect('a journal window is cut by tag, session and op, and the groups intersect', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const area = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Area' });
        const doc = yield* graph.blocks.create({ projectId, parentId: area.id, tags: ['idea'], title: 'Doc' });
        const idea = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Idea' });
        yield* graph.blocks.update({ id: doc.id, title: 'Doc, renamed' });

        const blocksOf = (rows: { blockId: number | null }[]) => rows.map((row) => row.blockId);
        expect(blocksOf(yield* graph.journal.events({ projectId, tags: ['idea'] }))).toEqual([doc.id, idea.id, doc.id]);
        expect(blocksOf(yield* graph.journal.events({ projectId, ops: ['update'] }))).toEqual([doc.id]);
        expect(blocksOf(yield* graph.journal.events({ projectId, scopeId: area.id }))).toEqual([doc.id, doc.id, area.id]);

        const vocabulary = yield* graph.journal.vocabulary({ projectId });
        expect(vocabulary.ops).toEqual(['project_add', 'create', 'update']);
        expect(vocabulary.tags).toEqual(['tag', 'catalog', 'zone', 'idea']);
        expect((yield* graph.journal.vocabulary({ projectId, scopeId: area.id })).tags).toEqual(['zone', 'idea']);
      }),
    ),
  );

  it.effect('a call is identified beside the session that signed it, or as unsigned, never by its id alone', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const call = 'call-1';
        const mine = yield* demo.as('mine', signedCall(call)(graph.blocks.create({ projectId, tags: ['idea'], title: 'mine' })));
        const theirs = yield* demo.as('theirs', signedCall(call)(graph.blocks.create({ projectId, tags: ['idea'], title: 'theirs' })));
        const operators = yield* signedCall(call)(graph.blocks.create({ projectId, tags: ['idea'], title: 'operator' }));
        const entriesOf = Effect.fnUntraced(function* (key: string) {
          const session = yield* demo.as(
            key,
            Effect.flatMap(WriterRegister, (sessions) => sessions.idOf({ harness: 'test', key })),
          );
          return (yield* graph.journal.byCall(call, session!)).map((row) => row.blockId);
        });
        expect(yield* entriesOf('mine')).toEqual([mine.id]);
        expect(yield* entriesOf('theirs')).toEqual([theirs.id]);
        expect((yield* graph.journal.byCall(call, null)).map((row) => row.blockId)).toEqual([operators.id]);
      }),
    ),
  );

  it.effect('events page down with beforeId and a limit', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const ids: number[] = [];
        for (const n of [1, 2, 3]) ids.push((yield* graph.blocks.create({ projectId, tags: ['idea'], title: `t${n}` })).id);
        const all = yield* graph.journal.events({ projectId });
        const newest = all[0];
        expect(newest?.blockId).toBe(ids[2]);
        const page = yield* graph.journal.events({ projectId, beforeId: newest?.id, limit: 2 });
        expect(page.length).toBe(2);
        expect(page.every((row) => row.id < (newest?.id ?? 0))).toBe(true);
        expect(page[0]?.blockId).toBe(ids[1]);
        expect(page[1]?.blockId).toBe(ids[0]);
      }),
    ),
  );

  it.effect('the journal scopes by project through the touched block; trashed blocks testify, blockless entries show unscoped only', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const other = yield* graph.projectLifecycle.create({ name: 'other', rootPath: yield* demo.fixture.directory('other') });
        const mine = (yield* graph.blocks.create({ projectId, tags: ['task'], title: 'mine' })).id;
        const theirs = (yield* graph.blocks.create({ projectId: other.id, tags: ['task'], title: 'theirs' })).id;
        const scoped = yield* graph.journal.events({ projectId });
        expect(scoped.some((entry) => entry.blockId === mine)).toBe(true);
        expect(scoped.some((entry) => entry.blockId === theirs)).toBe(false);

        yield* graph.trash.delete({ id: mine });
        expect((yield* graph.journal.events({ projectId })).some((entry) => entry.op === 'delete' && entry.blockId === mine)).toBe(true);

        yield* graph.projectLifecycle.create({ name: 'gone', rootPath: yield* demo.fixture.directory('gone') });
        yield* graph.projectLifecycle.remove({ ref: 'gone' });
        expect((yield* graph.journal.events()).some((entry) => entry.op === 'project_remove')).toBe(true);
        expect((yield* graph.journal.events({ projectId })).some((entry) => entry.op === 'project_remove')).toBe(false);
      }),
    ),
  );
});
