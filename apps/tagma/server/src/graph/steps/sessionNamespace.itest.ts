import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { signedBy } from '../../invocation/testing/call.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { session } from '../../platform/store/writers.js';
import { Catalogs, NO_CATALOGS } from '../contract/wire/catalogs.js';
import { FORMAT_FILE } from '../contract/wire/storage.js';
import { Blocks } from '../contract/service/blocks.js';
import { BlockNames } from '../contract/service/acts.js';
import { GraphJournal } from '../contract/service/journal.js';
import type { GraphContext } from '../contract/service/serving.js';
import { graphPool } from '../testing/doubles.js';
import { resolveStorageLayout, storageHomes } from '../storage/layout.js';
import { ShadowGit } from '../tree/shadow.js';
import { NO_SIDE } from '../contract/service/exchange.js';
import { markerText } from '../tree/marker.js';
import { projectToTree } from '../tree/projection.js';
import { scanTree } from '../tree/scan.js';
import { block, edge, event, farEdge, meta, touch } from '../store/tables.js';
import { shippedSteps } from './sequence.js';

layer(demoGraphLayer({ repos: ['namespace'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'session namespace',
  (it) => {
    it.effect('old and already-upgraded trees coalesce a surviving mirror without losing holders or authorship', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { graph, context, project, demoRoot } = demo;
          const files = yield* FileSystem.FileSystem;
          const checkout = project('namespace').root;
          const row = yield* graph.projectPolicy.setStorage({ id: project('namespace').id, mode: 'stealth' });
          const task = yield* graph.blocks.create({
            projectId: row.id,
            parentId: (yield* graph.blocks.rootBlockOf(row.id)).id,
            tags: ['task'],
            title: 'Held work',
          });
          yield* signedBy({ harness: 'tagma', key: 'thread-holder' })(graph.tasks.claim({ id: task.id }));
          const layout = yield* resolveStorageLayout({
            mode: 'stealth',
            projectId: row.id,
            ...storageHomes(graph.store.path),
            worktree: checkout,
          });
          if (layout.mode !== 'stealth') return yield* Effect.die('the fixture requires a stealth tree');
          const shadow = yield* ShadowGit.open(layout.gitDir, graph.git, NO_SIDE);
          yield* shadow.attach(layout.treeRoot, 'main');
          yield* shadow.recordCheckout(layout.treeRoot, checkout, checkout);
          yield* projectToTree({ projectId: row.id, treeRoot: layout.treeRoot });
          const file = (yield* scanTree(layout.treeRoot)).blocks.find((block) => block.frontmatter.id === task.uuid)!;
          const path = join(layout.treeRoot, file.path);
          const text = yield* files.readFileString(path);
          yield* files.writeFileString(path, text.replace('tagma:thread-holder', 'lode:thread-holder'));
          yield* files.writeFileString(join(layout.treeRoot, FORMAT_FILE), markerText(shippedSteps.last));
          yield* shadow.commitAct(layout.treeRoot, 'old graph');
          const openPool = () =>
            Effect.acquireRelease(
              graphPool({
                machine: Context.add(context, Catalogs, NO_CATALOGS),
                sourcePath: demoRoot,
                identity: testSessionIdentity,
                migrations: fixtureGraphMigrations,
              }),
              (held) => held.dispose(),
            );
          const trashUuid = '0199bbbb-0000-7000-8000-0000cafe0088';
          const seed = Effect.fnUntraced(function* (opened: GraphContext) {
            const store = Context.get(opened, GraphStore);
            const writers = Context.get(opened, WriterRegister);
            const holder = (yield* writers.all()).find((writer) => writer.key === 'thread-holder' && writer.harness === 'tagma')!;
            const id = yield* Context.get(opened, BlockNames).idOfName(task.uuid.replaceAll('-', ''));
            yield* store.transaction(writes('test.oldNamespace', [session, block, edge, event, farEdge, meta, touch]), () =>
              Effect.gen(function* () {
                yield* store.db.update(session).set({ harness: 'lode' }).where(eq(session.id, holder.id));
                yield* store.db.insert(session).values({ harness: 'tagma', key: holder.key, createdAt: new Date(0) });
                yield* store.db
                  .insert(session)
                  .values({ harness: 'lode', key: 'older-holder', createdAt: new Date(0) })
                  .onConflictDoNothing();
                const fields = { holder: holder.id, status: 'done' };
                const deleted = (yield* store.db
                  .insert(block)
                  .values({
                    uuid: trashUuid,
                    projectId: row.id,
                    parentId: id,
                    ord: 1,
                    title: 'Completed work',
                    tags: ['task'],
                    fields,
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                    deletedAt: new Date(0),
                  })
                  .onConflictDoUpdate({ target: block.uuid, set: { fields } })
                  .returning())[0]!;
                for (const blockId of [id, deleted.id])
                  yield* store.db.insert(event).values({ ts: new Date(0), op: 'claim', projectId: row.id, blockId, sessionId: holder.id });
                yield* store.db.insert(event).values({
                  ts: new Date(0),
                  op: 'delete',
                  projectId: row.id,
                  blockId: deleted.id,
                  sessionId: holder.id,
                  payload: JSON.stringify({ ids: [deleted.id] }),
                });
                yield* store.db.insert(event).values({
                  ts: new Date(0),
                  op: 'update',
                  projectId: row.id,
                  blockId: deleted.id,
                  sessionId: holder.id,
                  payload: JSON.stringify({ wasFields: { holder: holder.id } }),
                });
                yield* store.db
                  .insert(touch)
                  .values({ taskId: deleted.id, place: 'src/held.ts', wrote: true, touchedAt: new Date(0), sessionId: holder.id })
                  .onConflictDoUpdate({ target: [touch.taskId, touch.place], set: { sessionId: holder.id } });
                yield* store.db
                  .insert(edge)
                  .values({ fromId: deleted.id, toId: id, kind: 'relates', createdAt: new Date(0), createdBySessionId: holder.id })
                  .onConflictDoUpdate({ target: [edge.fromId, edge.toId, edge.kind], set: { createdBySessionId: holder.id } });
                yield* store.db
                  .insert(farEdge)
                  .values({
                    fromId: deleted.id,
                    graph: trashUuid,
                    uuid: task.uuid,
                    label: 'Peer',
                    kind: 'relates',
                    createdAt: new Date(0),
                    createdBySessionId: holder.id,
                  })
                  .onConflictDoUpdate({
                    target: [farEdge.fromId, farEdge.kind, farEdge.graph, farEdge.uuid],
                    set: { createdBySessionId: holder.id },
                  });
                yield* store.db.delete(meta).where(eq(meta.key, `graph-step:${shippedSteps.last}`));
              }),
            );
          });
          const check = Effect.fnUntraced(function* (opened: GraphContext) {
            const sessions = Context.get(opened, WriterRegister);
            const native = yield* sessions.idOf({ harness: 'tagma', key: 'thread-holder' });
            expect(native).not.toBeNull();
            expect(yield* sessions.idOf({ harness: 'lode', key: 'thread-holder' })).toBe(native);
            expect(
              (yield* sessions.all())
                .filter((writer) => ['thread-holder', 'older-holder'].includes(writer.key))
                .map((writer) => writer.harness),
            ).toEqual(['tagma', 'tagma']);
            const id = yield* Context.get(opened, BlockNames).idOfName(task.uuid.replaceAll('-', ''));
            expect((yield* Context.get(opened, Blocks).blockById(id)).fields.holder).toBe(native);
            const last = (yield* Context.get(opened, GraphJournal).events({ limit: 1 }))[0]!;
            expect([last.sessionId, JSON.parse(last.payload).wasFields.holder]).toEqual([native, native]);
            const { db } = Context.get(opened, GraphStore);
            expect((yield* db.select().from(block).where(eq(block.uuid, trashUuid)))[0]?.fields.holder).toBe(native);
            expect((yield* db.select().from(touch))[0]?.sessionId).toBe(native);
            expect((yield* db.select().from(edge))[0]?.createdBySessionId).toBe(native);
            expect((yield* db.select().from(farEdge))[0]?.createdBySessionId).toBe(native);
            const written = (yield* scanTree(layout.treeRoot)).blocks.find((block) => block.frontmatter.id === task.uuid);
            expect(written?.frontmatter.fields?.holder).toBe('tagma:thread-holder');
          });
          yield* Effect.scoped(
            Effect.gen(function* () {
              const pool = yield* openPool();
              yield* seed((yield* pool.resolve({ projectId: row.id, cwd: checkout })).context);
            }),
          );
          yield* files.writeFileString(join(layout.treeRoot, FORMAT_FILE), markerText('20261020210000_briefs_leave'));
          yield* Effect.scoped(
            Effect.gen(function* () {
              const pool = yield* openPool();
              const served = yield* pool.resolve({ projectId: row.id, cwd: checkout });
              yield* check(served.context);
              yield* seed(served.context);
            }),
          );
          const pool = yield* openPool();
          yield* check((yield* pool.resolve({ projectId: row.id, cwd: checkout })).context);
        }),
      ),
    );
  },
);
