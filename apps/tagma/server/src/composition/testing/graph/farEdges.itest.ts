import { expect } from 'bun:test';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, Exit, FileSystem, Layer, Scope } from 'effect';
import { eq } from 'drizzle-orm';
import { ToolAnswer, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { unthreadedCaller } from '../callers.js';
import { demoGraphLayer, withDemo } from '../graphFixture.js';
import { prepareTeamCopies } from './serving/fixture.js';
import { fixtureGraphMigrations } from '../migrations.js';
import { fixtureNativeCatalog } from '../nativeCatalog.js';
import { sessionIdentity } from '../../../external-harnesses/sessionPrefix.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { GraphStore } from '../../../platform/contract/service/store.js';
import { storeLayer } from '../../../platform/store/open.js';
import { onGraph, signedBy } from '../../../invocation/testing/call.js';
import { Blocks, Edges } from '../../../graph/contract/service/blocks.js';
import { Tags } from '../../../graph/contract/service/vocabulary.js';
import { BlockReads } from '../../../graph/contract/service/reads.js';
import { ProjectLifecycle, type ServedGraph } from '../../../graph/contract/service/serving.js';
import { REGISTRY_PAIRS } from '../../../graph/operations/registry.js';
import { RegisteredRoots } from '../../../graph/contract/service/registeredRoots.js';
import { blockName } from '../../../graph/contract/wire/references.js';
import { block, meta } from '../../../graph/store/tables.js';
import { phaseWordsKey } from '../../../graph/contract/wire/storage.js';
import { decodeBlockFile, encodeBlockFile } from '../../../graph/tree/blockFile.js';
import { graphPool, machineGraphOf } from '../../../graph/testing/doubles.js';
import { routedContext } from '../../../graph/serving/routing.js';
import { Capacity, HEAVY, serverCapacity } from '../../../platform/contract/service/capacity.js';
import { OPENS, OPEN_IN_BACKGROUND } from '../../../graph/contract/service/lanes.js';

const signed = signedBy({ harness: 'test', key: 'far-edges' });

const TOOLS = ['link_blocks', 'unlink_blocks', 'read_block', 'ready_work', 'create_block', 'finish_block', 'supersede_block'];

const ABSENT_GRAPH = '0199dddd-0000-7000-8000-00000000d00d';
const ABSENT_BLOCK = '0199dddd-0000-7000-8000-00000000beef';
const MOVED_GRAPH = '0199dddd-0000-7000-8000-00000000a7c4';

layer(
  demoGraphLayer({ repos: ['front', 'back'], prepareEffect: prepareTeamCopies(['front', 'back']) }).pipe(
    Layer.provideMerge(BunFileSystem.layer),
  ),
  { excludeTestServices: true },
)('edges between projects', (it) => {
  it.effect('an edge into another project is addressed by its graph root, waits, unwinds and survives its target leaving', () =>
    withDemo(({ graph, context, project, demoRoot }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const front = project('front');
          const back = project('back');
          const machine = machineGraphOf(context);
          const pool = yield* Effect.acquireRelease(
            graphPool({ migrations: fixtureGraphMigrations, identity: testSessionIdentity, machine, sourcePath: demoRoot }),
            (held) => held.dispose(),
          );
          const routed = routedContext(machine, pool);
          const servedFront = yield* pool.resolve({ projectId: front.id });
          const servedBack = yield* pool.resolve({ projectId: back.id });
          const within = <A, E>(served: ServedGraph, work: Effect.Effect<A, E, Blocks>) =>
            Effect.provide(onGraph(served)(signed(work)), routed) as Effect.Effect<A, E>;
          const tools = Effect.fnUntraced(function* (served: ServedGraph, projectId: number, name: string) {
            const vocabulary = yield* Effect.provide(
              Effect.flatMap(Tags, (tags) => tags.reader(projectId)),
              served.context,
            );
            const catalog = yield* fixtureNativeCatalog(
              {
                caller: { actor: { kind: 'operator' }, files: null },
                place: { root: served.checkout, origin: null },
                project: { id: projectId, name },
                vocabulary,
                identity: sessionIdentity,
                world: 'checkout',
                graphRoot: served.layout.treeRoot,
                owners: routed,
                served,
              },
              TOOLS,
            );
            let calls = 0;
            return Effect.fnUntraced(function* (tool: string, input: Record<string, unknown>) {
              const entry = catalog[tool];
              if (entry === undefined) return yield* Effect.die(`no ${tool} tool`);
              const key = `${name}-${++calls}`;
              const prepared = yield* (
                toolPrepare(entry)?.(input, { toolCallId: key, caller: unthreadedCaller }) ?? Effect.succeed(undefined)
              );
              const answered = yield* toolExecute(entry)!(input, {
                toolCallId: key,
                caller: unthreadedCaller,
                messages: [],
                prepared: prepared?.prepared,
              });
              return (answered instanceof ToolAnswer ? answered.value : answered) as Record<string, unknown>;
            });
          });
          const inFront = yield* tools(servedFront, front.id, 'front');
          const inBack = yield* tools(servedBack, back.id, 'back');
          const fileOf = Effect.fnUntraced(function* (served: ServedGraph, uuid: string) {
            const { db } = Context.get(served.context, GraphStore);
            const row = yield* db.select({ path: block.path }).from(block).where(eq(block.uuid, uuid)).get();
            return join(served.layout.treeRoot, row?.path ?? '');
          });

          const blocker = yield* within(
            servedBack,
            Effect.flatMap(Blocks, (blocks) => blocks.create({ projectId: back.id, tags: ['task'], title: 'Serve the orders' })),
          );
          const waiting = yield* within(
            servedFront,
            Effect.flatMap(Blocks, (blocks) => blocks.create({ projectId: front.id, tags: ['task'], title: 'Show the orders' })),
          );
          const backRoot = yield* within(
            servedBack,
            Effect.flatMap(Blocks, (blocks) => blocks.rootBlockOf(back.id)),
          );
          const blockerName = blockName(blocker.uuid);
          const waitingName = blockName(waiting.uuid);
          const blockerAddress = `${back.id}/${blockerName}`;
          const waitingAddress = `${front.id}/${waitingName}`;

          expect(yield* inFront('link_blocks', { fromId: waitingName, kind: 'waits-on', toId: blockerName })).toMatchObject({
            status: 'ok',
          });
          const text = yield* files.readFileString(yield* fileOf(servedFront, waiting.uuid));
          expect(text).toContain(`to: ${backRoot.uuid}/${blocker.uuid}#${backRoot.title}`);

          const read = (yield* inFront('read_block', { blockIds: [waitingName] })) as {
            reads: { edgesOut: unknown[]; blocked: boolean }[];
          };
          expect(read.reads[0]).toMatchObject({
            blocked: true,
            edgesOut: [{ kind: 'waits-on', toName: blockerName, graph: { state: 'here', projectId: back.id, title: 'Serve the orders' } }],
          });
          const incoming = (yield* inBack('read_block', { blockIds: [blockerName] })) as { reads: { edgesIn: unknown[] }[] };
          expect(incoming.reads[0]?.edgesIn).toEqual([
            expect.objectContaining({ kind: 'waits-on', fromName: waitingName, graph: expect.objectContaining({ projectId: front.id }) }),
          ]);
          const readyNames = Effect.map(inFront('ready_work', {}), (answer) => ({
            tasks: (answer.tasks as { name: string }[]).map((task) => task.name),
            held: answer.held,
          }));
          expect((yield* readyNames).tasks).not.toContain(waitingName);

          const loop = yield* within(
            servedBack,
            Effect.flatMap(Blocks, (blocks) => blocks.create({ projectId: back.id, tags: ['task'], title: 'Wait on the front' })),
          );
          expect(yield* inBack('link_blocks', { fromId: blockerName, kind: 'waits-on', toId: blockName(loop.uuid) })).toMatchObject({
            status: 'ok',
          });
          expect(yield* inBack('link_blocks', { fromId: blockName(loop.uuid), kind: 'waits-on', toId: waitingAddress })).toMatchObject({
            status: 'refused',
            code: 'wait-cycle',
          });
          expect(yield* inBack('unlink_blocks', { fromId: blockerName, kind: 'waits-on', toId: blockName(loop.uuid) })).toMatchObject({
            status: 'ok',
          });
          const replaced = yield* Effect.result(inFront('supersede_block', { oldId: waitingName, withId: blockerAddress }));
          expect(replaced._tag === 'Failure' ? String(replaced.failure) : 'replaced').toContain('place-mismatch');

          expect(yield* inBack('finish_block', { blockId: blockerName })).toMatchObject({ status: 'ok' });
          expect((yield* readyNames).tasks).toContain(waitingName);

          const born = (yield* inFront('create_block', {
            tags: ['task'],
            title: 'Born beside the back',
            edges: [{ kind: 'relates', to: blockerAddress }],
          })) as { status: string; block: { name: string } };
          expect(born.status).toBe('ok');
          expect(yield* inFront('read_block', { blockIds: [born.block.name] })).toMatchObject({
            reads: [{ edgesOut: [{ kind: 'relates', toName: blockerName, graph: { state: 'here', projectId: back.id } }] }],
          });

          yield* within(
            servedFront,
            Effect.flatMap(Blocks, (blocks) =>
              blocks.create({
                projectId: front.id,
                tags: ['tag'],
                title: '#review',
                body: 'review',
                fields: { id: 'review', edges: [{ kind: 'reviews', to: ['task'] }] },
              }),
            ),
          );
          yield* within(
            servedBack,
            Effect.flatMap(Blocks, (blocks) =>
              blocks.create({
                projectId: back.id,
                tags: ['tag'],
                title: '#chore',
                body: 'chore',
                fields: { id: 'chore', extends: 'task' },
              }),
            ),
          );
          const review = yield* within(
            servedFront,
            Effect.flatMap(Blocks, (blocks) => blocks.create({ projectId: front.id, tags: ['review'], title: 'Review the orders' })),
          );
          const chore = yield* within(
            servedBack,
            Effect.flatMap(Blocks, (blocks) => blocks.create({ projectId: back.id, tags: ['chore'], title: 'Sweep the orders' })),
          );
          expect(
            yield* inFront('link_blocks', {
              fromId: blockName(review.uuid),
              kind: 'reviews',
              toId: `${back.id}/${blockName(chore.uuid)}`,
            }),
          ).toMatchObject({ status: 'ok' });

          const unreadFile = yield* fileOf(servedFront, waiting.uuid);
          const parsed = yield* decodeBlockFile(yield* files.readFileString(unreadFile));
          const far = `${ABSENT_GRAPH}/${ABSENT_BLOCK}#ledger`;
          const moved = `${MOVED_GRAPH}/${ABSENT_BLOCK}#archive`;
          yield* files.writeFileString(
            unreadFile,
            encodeBlockFile({
              frontmatter: {
                ...parsed.frontmatter,
                edges: [...(parsed.frontmatter.edges ?? []), { kind: 'waits-on', to: far }, { kind: 'waits-on', to: moved }],
              },
              body: parsed.body,
            }),
          );
          yield* servedFront.settled(true);
          const away = (yield* inFront('read_block', { blockIds: [waitingName] })) as {
            reads: { edgesOut: unknown[]; blocked: boolean }[];
          };
          expect(away.reads[0]?.blocked).toBe(true);
          expect(away.reads[0]?.edgesOut).toContainEqual(
            expect.objectContaining({
              kind: 'waits-on',
              toName: blockName(ABSENT_BLOCK),
              graph: expect.objectContaining({ state: 'absent', project: 'ledger' }),
            }),
          );
          expect(away.reads[0]?.edgesOut).toContainEqual(
            expect.objectContaining({
              kind: 'waits-on',
              toName: blockName(ABSENT_BLOCK),
              graph: expect.objectContaining({ state: 'absent', project: 'archive' }),
            }),
          );
          const held = yield* readyNames;
          expect(held.tasks).not.toContain(waitingName);
          expect(held.held).toHaveLength(2);
          expect(held.held).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ project: 'ledger', tasks: [waitingName], code: 'target-absent' }),
              expect.objectContaining({ project: 'archive', tasks: [waitingName], code: 'target-absent' }),
            ]),
          );

          expect(yield* inFront('unlink_blocks', { fromId: waitingName, kind: 'waits-on', toId: blockName(ABSENT_BLOCK) })).toMatchObject({
            status: 'ok',
          });
          const unlinkedText = yield* files.readFileString(unreadFile);
          expect(unlinkedText).not.toContain(ABSENT_GRAPH);
          expect(unlinkedText).not.toContain(MOVED_GRAPH);
          expect((yield* readyNames).tasks).toContain(waitingName);
        }),
      ),
    ),
  );

  it.effect(
    'a project leaving the machine leaves the edges into it standing, a clone answers them again, and leaving with unlink removes them',
    () =>
      withDemo(({ graph, context, project, demoRoot, projectId }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const files = yield* FileSystem.FileSystem;
            const front = project('front');
            const back = project('back');
            const lanes = serverCapacity([HEAVY, OPENS].map((name) => ({ name, units: 2, limits: { call: 2, background: 1 } })));
            const background = yield* Scope.fork(yield* Effect.scope);
            yield* lanes.lease(OPEN_IN_BACKGROUND).pipe(Scope.provide(background));
            const machine = machineGraphOf(Context.add(context, Capacity, lanes));
            const pool = yield* Effect.acquireRelease(
              graphPool({ migrations: fixtureGraphMigrations, identity: testSessionIdentity, machine, sourcePath: demoRoot }),
              (held) => held.dispose(),
            );
            const routed = routedContext(machine, pool);
            const servedFront = yield* pool.resolve({ projectId: front.id });
            const servedBack = yield* pool.resolve({ projectId: back.id });
            yield* pool.resolve({ projectId });
            yield* pool.resolve({ projectId: (yield* graph.projects.global())!.id });
            const within = <A, E>(served: ServedGraph, work: Effect.Effect<A, E, Blocks>) =>
              Effect.provide(onGraph(served)(signed(work)), routed) as Effect.Effect<A, E>;
            const operator = { actor: { kind: 'operator' as const }, files: null };
            const roots = RegisteredRoots.of({ joined: () => Effect.void, left: () => Effect.void });
            const registry = <A, E>(work: Effect.Effect<A, E, unknown>) =>
              Effect.provide(signed(work), Context.add(routed, RegisteredRoots, roots)) as Effect.Effect<A, E>;
            const blocker = yield* within(
              servedBack,
              Effect.flatMap(Blocks, (blocks) => blocks.create({ projectId: back.id, tags: ['task'], title: 'Serve the orders' })),
            );
            const near = yield* within(
              servedFront,
              Effect.flatMap(Blocks, (blocks) => blocks.create({ projectId: front.id, tags: ['task'], title: 'Show the orders' })),
            );
            const beside = yield* within(
              servedFront,
              Effect.flatMap(Blocks, (blocks) => blocks.create({ projectId: front.id, tags: ['task'], title: 'Read the orders' })),
            );
            const end = yield* Effect.provide(
              Effect.flatMap(Edges, (edges) => edges.farBlockOf(blocker, 'waits-on')),
              servedBack.context,
            );
            yield* Effect.provide(
              onGraph(servedFront)(
                signed(
                  Effect.gen(function* () {
                    yield* (yield* Edges).linkFar({ fromId: near.id, kind: 'waits-on', end });
                    yield* (yield* Edges).linkFar({ fromId: beside.id, kind: 'relates', end });
                  }),
                ),
              ),
              routed,
            );
            const noted = yield* within(
              servedFront,
              Effect.flatMap(Blocks, (blocks) =>
                blocks.create({
                  projectId: front.id,
                  title: 'Notes',
                  body: `Waits on [[${blockName(blocker.uuid)}]], never on [[0badc0de]].`,
                }),
              ),
            );
            const reads = (served: ServedGraph, id: number) =>
              Effect.provide(onGraph(served)(Effect.flatMap(BlockReads, (reading) => reading.show(id, 0))), routed);
            expect(yield* reads(servedFront, noted.id)).toMatchObject({
              refsOut: [blockName(blocker.uuid)],
              refsElsewhere: [{ name: blockName(blocker.uuid), projectId: back.id }],
              refsAbsent: ['0badc0de'],
            });
            const counted = yield* registry(REGISTRY_PAIRS.read_project.body.execute({ ref: String(back.id) }, undefined, operator));
            expect(counted).toMatchObject({
              pointing: { edges: 2, holding: 1, byProject: [{ projectId: front.id, edges: 2, holding: 1 }] },
            });

            const clone = join(demoRoot, 'back-clone');
            yield* files.copy(back.root, clone, { overwrite: true });
            yield* files.remove(back.root, { recursive: true });
            const nearFile = join(
              servedFront.layout.treeRoot,
              (yield* Context.get(servedFront.context, GraphStore)
                .db.select({ path: block.path })
                .from(block)
                .where(eq(block.id, near.id))
                .get())?.path ?? '',
            );
            const written = yield* files.readFileString(nearFile);
            const left = yield* registry(REGISTRY_PAIRS.remove_project.body.execute({ ref: String(back.id) }, undefined, operator));
            expect(left).toMatchObject({ unlinked: 0, pointing: { edges: 2, holding: 1 } });
            expect(yield* files.readFileString(nearFile)).toBe(written);
            const away = yield* reads(servedFront, near.id);
            expect(away.blocked).toBe(true);
            expect(away.edgesOut).toEqual([
              expect.objectContaining({ kind: 'waits-on', far: expect.objectContaining({ state: 'absent', project: 'back' }) }),
            ]);
            expect((yield* reads(servedFront, beside.id)).blocked).toBe(false);

            const again = yield* registry(
              Effect.flatMap(ProjectLifecycle, (lifecycle) => lifecycle.create({ name: 'back-clone', rootPath: clone, storage: 'team' })),
            );
            yield* pool.birth(again.id);
            const back2 = yield* reads(servedFront, near.id);
            expect(back2.edgesOut).toEqual([
              expect.objectContaining({
                far: expect.objectContaining({ state: 'here', projectId: again.id, title: 'Serve the orders' }),
              }),
            ]);

            yield* pool.releaseProject(front.id);
            const servedClone = yield* pool.resolve({ projectId: again.id });
            const cloned = yield* Context.get(servedClone.context, GraphStore)
              .db.select({ id: block.id })
              .from(block)
              .where(eq(block.uuid, blocker.uuid))
              .get();
            const cold = yield* Effect.provide(
              onGraph(servedClone)(Effect.flatMap(BlockReads, (reading) => reading.show(cloned?.id ?? 0, 0))),
              routed,
            );
            expect(cold.edgesIn).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ kind: 'waits-on', far: expect.objectContaining({ projectId: front.id }) }),
              ]),
            );
            expect(pool.held().map((copy) => copy.treeRoot)).not.toContain(servedFront.layout.treeRoot);

            const unpublish = Effect.fnUntraced(function* () {
              yield* pool.releaseProject(front.id);
              const cold = yield* Layer.build(
                storeLayer(GraphStore, servedFront.layout.mirrorPath, fixtureGraphMigrations, { durable: false }, graph.store.processes),
              );
              yield* Context.get(cold, GraphStore)
                .db.delete(meta)
                .where(eq(meta.key, phaseWordsKey(front.id)));
            }, Effect.scoped);
            yield* unpublish();
            const unread = yield* Effect.provide(
              onGraph(servedClone)(Effect.flatMap(BlockReads, (reading) => reading.show(cloned?.id ?? 0, 0))),
              routed,
            );
            expect(unread.edgesInUnread).toEqual(['front']);
            const unjudged = yield* registry(REGISTRY_PAIRS.read_project.body.execute({ ref: String(again.id) }, undefined, operator));
            expect(unjudged).toMatchObject({ pointing: { edges: 2, holding: 0, unread: ['front'] } });
            yield* Scope.close(background, Exit.void);
            const reopened = yield* pool.resolve({ projectId: front.id });
            yield* reopened.fresh();
            const judged = yield* registry(REGISTRY_PAIRS.read_project.body.execute({ ref: String(again.id) }, undefined, operator));
            expect(judged).toMatchObject({ pointing: { edges: 2, holding: 1, unread: [] } });

            yield* files.remove(clone, { recursive: true });
            const unlinked = yield* registry(
              REGISTRY_PAIRS.remove_project.body.execute({ ref: String(again.id), unlink: true }, undefined, operator),
            );
            expect(unlinked).toMatchObject({ unlinked: 2 });
            expect(yield* files.readFileString(nearFile)).not.toContain(blocker.uuid);
            expect((yield* reads(reopened, near.id)).edgesOut).toEqual([]);
          }),
        ),
      ),
  );
});
