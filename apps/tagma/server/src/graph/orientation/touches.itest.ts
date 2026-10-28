import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { bornThread } from '../../native-harness/testing/born.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { signedBy } from '../../invocation/testing/call.js';
import { Blocks } from '../contract/service/blocks.js';
import { Touches } from '../contract/service/orientation.js';
import { Tasks } from '../contract/service/work.js';
import { eq } from 'drizzle-orm';
import { block } from '../store/tables.js';
import { TRIGGERS } from '../testing/triggers.js';

const seen = (projectId: number, path: string, as: 'read' | 'wrote' | 'found') =>
  Effect.flatMap(Touches, (touches) => touches.touch({ projectId, shown: [{ path, as }] }));

const held = Effect.fnUntraced(function* (projectId: number, title: string) {
  const blocks = yield* Blocks;
  const { id } = yield* blocks.create({ projectId, parentId: (yield* blocks.rootBlockOf(projectId)).id, tags: ['task'], title });
  yield* (yield* Tasks).claim({ id });
  return id;
});

const rule = Effect.fnUntraced(function* (projectId: number, title: string, body: string, parentId?: number) {
  const blocks = yield* Blocks;
  return (yield* blocks.create({ projectId, tags: ['rule'], title, body, parentId: parentId ?? (yield* blocks.rootBlockOf(projectId)).id }))
    .id;
});

layer(demoGraphLayer(), { excludeTestServices: true })('touches', (it) => {
  it.effect('a touch follows every held task, a write survives a later read, and release retires the touch', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        yield* seen(projectId, 'src/x.ts', 'read');
        expect(yield* graph.touches.of({ projectId, place: 'src/x.ts' })).toEqual([]);
        const first = yield* held(projectId, 'first');
        const second = yield* held(projectId, 'second');
        yield* seen(projectId, 'src/x.ts', 'read');
        expect((yield* graph.touches.of({ projectId, place: 'src/x.ts' })).map((row) => row.task.id).sort()).toEqual(
          [first, second].sort(),
        );
        yield* graph.tasks.release({ id: first });
        expect((yield* graph.touches.of({ projectId, place: 'src/x.ts' })).map((row) => row.task.id)).toEqual([second]);
        yield* seen(projectId, 'src/x.ts', 'wrote');
        yield* seen(projectId, 'src/x.ts', 'read');
        expect(yield* graph.touches.of({ projectId, place: 'src/x.ts' })).toMatchObject([{ task: { id: second }, wrote: true }]);
      }),
    ),
  );

  it.effect('the holder on a file is named from the served graph’s machine store', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        yield* bornThread(
          graph.store.db,
          {
            ownerId: 'owner',
            agentId: 'tagma',
            provider: 'openai-oauth',
            model: 'gpt-test',
            reasoning: 'high',
            authority: { mode: 'trust', bypassFrom: null },
            status: 'idle',
            createdAt: new Date(0),
            updatedAt: new Date(0),
            id: 'thread-builder',
            spawnRootId: 'thread-builder',
            cacheGroup: 'thread-builder',
            name: 'builder',
          },
          { projectId, title: 'B', readerOrderAt: new Date(0) },
        );
        const signed = signedBy({ harness: 'tagma', key: 'thread-builder' });
        const { id } = yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'Build the change' });
        yield* signed(graph.tasks.claim({ id }));
        yield* signed(seen(projectId, 'src/x.ts', 'wrote'));
        expect(yield* graph.touches.of({ projectId, place: 'src/x.ts' })).toMatchObject([
          { agentName: 'builder', wrote: true, task: { title: 'Build the change' } },
        ]);
      }),
    ),
  );

  it.effect('a released task keeps no touches, and a later holder starts clean', () =>
    withDemo(({ graph, projectId, as, root }) =>
      Effect.gen(function* () {
        const { id } = yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'handed over' });
        yield* as('session-a', graph.tasks.claim({ id }));
        yield* as('session-a', seen(projectId, 'src/y.ts', 'wrote'));
        yield* as('session-a', graph.tasks.release({ id }));
        yield* as('session-b', graph.tasks.claim({ id }));
        expect(yield* graph.touches.of({ projectId, place: 'src/y.ts' })).toEqual([]);
        yield* as('session-b', seen(projectId, 'src/y.ts', 'read'));
        const rows = yield* graph.touches.of({ projectId, place: 'src/y.ts' });
        const holder = yield* graph.sessions.idOf({ harness: 'test', key: 'session-b' });
        expect(rows).toMatchObject([{ task: { id }, wrote: false }]);
        expect(rows[0]?.writer?.id).toBe(holder ?? -1);
      }),
    ),
  );

  it.effect('touch answers code law and follows its text revision, independently of inspection changes', () =>
    withDemo(({ graph, projectId, nameOf, root }) =>
      Effect.gen(function* () {
        const zoned = (yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['rule'],
          title: 'Zone law',
          body: 'Binds here.',
          sources: [{ kind: 'dir', ref: 'src' }],
        })).id;
        yield* rule(projectId, 'Root law', 'Binds everywhere.');
        const brief = (yield* seen(projectId, 'src/reader.ts', 'read'))[0]!;
        expect(brief.rules.map((row) => row.name)).toEqual([yield* nameOf(zoned)]);
        expect(brief.rules[0]).toMatchObject({ title: 'Zone law', body: 'Binds here.' });
        const before = brief.rules[0]!.revision;
        yield* graph.blocks.update({ id: zoned, body: 'Binds here, and names the reader.' });
        const again = (yield* seen(projectId, 'src/reader.ts', 'read'))[0]!;
        expect(again.rules[0]!.revision).not.toBe(before);
        expect(again.rules[0]!.body).toBe('Binds here, and names the reader.');
        yield* graph.blocks.update({ id: zoned, title: 'Zone law, retitled' });
        const retitled = (yield* seen(projectId, 'src/reader.ts', 'read'))[0]!;
        expect(retitled.rules[0]!.revision).not.toBe(again.rules[0]!.revision);
        yield* graph.sources.attach({ blockId: zoned, kind: 'file', ref: 'lib/extra.ts' });
        const widened = (yield* seen(projectId, 'lib/extra.ts', 'read'))[0]!;
        expect(widened.rules[0]!.revision).not.toBe(retitled.rules[0]!.revision);
        const { db } = graph.graphStore;
        const row = yield* db.select({ fields: block.fields }).from(block).where(eq(block.id, zoned)).get();
        yield* db
          .update(block)
          .set({
            fields: {
              ...row?.fields,
              enforcement: {
                strictness: 'gate',
                on: TRIGGERS.landing,
                inspection: 'direction',
                debt: [],
                escaped: [],
              },
            },
          })
          .where(eq(block.id, zoned));
        const enforced = (yield* seen(projectId, 'src/reader.ts', 'read'))[0]!;
        expect(enforced.rules[0]).toMatchObject({ body: 'Binds here, and names the reader.', revision: widened.rules[0]!.revision });
      }),
    ),
  );

  it.effect('touch names who else is on the file until that work ends', () =>
    withDemo(({ graph, projectId, nameOf, as, root }) =>
      Effect.gen(function* () {
        const task = yield* held(projectId, 'harden');
        expect((yield* seen(projectId, 'src/shared.ts', 'wrote'))[0]!.touches).toEqual([]);
        const peerTask = (yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'review' })).id;
        yield* as('peer', graph.tasks.claim({ id: peerTask }));
        expect((yield* as('peer', seen(projectId, 'src/shared.ts', 'read')))[0]!.touches).toEqual([
          { writer: null, agentName: null, task: { name: yield* nameOf(task), title: 'harden' }, wrote: true },
        ]);
        yield* graph.tasks.finish({ id: task });
        expect((yield* as('peer', seen(projectId, 'src/shared.ts', 'read')))[0]!.touches).toEqual([]);
      }),
    ),
  );

  it.effect('a signed session this graph has never seen holds none of the operator’s tasks', () =>
    withDemo(({ graph, projectId, as }) =>
      Effect.gen(function* () {
        yield* held(projectId, 'the operator’s work');
        yield* as('newcomer', seen(projectId, 'src/new.ts', 'wrote'));
        expect(yield* graph.touches.of({ projectId, place: 'src/new.ts' })).toEqual([]);
      }),
    ),
  );

  it.effect('a file seen only in search results answers its place and is not recorded as touched', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        yield* held(projectId, 'the task');
        const [brief] = yield* seen(projectId, 'src/found.ts', 'found');
        expect(brief).toMatchObject({ place: 'src/found.ts', as: 'found' });
        expect(yield* graph.touches.of({ projectId, place: 'src/found.ts' })).toEqual([]);
      }),
    ),
  );

  it.effect('one call answers every place, with its strongest sighting deciding how it was seen', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const briefs = yield* graph.touches.touch({
          projectId,
          shown: [
            { path: 'src/a.ts', as: 'found' },
            { path: 'src/a.ts', as: 'read' },
            { path: 'src/b.ts', as: 'found' },
          ],
        });
        expect(briefs.map(({ place, as }) => ({ place, as }))).toEqual([
          { place: 'src/a.ts', as: 'read' },
          { place: 'src/b.ts', as: 'found' },
        ]);
      }),
    ),
  );
});
