import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { dirname } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { sql } from 'drizzle-orm';
import { demoGraphLayer, type EffectDemo, withDemo } from '../graphFixture.js';
import { fixtureGraphMigrations, fixtureMigrations } from '../migrations.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { sourceStore } from '../../../platform/testing/baseline.js';
import { GraphStore } from '../../../platform/contract/service/store.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BaselineReceipt } from '../../../platform/store/baseline.js';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { graphPool } from '../../../graph/testing/doubles.js';
import { resolveStorageLayout, storageHomes } from '../../../graph/storage/layout.js';
import { FORMAT_FILE, MIRROR_IDENTITY } from '../../../graph/contract/wire/storage.js';
import { markerText } from '../../../graph/tree/marker.js';
import { shippedSteps } from '../../../graph/steps/sequence.js';
import { projectToTree } from '../../../graph/tree/projection.js';
import { runGit } from '../../../platform/git/ownGit.js';
import { chain } from '../../../platform/store/chain.js';
import { ServedGraphs } from '../../../graph/contract/service/serving.js';
import { retireMirrors } from '../../../graph/storage/retirement.js';

const stored = Effect.fn('baselineFixture.stored')(function* <A>(path: string, work: (db: Database) => A) {
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => new Database(path)),
    (db) => Effect.sync(() => work(db)),
    (db) => Effect.sync(() => db.close()),
  );
});

const mirror = Effect.fn('baselineFixture.mirror')(function* (demo: EffectDemo) {
  const { id, root } = demo.project('mirror');
  const store = demo.graph.store;
  const fs = yield* FileSystem.FileSystem;
  const layout = yield* resolveStorageLayout({ mode: 'team', projectId: id, ...storageHomes(store.path), worktree: root });
  yield* projectToTree({ projectId: id, treeRoot: layout.treeRoot }).pipe(Effect.provide(demo.context));
  yield* fs.writeFileString(join(layout.treeRoot, FORMAT_FILE), markerText(shippedSteps.last));
  yield* fs.makeDirectory(dirname(layout.mirrorPath), { recursive: true });
  yield* Effect.sync(() => sourceStore(layout.mirrorPath, fixtureMigrations));
  yield* stored(layout.mirrorPath, (db) => {
    db.exec('PRAGMA foreign_keys = OFF');
    db.query('attach database ? as machine').run(store.path);
    const columns = (table: string) =>
      db
        .query<{ name: string }, []>(`select name from pragma_table_info('${table}')`)
        .all()
        .map((column) => column.name)
        .join(', ');
    db.exec(`insert into project (id, name, repo_key, root_path, created_at, global)
      select id, name, repo_key, root_path, created_at, kind = 'global' from machine.project`);
    db.query(`insert into block (${columns('block')}) select ${columns('block')} from machine.block where project_id = ?`).run(id);
    db.exec('detach database machine');
    db.query('insert into meta (key, value) values (?, ?)').run('moved-project', String(id));
    db.exec("insert into event (ts, op, payload) values (1, 'kept', 'original')");
  });
  return { id, root, layout, store };
});

layer(
  demoGraphLayer({
    repos: ['mirror'],
    source: 'mirror',
    prepareEffect: (demo) => Effect.asVoid(demo.graph.projectPolicy.setStorage({ id: demo.project('mirror').id, mode: 'team' })),
  }).pipe(Layer.provideMerge(BunFileSystem.layer)),
  { excludeTestServices: true },
)('baseline mirrors', (it) => {
  it.effect('a changed migration chain refuses serving without changing the mirror ledger or history', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { id, root, layout } = yield* mirror(demo);
          yield* stored(layout.mirrorPath, (db) => db.query('update __drizzle_migrations set hash = ? where id = 1').run('rewritten'));
          const before = yield* stored(layout.mirrorPath, (db) => db.query('select * from __drizzle_migrations order by id').all());
          const pool = yield* Effect.acquireRelease(
            graphPool({ machine: demo.context, sourcePath: root, identity: testSessionIdentity, migrations: fixtureGraphMigrations }),
            (pool) => pool.dispose(),
          );
          const refused = yield* demo.refusal(pool.resolve({ projectId: id }));
          expect(refused.code).toBe('graph-pool');
          expect(refused.reason).toContain('MigrationChainInvalid');
          expect(yield* stored(layout.mirrorPath, (db) => db.query('select * from __drizzle_migrations order by id').all())).toEqual(
            before,
          );
          expect(yield* stored(layout.mirrorPath, (db) => db.query("select ts, op, payload from event where op = 'kept'").all())).toEqual([
            { ts: 1, op: 'kept', payload: 'original' },
          ]);
        }),
      ),
    ),
  );

  it.effect('a rebuilt mirror keeps its blocks and follows its branch through hot and cold renames', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { id, root, layout } = yield* mirror(demo);
          const receipt = JSON.parse(readFileSync(join(fixtureMigrations.folder, 'baseline.json'), 'utf8')) as BaselineReceipt;
          const original = yield* Context.get(demo.context, Blocks).rootBlockOf(id);
          yield* stored(layout.mirrorPath, (db) =>
            db.query('delete from __drizzle_migrations where name = ?').run(receipt.chain.at(-1)!.name),
          );
          const pool = yield* Effect.acquireRelease(
            graphPool({ machine: demo.context, sourcePath: root, identity: testSessionIdentity, migrations: fixtureGraphMigrations }),
            (pool) => pool.dispose(),
          );
          const opened = yield* pool.resolve({ projectId: id });
          expect((yield* Context.get(opened.context, Blocks).rootBlockOf(id)).uuid).toBe(original.uuid);
          const graph = Context.get(opened.context, GraphStore);
          expect(yield* graph.db.all(sql`select ts, op, payload from event where op = 'kept'`)).toEqual([]);
          const saved = yield* graph.db.all<{ value: string }>(sql`select value from meta where key = ${MIRROR_IDENTITY}`);
          expect(JSON.parse(saved[0]!.value)).toMatchObject({ projectId: id, checkout: root, treeRoot: layout.treeRoot, mode: 'team' });
          yield* pool.release({ projectId: id, checkout: root });
          const files = yield* FileSystem.FileSystem;
          const git = demo.graph.git;
          const run = (...args: string[]) => runGit(git, 'mirror-rename-fixture', ['-C', root, ...args]);
          yield* run('add', '--', '.tagma');
          yield* run('commit', '--allow-empty', '-m', 'graph for branch');
          const checkout = join(dirname(root), 'renamed-copy');
          yield* run('worktree', 'add', '-b', 'before', checkout);
          const branchGraph = yield* pool.resolve({ projectId: id, cwd: checkout });
          const path = branchGraph.layout.mirrorPath;
          const rename = (from: string, to: string) =>
            pool.followBranch(
              { projectId: id, checkout, from, to },
              runGit(git, 'mirror-rename-fixture', ['-C', checkout, 'branch', '-m', from, to]),
            );
          yield* rename('before', 'served-name');
          const hot = yield* Context.get(branchGraph.context, GraphStore).db.all<{ value: string }>(
            sql`select value from meta where key = ${MIRROR_IDENTITY}`,
          );
          expect(JSON.parse(hot[0]!.value).branch).toBe('served-name');
          yield* pool.release({ projectId: id, checkout });
          yield* rename('served-name', 'closed-name');
          const current = yield* stored(
            path,
            (db) => db.query<{ value: string }, [string]>('select value from meta where key = ?').get(MIRROR_IDENTITY)!.value,
          );
          expect(JSON.parse(current).branch).toBe('closed-name');
          const baseline = chain(fixtureGraphMigrations)[0]!.name;
          yield* stored(path, (db) => db.query('delete from __drizzle_migrations where name = ?').run(baseline));
          yield* rename('closed-name', 'older-name');
          expect(
            yield* stored(
              path,
              (db) => db.query<{ value: string }, [string]>('select value from meta where key = ?').get(MIRROR_IDENTITY)!.value,
            ),
          ).toBe(current);
          yield* run('worktree', 'remove', '--force', checkout);
          yield* retireMirrors({ baseline }).pipe(Effect.provide(demo.context), Effect.provideService(ServedGraphs, pool));
          expect(yield* files.exists(path)).toBe(true);
        }),
      ),
    ),
  );
});
