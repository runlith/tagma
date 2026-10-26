import { Clock, Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../../composition/testing/graphFixture.js';
import { event } from '../../store/tables.js';
import { batchDocument } from '../../contract/wire/batch.js';

type Extra = { parentId?: number; edges?: readonly { kind: string; to: number }[] };

const lens = (demo: EffectDemo) => {
  const make = (tag: string, title: string, extra: Extra = {}) =>
    Effect.map(demo.graph.blocks.create({ projectId: demo.projectId, tags: [tag], title, ...extra }), (row) => row.id);
  return { ...demo, make };
};

const withLens = <A, E, R>(body: (given: ReturnType<typeof lens>) => Effect.Effect<A, E, R>) => withDemo((demo) => body(lens(demo)));

layer(demoGraphLayer(), { excludeTestServices: true })('task endings', (it) => {
  it.effect('close (not needed) skips the spec gate; done is not for ideas', () =>
    withLens(({ graph, make, refusal, table }) =>
      Effect.gen(function* () {
        const tags = yield* table();
        const spec = yield* make('spec', 'spec');
        const impl = yield* make('task', 'impl', { edges: [{ kind: 'implements', to: spec }] });
        expect(tags.statusOf(yield* graph.tasks.close({ id: impl }))).toBe('closed');
        const idea = yield* make('idea', 'i');
        expect((yield* refusal(graph.tasks.finish({ id: idea }))).code).toBe('illegal-status');
        expect(tags.statusOf(yield* graph.tasks.close({ id: idea }))).toBe('closed');
      }),
    ),
  );

  it.effect('open child tasks block an agent’s ending of the parent, the operator’s batch passes, and a trashed child blocks nothing', () =>
    withLens(({ graph, make, nameOf, projectId, refusal, table }) =>
      Effect.gen(function* () {
        const tags = yield* table();
        const parent = yield* make('task', 'parent');
        yield* make('task', 'child', { parentId: parent });
        const closing = batchDocument([{ op: 'close', id: yield* nameOf(parent) }]);
        expect((yield* refusal(graph.tasks.finish({ id: parent }))).code).toBe('open-children');
        expect((yield* refusal(graph.batch.apply(closing, projectId))).code).toBe('open-children');
        yield* graph.batch.apply(closing, projectId, true);
        expect(tags.statusOf(yield* graph.blocks.blockById(parent))).toBe('closed');
        const other = yield* make('task', 'other parent');
        yield* graph.trash.delete({ id: yield* make('task', 'trashed child', { parentId: other }) });
        expect(tags.statusOf(yield* graph.tasks.finish({ id: other }))).toBe('done');
      }),
    ),
  );

  it.effect('a close carries its cause, and a done carries its commit into the ending it answers with', () =>
    withLens(({ graph, make }) =>
      Effect.gen(function* () {
        const idea = yield* make('idea', 'friction');
        yield* graph.tasks.close({ id: idea, reason: 'fixed at the owner' });
        expect((yield* graph.reading.show(idea, 0)).ending).toMatchObject({ status: 'closed', reason: 'fixed at the owner' });
        const work = yield* make('task', 'work');
        yield* graph.tasks.claim({ id: work });
        yield* graph.tasks.finish({ id: work, commit: 'abc1234' });
        expect((yield* graph.reading.show(work, 0)).ending).toMatchObject({ status: 'done', reason: null, commit: 'abc1234' });
        const bare = yield* make('task', 'work with no commit');
        yield* graph.tasks.claim({ id: bare });
        yield* graph.tasks.finish({ id: bare });
        expect((yield* graph.reading.show(bare, 0)).ending).toMatchObject({ commit: null });
        const dropped = yield* make('task', 'dropped work');
        yield* graph.tasks.close({ id: dropped, reason: 'not needed' });
        expect((yield* graph.reading.show(dropped, 0)).ending?.commit).toBeUndefined();
      }),
    ),
  );

  it.effect('an open task nobody holds finishes with no claim before it', () =>
    withLens(({ graph, make, as, table }) =>
      Effect.gen(function* () {
        const tags = yield* table();
        const done = yield* as('a', graph.tasks.finish({ id: yield* make('task', 'task') }));
        expect(tags.statusOf(done)).toBe('done');
        expect(tags.holderOf(done)).toBeNull();
        const other = yield* make('task', 'other');
        expect(tags.statusOf(yield* as('a', graph.tasks.close({ id: other, reason: 'not needed' })))).toBe('closed');
      }),
    ),
  );

  it.effect('a task another session holds is held elsewhere for everyone but its holder, and ends from outside', () =>
    withLens(({ graph, make, as, nameOf, table }) =>
      Effect.gen(function* () {
        const tags = yield* table();
        const finished = yield* make('task', 'finished from outside');
        const closed = yield* make('task', 'closed from outside');
        yield* as('a', graph.tasks.claim({ id: finished }));
        yield* as('a', graph.tasks.claim({ id: closed }));
        const row = yield* graph.blocks.blockById(finished);
        const name = yield* nameOf(finished);
        expect(yield* as('a', graph.tasks.heldElsewhere(row))).toBeNull();
        expect(yield* as('b', graph.tasks.heldElsewhere(row))).toMatchObject({ name });
        expect(yield* graph.tasks.heldElsewhere(row)).toMatchObject({ name });
        expect(tags.statusOf(yield* as('b', graph.tasks.finish({ id: finished })))).toBe('done');
        expect(tags.statusOf(yield* as('b', graph.tasks.close({ id: closed, reason: 'not needed' })))).toBe('closed');
      }),
    ),
  );

  it.effect('a task the operator holds ends from a signed session', () =>
    withLens(({ graph, make, as, table }) =>
      Effect.gen(function* () {
        const id = yield* make('task', 'task');
        yield* graph.tasks.claim({ id });
        expect(yield* as('a', graph.tasks.heldElsewhere(yield* graph.blocks.blockById(id)))).not.toBeNull();
        expect((yield* table()).statusOf(yield* as('a', graph.tasks.finish({ id })))).toBe('done');
      }),
    ),
  );

  it.effect('an ending whose journal row cannot be read says so instead of reading as an ending with no reason', () =>
    withLens(({ graph, make }) =>
      Effect.gen(function* () {
        const id = yield* make('task', 'damaged ending');
        yield* graph.tasks.close({ id, reason: 'not needed' });
        const ts = new Date(yield* Clock.currentTimeMillis);
        yield* graph.graphStore.db.insert(event).values({ ts, op: 'close', blockId: id, payload: '{"reason":"nobody"' });
        const ending = (yield* graph.reading.show(id, 0)).ending;
        expect(ending?.status).toBe('closed');
        expect(ending?.unreadable).toContain('journal event');
        expect(ending?.reason).toBeNull();
      }),
    ),
  );

  it.effect('a closed idea or spec and a done or closed task reopen by a plain status write, and close again after', () =>
    withLens(({ graph, make, table }) =>
      Effect.gen(function* () {
        const tags = yield* table();
        const idea = yield* make('idea', 'reopened idea');
        const decided = yield* make('spec', 'reopened spec');
        const finished = yield* make('task', 'finished work');
        const dropped = yield* make('task', 'dropped work');
        yield* graph.tasks.claim({ id: finished });
        yield* graph.tasks.finish({ id: finished });
        for (const id of [idea, decided, dropped]) yield* graph.tasks.close({ id, reason: 'not now' });
        for (const id of [idea, decided, finished, dropped]) {
          yield* graph.blocks.update({ id, status: 'open' });
          const reopened = yield* graph.blocks.blockById(id);
          expect(tags.statusOf(reopened)).toBe('open');
          expect(tags.isTerminal(reopened)).toBe(false);
          expect((yield* graph.reading.show(id, 0)).ending).toBeNull();
          expect(tags.statusOf(yield* graph.tasks.close({ id, reason: 'again' }))).toBe('closed');
        }
      }),
    ),
  );

  it.effect('a held task still leaves work only through release_block, never a plain status write', () =>
    withLens(({ graph, make, refusal }) =>
      Effect.gen(function* () {
        const id = yield* make('task', 'held work');
        yield* graph.tasks.claim({ id });
        expect((yield* refusal(graph.blocks.update({ id, status: 'open' }))).code).toBe('status-operation');
      }),
    ),
  );
});
