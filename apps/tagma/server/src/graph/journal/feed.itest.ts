import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Fiber, Queue } from 'effect';
import { block } from '../store/tables.js';
import { batchDocument } from '../contract/wire/batch.js';
import type { GraphFrame } from '../contract/service/journal.js';
import type { TreeBlock } from '../contract/wire/rows.js';
import { blockName } from '../contract/wire/references.js';
import { wireTreeBlock } from '../reading/rows.js';
import { demoGraphLayer, type DemoOwners, withDemo } from '../../composition/testing/graphFixture.js';

type Change = Extract<GraphFrame, { type: 'change' }>;

const watch = Effect.fnUntraced(function* (graph: DemoOwners, id: number) {
  const frames: GraphFrame[] = [];
  const arrived = yield* Queue.unbounded<GraphFrame>();
  const stop = yield* graph.feed.subscribe(id, (frame) => {
    frames.push(frame);
    Queue.offerUnsafe(arrived, frame);
  });
  yield* Effect.addFinalizer(() => Effect.sync(stop));
  const nth = Effect.fnUntraced(function* (count: number) {
    while (frames.length < count) yield* Queue.take(arrived);
    return frames[count - 1]!;
  });
  const change = Effect.fnUntraced(function* (count: number): Effect.fn.Return<Change> {
    const frame = yield* nth(count);
    if (frame.type === 'change') return frame;
    return yield* Effect.die(`frame ${count} is a ${frame.type}`);
  });
  return { frames, stop, nth, change };
});

layer(demoGraphLayer(), { excludeTestServices: true })('graph feed', (it) => {
  it.effect('a batch publishes one frame per commit and nothing at all when it is refused', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const feed = yield* watch(graph, projectId);
        yield* graph.batch.apply(
          batchDocument([
            { op: 'create', $id: 's', tags: ['spec'], title: 'spec' },
            { op: 'create', tags: ['task'], title: 'task', edges: [{ kind: 'implements', to: '$s' }] },
          ]),
          projectId,
        );
        yield* feed.change(1);

        const refusal = yield* demo.refusal(
          graph.batch.apply(
            batchDocument([
              { op: 'create', tags: ['task'], title: 'rolled back' },
              { op: 'update', id: 'deadbeef', title: 'no such block' },
            ]),
            projectId,
          ),
        );
        expect(refusal.code).toBe('not-found');

        const after = yield* demo.nameOf((yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'after' })).id);
        expect((yield* feed.change(2)).blocks.map((row) => row.name)).toEqual([after]);
        expect(feed.frames).toHaveLength(2);
      }),
    ),
  );

  it.effect('a frame names the session behind the write, born after the subscriber attached', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const feed = yield* watch(graph, projectId);
        yield* demo.as('late-arrival', graph.blocks.create({ projectId, tags: ['idea'], title: 'signed' }));

        const frame = yield* feed.change(1);
        expect(frame.sessions.map((row) => `${row.harness}:${row.key}`)).toEqual(['test:late-arrival']);
        expect(frame.sessions.map((row) => row.id)).toContain(frame.events.at(-1)?.sessionId as number);
      }),
    ),
  );

  it.effect('one commit publishes one change to the touched project, rows read post-commit', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const other = (yield* graph.projectLifecycle.create({ name: 'other', rootPath: yield* demo.fixture.directory('other') })).id;
        const mine = yield* watch(graph, projectId);
        const theirs = yield* watch(graph, other);
        const result = yield* graph.batch.apply(
          batchDocument([
            { op: 'create', $id: 'a', tags: ['idea'], title: 'first', body: 'see [[$b]]' },
            { op: 'create', $id: 'b', tags: ['idea'], title: 'second' },
          ]),
          projectId,
        );

        const change = yield* mine.change(1);
        const a = result.ids.a;
        const b = result.ids.b;
        expect(change.projectId).toBe(projectId);
        expect(change.blocks.some((row) => row.name === a || row.name === b)).toBe(true);
        expect(change.events.some((entry) => entry.blockName === a && entry.op === 'update')).toBe(true);
        expect(change.events.map((entry) => entry.op)).toContain('create');
        expect(change.refs).toEqual([{ fromName: a as string, toName: b as string }]);

        const there = yield* demo.nameOf((yield* graph.blocks.create({ projectId: other, tags: ['idea'], title: 'there' })).id);
        expect((yield* theirs.change(1)).blocks.map((row) => row.name)).toEqual([there]);
        expect(mine.frames).toHaveLength(1);
      }),
    ),
  );

  it.effect('one commit touching two projects gives each its own rows and sets', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const other = (yield* graph.projectLifecycle.create({ name: 'other', rootPath: yield* demo.fixture.directory('other') })).id;
        const here = yield* demo.nameOf((yield* graph.blocks.create({ projectId, tags: ['task'], title: 'here' })).id);
        const there = yield* demo.nameOf((yield* graph.blocks.create({ projectId: other, tags: ['task'], title: 'there' })).id);
        const mine = yield* watch(graph, projectId);
        const theirs = yield* watch(graph, other);
        yield* graph.batch.apply(
          batchDocument([
            { op: 'update', id: here, body: 'touched from one document' },
            { op: 'update', id: there, body: 'touched from the same document' },
          ]),
          projectId,
        );

        const ours = yield* mine.change(1);
        const foreign = yield* theirs.change(1);
        expect(ours.blocks.map((row) => row.name)).toEqual([here]);
        expect(foreign.blocks.map((row) => row.name)).toEqual([there]);
        expect(ours.ready).toEqual([here]);
        expect(foreign.ready).toEqual([there]);
      }),
    ),
  );

  it.effect('writes committed with nobody attached are neither replayed nor stall the feed', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const unwatched = (yield* graph.blocks.create({ projectId, tags: ['task'], title: 'nobody watching' })).id;
        const first = yield* watch(graph, projectId);
        expect(first.frames).toHaveLength(0);
        const watched = (yield* graph.blocks.create({ projectId, tags: ['task'], title: 'watched' })).id;
        expect((yield* first.change(1)).blocks.map((row) => row.name)).toEqual([yield* demo.nameOf(watched)]);

        first.stop();
        yield* graph.blocks.create({ projectId, tags: ['task'], title: 'between subscribers' });
        const second = yield* watch(graph, projectId);
        const last = (yield* graph.blocks.create({ projectId, tags: ['task'], title: 'after the gap' })).id;
        const frame = yield* second.change(1);
        expect(frame.blocks.map((row) => row.name)).toEqual([yield* demo.nameOf(last)]);
        expect(frame.events.map((entry) => entry.blockName)).not.toContain(yield* demo.nameOf(unwatched));
      }),
    ),
  );

  it.effect('link ships the rows and the edge of both endpoints', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const spec = (yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'spec' })).id;
        const task = (yield* graph.blocks.create({ projectId, tags: ['task'], title: 'task' })).id;
        const feed = yield* watch(graph, projectId);
        yield* graph.edges.link({ fromId: task, kind: 'implements', toId: spec });

        const change = yield* feed.change(1);
        const specName = yield* demo.nameOf(spec);
        const taskName = yield* demo.nameOf(task);
        expect(change.blocks.map((row) => row.name).toSorted()).toEqual([specName, taskName].toSorted());
        expect(change.edges.map((edge) => [edge.fromName, edge.kind, edge.toName])).toEqual([[taskName, 'implements', specName]]);
      }),
    ),
  );

  it.effect('supersede ships one entry and the rows of both blocks', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const oldSpec = (yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'old' })).id;
        const newSpec = (yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'new' })).id;
        const oldName = yield* demo.nameOf(oldSpec);
        const feed = yield* watch(graph, projectId);
        yield* graph.standing.supersede({ oldId: oldSpec, withId: newSpec });

        const change = yield* feed.change(1);
        expect(change.events.map((entry) => entry.op)).toEqual(['supersede']);
        expect(change.blocks.map((row) => row.name).toSorted()).toEqual(
          [yield* demo.nameOf(oldSpec), yield* demo.nameOf(newSpec)].toSorted(),
        );
        expect(change.blocks.find((row) => row.name === oldName)?.superseded).toBe(true);
      }),
    ),
  );

  it.effect('a graph write started inside a thread unit waits for it and then lands', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const before = (yield* graph.graphStore.db.select({ id: block.id }).from(block)).length;
        const outside = yield* Effect.context<never>();
        const scope = yield* Effect.scope;
        const writing = yield* graph.units.write('GraphFeed', (unit) =>
          Effect.gen(function* () {
            const writing = yield* Effect.forkIn(
              Effect.updateContext(
                graph.blocks.create({ projectId, tags: ['task'], title: 'after a foreign unit' }),
                (_: Context.Context<never>) => outside,
              ),
              scope,
            );
            const rows = yield* unit.run(graph.graphStore.db.select({ id: block.id }).from(block));
            expect(rows.length).toBe(before);
            return writing;
          }),
        );

        expect((yield* Fiber.join(writing)).id).toBeGreaterThan(0);
        expect((yield* graph.ranking.search({ query: 'foreign', projectId })).items).toHaveLength(1);
      }),
    ),
  );

  it.effect('a write that moves a declaration resyncs the subscriber, and an ordinary write changes it', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const feed = yield* watch(graph, projectId);
        yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'an ordinary node' });
        expect((yield* feed.nth(1)).type).toBe('change');
        yield* graph.blocks.create({
          projectId,
          tags: ['tag'],
          title: '#invoice',
          body: 'what somebody owes',
          fields: { id: 'invoice', fields: { total: 'number' } },
        });
        expect((yield* feed.nth(2)).type).toBe('resync');
      }),
    ),
  );

  it.effect('a subscriber applying every change holds the frontier and the trash a full read answers', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const ready = new Set((yield* graph.selection.ready({ projectId })).map((row) => blockName(row.uuid)));
        const trash = new Map((yield* graph.trash.roots(projectId)).map((row) => [blockName(row.uuid), wireTreeBlock(row)]));
        const feed = yield* watch(graph, projectId);
        let seen = 0;
        const step = Effect.fnUntraced(function* <A, E, R>(write: Effect.Effect<A, E, R>) {
          const result = yield* write;
          const change = yield* feed.change(++seen);
          const names = new Set(change.blocks.map((row) => row.name));
          for (const name of names) ready.delete(name);
          for (const name of change.ready) ready.add(name);
          for (const [name, row] of trash)
            if (names.has(name) || (row.parentName !== null && names.has(row.parentName))) trash.delete(name);
          for (const row of change.trash) trash.set(row.name, row as TreeBlock);
          expect([...ready].toSorted()).toEqual((yield* graph.selection.ready({ projectId })).map((row) => blockName(row.uuid)).toSorted());
          expect([...trash.keys()].toSorted()).toEqual((yield* graph.trash.roots(projectId)).map((row) => blockName(row.uuid)).toSorted());
          return result;
        });

        const blocker = (yield* step(graph.blocks.create({ projectId, tags: ['task'], title: 'blocker' }))).id;
        const waiter = (yield* step(graph.blocks.create({ projectId, tags: ['task'], title: 'waiter' }))).id;
        yield* step(graph.edges.link({ fromId: waiter, kind: 'waits-on', toId: blocker }));
        expect(ready.has(yield* demo.nameOf(waiter))).toBe(false);
        yield* step(graph.tasks.finish({ id: blocker }));
        expect(ready.has(yield* demo.nameOf(waiter))).toBe(true);

        const parent = (yield* step(graph.blocks.create({ projectId, tags: ['task'], title: 'parent' }))).id;
        const child = (yield* step(graph.blocks.create({ projectId, tags: ['task'], title: 'child', parentId: parent }))).id;
        yield* step(graph.trash.delete({ id: child }));
        yield* step(graph.trash.delete({ id: parent }));
        expect([...trash.keys()]).not.toContain(yield* demo.nameOf(child));
        yield* step(graph.trash.restore({ id: parent }));
        expect([...trash.keys()]).toContain(yield* demo.nameOf(child));
      }),
    ),
  );
});
