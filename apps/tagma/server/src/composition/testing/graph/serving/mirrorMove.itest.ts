import { expect } from 'bun:test';
import { join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Tracer } from 'effect';
import { sql } from 'drizzle-orm';
import { GraphStore } from '../../../../platform/contract/service/store.js';
import { ProjectLifecycle } from '../../../../graph/contract/service/serving.js';
import { Projects } from '../../../../projects/contract/service/registry.js';
import { storeLayer } from '../../../../platform/store/open.js';
import { fixtureGraphMigrations } from '../../migrations.js';
import { resolveStorageLayout, storageHomes } from '../../../../graph/storage/layout.js';
import { FORMAT_FILE } from '../../../../graph/contract/wire/storage.js';
import { markerText } from '../../../../graph/tree/marker.js';
import { shippedSteps } from '../../../../graph/steps/sequence.js';
import { runGit } from '../../../../platform/git/ownGit.js';
import { servingLayer } from './fixture.js';
import { withDemo } from '../../graphFixture.js';
import { graphPool } from '../../../../graph/testing/doubles.js';
import { testSessionIdentity } from '../../../../platform/testing/identity.js';

const tagged = (store: GraphStore['Service'], projectId: number) =>
  store.db.all<{ uuid: string; tag: string; typeId: string | null }>(
    sql`select b.uuid, t.tag, t.type_id as typeId from block_tag t join block b on b.id=t.block_id where b.project_id=${projectId} order by b.uuid,t.tag`,
  );
const journal = (store: GraphStore['Service'], projectId: number) =>
  store.db.all<{ id: number; op: string }>(sql`select id,op from event where project_id=${projectId} order by id`);

layer(servingLayer, { excludeTestServices: true })('mirror moves', (it) => {
  it.effect('a failed move rolls back every project row, then moves tags and journal whole', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* demo.fixture.directory('moved');
          const row = yield* demo.graph.projectLifecycle.create({ name: 'moved', rootPath: root, storage: 'stealth' });
          const layout = yield* resolveStorageLayout({
            mode: 'stealth',
            projectId: row.id,
            ...storageHomes(demo.graph.store.path),
            worktree: row.rootPath,
          });
          const store = demo.graph.graphStore;
          const expected = yield* tagged(store, row.id);
          const history = yield* journal(store, row.id);
          expect(expected.length).toBeGreaterThan(0);
          expect(expected.every((row) => row.typeId !== null)).toBe(true);
          expect(history.length).toBeGreaterThan(0);
          const pool = yield* Effect.acquireRelease(
            graphPool({
              machine: demo.context,
              sourcePath: demo.project('repo').root,
              identity: testSessionIdentity,
              migrations: fixtureGraphMigrations,
            }),
            (pool) => pool.dispose(),
          );
          yield* store.db.run(sql`alter table block_field add column fault integer`);
          expect((yield* demo.refusal(pool.resolve({ projectId: row.id }))).code).toBe('graph-pool');
          const left = yield* Effect.gen(function* () {
            return yield* (yield* GraphStore).db.all<{ n: number }>(sql`select count(*) as n from block where project_id=${row.id}`);
          }).pipe(
            Effect.provide(storeLayer(GraphStore, layout.mirrorPath, fixtureGraphMigrations, { readers: 0 }, demo.graph.store.processes)),
          );
          expect(left).toEqual([{ n: 0 }]);
          yield* store.db.run(sql`alter table block_field drop column fault`);
          const served = yield* pool.resolve({ projectId: row.id });
          const moved = Context.get(served.context, GraphStore);
          expect(yield* tagged(moved, row.id)).toEqual(expected);
          const ids = new Set(history.map((row) => row.id));
          expect((yield* journal(moved, row.id)).filter((row) => ids.has(row.id))).toEqual(history);
        }),
      ),
    ),
  );

  it.effect('project birth stamps the switch commit once, and the global baseline opens without graph steps', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* Effect.acquireRelease(
            graphPool({
              machine: demo.context,
              sourcePath: demo.project('repo').root,
              identity: testSessionIdentity,
              migrations: fixtureGraphMigrations,
            }),
            (pool) => pool.dispose(),
          );
          const root = yield* demo.fixture.directory('born');
          const row = yield* (yield* ProjectLifecycle).create({ name: 'born', rootPath: root, storage: 'stealth' }, (born) =>
            pool.birth(born.id),
          );
          const layout = yield* resolveStorageLayout({
            mode: 'stealth',
            projectId: row.id,
            ...storageHomes(demo.graph.store.path),
            worktree: row.rootPath,
          });
          expect(yield* runGit(demo.graph.git, 'marked', ['-C', layout.treeRoot, 'log', '--format=%s', '--', FORMAT_FILE])).toBe(
            'the serving switch',
          );
          expect(yield* runGit(demo.graph.git, 'marker', ['-C', layout.treeRoot, 'show', `HEAD:${FORMAT_FILE}`])).toBe(
            markerText(shippedSteps.last).trim(),
          );
          const global = yield* (yield* Projects).global();
          if (global === undefined) return yield* Effect.die('the fixture has no global project');
          const advances: Tracer.NativeSpan[] = [];
          const tracer = Tracer.make({
            span: (options) => {
              const span = new Tracer.NativeSpan(options);
              if (options.name === 'Graph.advanceTree') advances.push(span);
              return span;
            },
          });
          yield* pool.resolve({ projectId: global.id }).pipe(Effect.withTracer(tracer));
          expect([...new Set(advances.map((span) => span.attributes.get('graph.steps.passed')))]).toEqual([false]);
        }),
      ),
    ),
  );

  it.effect('an unreadable tree refuses without retiring rows and recovers when readable', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* demo.fixture.directory('unread');
          const row = yield* demo.graph.projectLifecycle.create({ name: 'unread', rootPath: root, storage: 'stealth' });
          const layout = yield* resolveStorageLayout({
            mode: 'stealth',
            projectId: row.id,
            ...storageHomes(demo.graph.store.path),
            worktree: row.rootPath,
          });
          const expected = yield* tagged(demo.graph.graphStore, row.id);
          expect(expected.length).toBeGreaterThan(0);
          const pool = yield* Effect.acquireRelease(
            graphPool({
              machine: demo.context,
              sourcePath: demo.project('repo').root,
              identity: testSessionIdentity,
              migrations: fixtureGraphMigrations,
            }),
            (pool) => pool.dispose(),
          );
          const fs = yield* FileSystem.FileSystem;
          const locked = join(layout.treeRoot, 'locked');
          yield* fs.makeDirectory(locked, { recursive: true });
          yield* fs.chmod(locked, 0);
          const refused = yield* demo
            .refusal(pool.resolve({ projectId: row.id }))
            .pipe(Effect.ensuring(fs.chmod(locked, 0o755).pipe(Effect.orDie)));
          expect(refused.code).toBe('graph-pool');
          const served = yield* pool.resolve({ projectId: row.id });
          expect(yield* tagged(Context.get(served.context, GraphStore), row.id)).toEqual(expected);
        }),
      ),
    ),
  );
});
