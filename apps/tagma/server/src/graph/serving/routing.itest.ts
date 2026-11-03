import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { eq } from 'drizzle-orm';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { SHIPPED_CATALOGS } from '../../composition/testing/settings.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { GraphStore } from '../../platform/contract/service/store.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { runGit } from '../../platform/git/ownGit.js';
import { onGraph, signedBy } from '../../invocation/testing/call.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { Settings } from '../../settings/contract/service/values.js';
import { setting } from '../../settings/store/table.js';
import { Blocks } from '../contract/service/blocks.js';
import { Tags } from '../contract/service/vocabulary.js';
import { BlockReads, Selection } from '../contract/service/reads.js';
import { blockName } from '../contract/wire/references.js';
import { FORMAT_FILE } from '../contract/wire/storage.js';
import { markerText } from '../tree/marker.js';
import { shippedSteps } from '../steps/sequence.js';
import { block, event } from '../store/tables.js';
import { writeBlockTree } from '../tree/layout.js';
import { scanTree } from '../tree/scan.js';
import { machineGraphOf } from './machine.js';
import { graphPool } from '../testing/doubles.js';
import { placeContext, routedContext } from './routing.js';
import { ProjectLifecycle } from '../contract/service/serving.js';

const signed = signedBy({ harness: 'test', key: 'router' });

layer(demoGraphLayer({ repos: ['served-catalogs'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'graph routing',
  (it) => {
    it.effect('calls use their graph while registry and settings stay machine-owned, and served vocabulary carries its writer', () =>
      withDemo(({ graph, context, project, demoRoot, projectId: demoId }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const catalog = project('served-catalogs');
            const projectId = catalog.id;
            yield* graph.projectPolicy.setStorage({ id: projectId, mode: 'team' });
            const rootId = '0199aaaa-0000-7000-8000-000000000001';
            yield* writeBlockTree(join(catalog.root, '.tagma'), [
              { parentId: null, frontmatter: { id: rootId, title: 'served-catalogs', ord: 1 }, body: '' },
              {
                parentId: rootId,
                frontmatter: { id: '0199aaaa-0000-7000-8000-000000000002', title: 'Carried Before Registration', ord: 1 },
                body: 'Carried knowledge',
              },
            ]);
            yield* fs.writeFileString(join(catalog.root, '.tagma', FORMAT_FILE), markerText(shippedSteps.last));
            yield* runGit(graph.git, 'stage', ['add', '-A'], { cwd: catalog.root });
            yield* runGit(graph.git, 'commit', ['commit', '-m', 'carried graph'], { cwd: catalog.root });
            const machine = machineGraphOf(context);
            const pool = yield* Effect.acquireRelease(
              graphPool({ migrations: fixtureGraphMigrations, identity: testSessionIdentity, machine, sourcePath: demoRoot }),
              (held) => held.dispose(),
            );
            const routed = routedContext(machine, pool);
            const registered = yield* Effect.provide(
              Effect.flatMap(Projects, (projects) => projects.list()),
              routed,
            );
            expect(registered.map((row) => row.id)).toEqual(expect.arrayContaining([projectId, demoId]));
            const served = yield* pool.resolve({ projectId });
            const born = yield* Effect.provide(
              onGraph(served)(
                signed(
                  Effect.flatMap(Blocks, (blocks) =>
                    Effect.flatMap(blocks.rootBlockOf(projectId), (top) =>
                      blocks.create({ projectId, parentId: top.id, tags: ['idea'], title: 'Routed node' }),
                    ),
                  ),
                ),
              ),
              routed,
            );
            expect(yield* graph.store.db.select().from(block).where(eq(block.uuid, born.uuid))).toEqual([]);
            const servedStore = Context.get(served.context, GraphStore);
            expect((yield* servedStore.db.select().from(block).where(eq(block.uuid, born.uuid))).map((row) => row.uuid)).toEqual([
              born.uuid,
            ]);
            const answer = yield* Effect.provide(
              onGraph(served)(
                Effect.gen(function* () {
                  const registry = yield* (yield* Projects).list();
                  const tree = yield* (yield* Selection).tree(projectId);
                  return { projects: registry.map((row) => row.id), identities: tree.map((row) => row.uuid) };
                }),
              ),
              routed,
            );
            expect(answer.projects).toEqual(registered.map((row) => row.id));
            expect(answer.identities).toContain(born.uuid);
            expect((yield* graph.projectPolicy.servesFrom([projectId])).get(projectId)).toBe('files');
            expect(
              (yield* Effect.provide(
                Effect.flatMap(Tags, (tags) => tags.of(projectId)),
                served.context,
              )).tagById('task'),
            ).not.toBeNull();
            yield* Effect.provide(
              onGraph(served)(
                signed(
                  Effect.flatMap(Settings, (settings) =>
                    settings.write({
                      scope: 'project',
                      projectId,
                      key: SHIPPED_CATALOGS.key.id,
                      value: ['software-development', 'knowledge'],
                    }),
                  ),
                ),
              ),
              routed,
            );
            const machineSettings = yield* graph.store.db.select().from(setting).where(eq(setting.projectId, projectId));
            expect(machineSettings.some((row) => row.key === SHIPPED_CATALOGS.key.id)).toBe(true);
            const servedSettings = yield* servedStore.db.select().from(setting).where(eq(setting.projectId, projectId));
            expect(servedSettings.some((row) => row.key === SHIPPED_CATALOGS.key.id)).toBe(false);
            const decision = yield* Effect.provide(
              onGraph(served)(
                signed(
                  Effect.flatMap(Blocks, (blocks) =>
                    Effect.flatMap(blocks.rootBlockOf(projectId), (top) =>
                      blocks.create({ projectId, parentId: top.id, tags: ['decision'], title: 'Served Choice' }),
                    ),
                  ),
                ),
              ),
              routed,
            );
            expect(decision.tags).toEqual(['decision']);
            const table = yield* Effect.provide(onGraph(served)(Effect.flatMap(Tags, (tags) => tags.of(projectId))), routed);
            expect(table.tags.map((tag) => tag.id)).toContain('decision');
            const servedRows = yield* servedStore.db.select().from(block).where(eq(block.projectId, projectId));
            const declaration = servedRows.find((row) => row.tags.includes('tag') && row.fields.id === 'decision');
            if (declaration === undefined) return yield* Effect.die('the served graph holds no decision declaration');
            const install = (yield* servedStore.db.select().from(event).where(eq(event.blockId, declaration.id))).find(
              (row) => row.op === 'create',
            );
            const writer = yield* Effect.provide(
              Effect.flatMap(WriterRegister, (writers) => writers.writerOf(install?.sessionId ?? null)),
              served.context,
            );
            expect(writer).toMatchObject({ harness: 'test', key: 'router' });
            yield* Context.get(served.context, Settings)
              .write({ scope: 'project', projectId, key: SHIPPED_CATALOGS.key.id, value: ['software-development', 'knowledge'] })
              .pipe(signedBy({ harness: 'test', key: 'native' }), Effect.provide(served.context));
            const machineRows = yield* graph.store.db.select().from(block).where(eq(block.projectId, projectId));
            expect(machineRows.some((row) => row.tags.includes('tag') && row.fields.id === 'decision')).toBe(false);
            const tree = yield* scanTree(served.layout.treeRoot);
            expect(
              tree.blocks.some((row) => (row.frontmatter.tags ?? []).includes('tag') && row.frontmatter.fields?.id === 'decision'),
            ).toBe(true);
          }),
        ),
      ),
    );

    it.effect(
      'switching the current graph isolates reads while foreign references survive a registry change, and a project registered from a served checkout is born in the machine graph under the caller',
      () =>
        withDemo(({ graph, context, projectId, demoRoot, fixture }) =>
          Effect.scoped(
            Effect.gen(function* () {
              const global = (yield* graph.projects.global())!;
              const machine = machineGraphOf(context);
              const pool = yield* Effect.acquireRelease(
                graphPool({ migrations: fixtureGraphMigrations, identity: testSessionIdentity, machine, sourcePath: demoRoot }),
                (held) => held.dispose(),
              );
              const routed = routedContext(machine, pool);
              const canonical = yield* pool.resolve({ projectId: global.id });
              yield* canonical.fresh();
              const law = yield* Effect.provide(
                signed(
                  Effect.flatMap(Blocks, (blocks) =>
                    Effect.flatMap(blocks.rootBlockOf(global.id), (top) =>
                      blocks.create({ projectId: global.id, parentId: top.id, tags: ['idea'], title: 'Cross Law' }),
                    ),
                  ),
                ),
                canonical.context,
              );
              const local = yield* pool.resolve({ projectId });
              const name = blockName(law.uuid);
              const note = yield* Effect.provide(
                signed(
                  Effect.flatMap(Blocks, (blocks) =>
                    Effect.flatMap(blocks.rootBlockOf(projectId), (top) =>
                      blocks.create({ projectId, parentId: top.id, tags: ['idea'], title: 'Names The Law', body: `[[${name}]]` }),
                    ),
                  ),
                ),
                local.context,
              );
              const foreign = yield* Effect.provide(
                onGraph(canonical)(Effect.flatMap(Selection, (selection) => selection.tree(global.id))),
                routed,
              );
              expect(new Set(foreign.map((row) => row.projectId))).toEqual(new Set([global.id]));
              expect(foreign.map((row) => row.uuid)).not.toContain(note.uuid);
              const own = yield* Effect.provide(
                onGraph(local)(Effect.flatMap(Selection, (selection) => selection.tree(projectId))),
                routed,
              );
              expect(own.map((row) => row.uuid)).toContain(note.uuid);
              const rootPath = yield* fixture.directory('delta');
              const born = yield* Effect.provide(
                onGraph(local)(
                  signed(
                    Effect.provide(
                      Effect.flatMap(ProjectLifecycle, (lifecycle) => lifecycle.create({ name: 'delta', rootPath })),
                      placeContext(local, pool),
                    ),
                  ),
                ),
                routed,
              );
              const rows = yield* graph.store.db.select().from(block).where(eq(block.projectId, born.id));
              expect(rows.filter((row) => row.parentId === null).map((root) => root.title)).toEqual(['delta']);
              const [added] = (yield* graph.store.db.select().from(event).where(eq(event.projectId, born.id))).filter(
                (row) => row.op === 'project_add',
              );
              const writer = yield* Effect.provide(
                Effect.flatMap(WriterRegister, (writers) => writers.writerOf(added?.sessionId ?? null)),
                context,
              );
              expect(writer).toMatchObject({ harness: 'test', key: 'router' });
              const read = yield* Effect.provide(onGraph(local)(Effect.flatMap(BlockReads, (reading) => reading.show(note.id, 0))), routed);
              expect(read.refsOutDetails.map((ref) => ref.name)).toContain(name);
            }),
          ),
        ),
    );
  },
);
