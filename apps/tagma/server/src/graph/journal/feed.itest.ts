import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Fiber, Queue } from 'effect';
import { block } from '../store/tables.js';
import { batchDocument } from '../contract/wire/batch.js';
import type { GraphFrame } from '../contract/service/journal.js';
import type { TreeBlock } from '../contract/wire/rows.js';
import { blockIdentity, blockName } from '../contract/wire/references.js';
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
        const { graph, projectId, root } = demo;
        const rootName = yield* demo.nameOf(root);
        const feed = yield* watch(graph, projectId);
        yield* graph.batch.apply(
          batchDocument([
            { op: 'create', $id: 's', tags: ['spec'], title: 'spec', parentId: rootName },
            { op: 'create', tags: ['task'], title: 'task', parentId: rootName, edges: [{ kind: 'implements', to: '$s' }] },
          ]),
          projectId,
        );
        yield* feed.change(1);

        const refusal = yield* demo.refusal(
          graph.batch.apply(
            batchDocument([
              { op: 'create', tags: ['task'], title: 'rolled back', parentId: rootName },
              { op: 'update', id: 'deadbeef', title: 'no such block' },
            ]),
            projectId,
          ),
        );
        expect(refusal.code).toBe('not-found');

        const after = yield* demo.nameOf((yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'after', parentId: root })).id);
        expect((yield* feed.change(2)).blocks.map((row) => row.name)).toEqual([after]);
        expect(feed.frames).toHaveLength(2);
      }),
    ),
  );

  it.effect('a frame names the session behind the write, born after the subscriber attached', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const feed = yield* watch(graph, projectId);
        yield* demo.as('late-arrival', graph.blocks.create({ projectId, tags: ['idea'], title: 'signed', parentId: root }));

        const frame = yield* feed.change(1);
        expect(frame.sessions.map((row) => `${row.harness}:${row.key}`)).toEqual(['test:late-arrival']);
        expect(frame.sessions.map((row) => row.id)).toContain(frame.events.at(-1)?.sessionId as number);
      }),
    ),
  );

  it.effect('one commit publishes one change to the touched project, rows read post-commit', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const rootName = yield* demo.nameOf(root);
        const other = (yield* graph.projectLifecycle.create({ name: 'other', rootPath: yield* demo.fixture.directory('other') })).id;
        const otherRoot = (yield* graph.blocks.rootBlockOf(other)).id;
        const mine = yield* watch(graph, projectId);
        const theirs = yield* watch(graph, other);
        const result = yield* graph.batch.apply(
          batchDocument([
            { op: 'create', $id: 'a', tags: ['idea'], title: 'first', body: 'see [[$b]]', parentId: rootName },
            { op: 'create', $id: 'b', tags: ['idea'], title: 'second', parentId: rootName },
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
        expect(change.refs).toEqual([
          {
            fromName: a as string,
            toName: b as string,
            fromIdentity: result.identities.a!,
            toIdentity: result.identities.b!,
            fromRowKey: change.blocks.find((row) => row.identity === result.identities.a)!.rowKey,
            toRowKey: change.blocks.find((row) => row.identity === result.identities.b)!.rowKey,
          },
        ]);

        const there = yield* demo.nameOf(
          (yield* graph.blocks.create({ projectId: other, tags: ['idea'], title: 'there', parentId: otherRoot })).id,
        );
        expect((yield* theirs.change(1)).blocks.map((row) => row.name)).toEqual([there]);
        expect(mine.frames).toHaveLength(1);
      }),
    ),
  );

  it.effect('one commit touching two projects gives each its own rows and sets', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const other = (yield* graph.projectLifecycle.create({ name: 'other', rootPath: yield* demo.fixture.directory('other') })).id;
        const otherRoot = (yield* graph.blocks.rootBlockOf(other)).id;
        const here = yield* demo.nameOf((yield* graph.blocks.create({ projectId, tags: ['task'], title: 'here', parentId: root })).id);
        const there = yield* demo.nameOf(
          (yield* graph.blocks.create({ projectId: other, tags: ['task'], title: 'there', parentId: otherRoot })).id,
        );
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
        const { graph, projectId, root } = demo;
        const unwatched = (yield* graph.blocks.create({ projectId, tags: ['task'], title: 'nobody watching', parentId: root })).id;
        const first = yield* watch(graph, projectId);
        expect(first.frames).toHaveLength(0);
        const watched = (yield* graph.blocks.create({ projectId, tags: ['task'], title: 'watched', parentId: root })).id;
        expect((yield* first.change(1)).blocks.map((row) => row.name)).toEqual([yield* demo.nameOf(watched)]);

        first.stop();
        yield* graph.blocks.create({ projectId, tags: ['task'], title: 'between subscribers', parentId: root });
        const second = yield* watch(graph, projectId);
        const last = (yield* graph.blocks.create({ projectId, tags: ['task'], title: 'after the gap', parentId: root })).id;
        const frame = yield* second.change(1);
        expect(frame.blocks.map((row) => row.name)).toEqual([yield* demo.nameOf(last)]);
        expect(frame.events.map((entry) => entry.blockName)).not.toContain(yield* demo.nameOf(unwatched));
      }),
    ),
  );

  it.effect('link ships the rows and the edge of both endpoints', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const spec = (yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'spec', parentId: root })).id;
        const task = (yield* graph.blocks.create({ projectId, tags: ['task'], title: 'task', parentId: root })).id;
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
        const { graph, projectId, root } = demo;
        const oldSpec = (yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'old', parentId: root })).id;
        const newSpec = (yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'new', parentId: root })).id;
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
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const before = (yield* graph.graphStore.db.select({ id: block.id }).from(block)).length;
        const outside = yield* Effect.context<never>();
        const scope = yield* Effect.scope;
        const writing = yield* graph.units.write('GraphFeed', (unit) =>
          Effect.gen(function* () {
            const writing = yield* Effect.forkIn(
              Effect.updateContext(
                graph.blocks.create({ projectId, tags: ['task'], title: 'after a foreign unit', parentId: root }),
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
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const feed = yield* watch(graph, projectId);
        yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'an ordinary node', parentId: root });
        expect((yield* feed.nth(1)).type).toBe('change');
        yield* graph.blocks.create({
          projectId,
          tags: ['tag'],
          title: '#invoice',
          body: 'what somebody owes',
          parentId: root,
          fields: { id: 'invoice', fields: { total: 'number' } },
        });
        expect((yield* feed.nth(2)).type).toBe('resync');
      }),
    ),
  );

  it.effect('departure and arrival publish every renamed row in its own graph', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
        const target = (yield* graph.projectLifecycle.create({ name: 'target', rootPath: yield* demo.fixture.directory('target') })).id;
        const other = (yield* graph.projectLifecycle.create({ name: 'other', rootPath: yield* demo.fixture.directory('other') })).id;
        const targetRoot = yield* graph.blocks.rootBlockOf(target);
        const otherRoot = yield* graph.blocks.rootBlockOf(other);
        const sourceRoot = yield* graph.blocks.rootBlockOf(projectId);
        const parent = yield* graph.blocks.create({ projectId, parentId: root, title: 'parent' });
        const child = yield* graph.blocks.create({ projectId, parentId: parent.id, title: 'child' });
        const source = yield* watch(graph, projectId);
        yield* graph.trash.depart({ id: parent.id, to: { graph: targetRoot.uuid, label: targetRoot.title } });
        const departed = yield* source.change(1);
        expect(departed.blocks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ rowKey: parent.id, deletedAt: expect.any(String) }),
            expect.objectContaining({ rowKey: child.id, deletedAt: expect.any(String) }),
          ]),
        );
        expect(departed.blocks.find((row) => row.rowKey === parent.id)?.identity).not.toBe(blockIdentity(parent.uuid));
        expect(departed.blocks.find((row) => row.rowKey === child.id)?.identity).not.toBe(blockIdentity(child.uuid));

        const waiting = yield* watch(graph, other);
        const old = yield* graph.blocks.create({ projectId: other, parentId: otherRoot.id, title: 'old trash', uuid: parent.uuid });
        yield* waiting.change(1);
        yield* graph.trash.delete({ id: old.id });
        yield* waiting.change(2);
        const arriving = yield* watch(graph, target);
        const carried = (row: typeof parent, parentUuid: string | null) => ({
          uuid: row.uuid,
          parent: parentUuid,
          ord: row.ord,
          title: row.title,
          body: row.body,
          tags: row.tags,
          fields: row.fields,
          sessions: [],
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          sources: [],
          links: [],
          far: [],
        });
        yield* graph.blocks.arrive({
          projectId: target,
          parentId: targetRoot.id,
          from: sourceRoot.uuid,
          blocks: [carried(parent, null), carried(child, parent.uuid)],
        });
        const born = yield* arriving.change(1);
        yield* graph.blocks.create({ projectId: target, parentId: targetRoot.id, title: 'after arrival' });
        yield* arriving.change(2);
        expect(waiting.frames).toHaveLength(3);
        const renamed = yield* waiting.change(3);
        const replaced = renamed.blocks.find((row) => row.rowKey === old.id);
        expect(replaced?.identity).not.toBe(blockIdentity(old.uuid));
        expect(renamed.trash).toEqual([expect.objectContaining({ rowKey: old.id, identity: replaced?.identity })]);
        expect(born.blocks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ identity: blockIdentity(parent.uuid) }),
            expect.objectContaining({ identity: blockIdentity(child.uuid), parentIdentity: blockIdentity(parent.uuid) }),
          ]),
        );
      }),
    ),
  );

  it.effect('a subscriber applying every change holds the frontier and the trash a full read answers', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId, root } = demo;
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

        const blocker = (yield* step(graph.blocks.create({ projectId, tags: ['task'], title: 'blocker', parentId: root }))).id;
        const waiter = (yield* step(graph.blocks.create({ projectId, tags: ['task'], title: 'waiter', parentId: root }))).id;
        yield* step(graph.edges.link({ fromId: waiter, kind: 'waits-on', toId: blocker }));
        expect(ready.has(yield* demo.nameOf(waiter))).toBe(false);
        yield* step(graph.tasks.finish({ id: blocker }));
        expect(ready.has(yield* demo.nameOf(waiter))).toBe(true);

        const parent = (yield* step(graph.blocks.create({ projectId, tags: ['task'], title: 'parent', parentId: root }))).id;
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
