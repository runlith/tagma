import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Deferred, Effect, Fiber, FileSystem, Layer } from 'effect';
import { eq } from 'drizzle-orm';
import { Git } from '@runlith/git/Git';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { runGit } from '../../platform/git/ownGit.js';
import { Blocks } from '../contract/service/blocks.js';
import { BlockReads } from '../contract/service/reads.js';
import { GraphFeed } from '../contract/service/journal.js';
import { Catalogs, NO_CATALOGS } from '../contract/wire/catalogs.js';
import { block } from '../store/tables.js';
import { machineGraphOf } from './machine.js';
import { graphPool } from '../testing/doubles.js';
import { treeGateKey } from './permits.js';

layer(demoGraphLayer({ repos: ['drill'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'graph concurrency',
  (it) => {
    it.effect(
      'reads return the committed snapshot while the stale tree or its mirror writer is held, acts and reads finish while git publishes, and the next batch commits every concurrent act',
      () =>
        withDemo(({ graph, context, project, demoRoot, as }) =>
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const projectId = project('drill').id;
              const open = yield* Deferred.make<void>();
              const release = yield* Deferred.make<void>();
              let holding = false;
              const delayed = Git.of({
                ...graph.git,
                run: Effect.fnUntraced(function* (args, options) {
                  if (holding && args.includes('fast-import')) {
                    holding = false;
                    yield* Deferred.succeed(open, undefined);
                    yield* Deferred.await(release);
                  }
                  return yield* graph.git.run(args, options);
                }),
              });
              const machine = machineGraphOf(Context.add(context, Catalogs, NO_CATALOGS).pipe(Context.add(Git, delayed)));
              const pool = yield* Effect.acquireRelease(
                graphPool({ migrations: fixtureGraphMigrations, identity: testSessionIdentity, machine, sourcePath: demoRoot }),
                (held) => held.dispose(),
              );
              yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
              const served = yield* pool.resolve({ projectId });
              const drillRoot = (yield* Context.get(served.context, Blocks).rootBlockOf(projectId).pipe(Effect.provide(served.context))).id;
              const target = yield* as(
                'drill',
                Context.get(served.context, Blocks).create({
                  projectId,
                  parentId: drillRoot,
                  tags: ['idea'],
                  title: 'Read Target',
                  body: 'committed',
                }),
              ).pipe(Effect.provide(served.context));
              yield* served.settled(true);
              const store = Context.get(served.context, GraphStore);
              const read = Effect.gen(function* () {
                yield* served.fresh();
                return yield* Context.get(served.context, BlockReads).show(target.id, 0);
              }).pipe(Effect.provide(served.context));
              const row = yield* store.db.select({ path: block.path }).from(block).where(eq(block.id, target.id)).get();
              if (row?.path == null) return yield* Effect.die('the read target has no projected path');
              const file = join(served.layout.treeRoot, row.path);
              const changed = yield* Deferred.make<void>();
              yield* Effect.acquireRelease(
                Context.get(served.context, GraphFeed).subscribe(projectId, (frame) => {
                  if (frame.type === 'resync') Deferred.doneUnsafe(changed, Effect.void);
                }),
                (unsubscribe) => Effect.sync(unsubscribe),
              );
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const open = yield* Deferred.make<void>();
                  const release = yield* Deferred.make<void>();
                  const holder = yield* pool
                    .gate(treeGateKey(served.layout.treeRoot))
                    .withPermits(1)(Effect.andThen(Deferred.succeed(open, undefined), Deferred.await(release)))
                    .pipe(Effect.forkScoped);
                  yield* Deferred.await(open);
                  yield* fs.writeFileString(file, (yield* fs.readFileString(file)).replace('title: Read Target', 'title: Edited By Hand'));
                  expect(yield* read).toMatchObject({ id: target.id, title: 'Read Target', body: 'committed' });
                  yield* Deferred.succeed(release, undefined);
                  yield* Fiber.join(holder);
                }),
              );
              yield* Deferred.await(changed);
              expect((yield* store.db.select().from(block).where(eq(block.id, target.id)).get())?.title).toBe('Edited By Hand');

              yield* Effect.scoped(
                Effect.gen(function* () {
                  const open = yield* Deferred.make<void>();
                  const release = yield* Deferred.make<void>();
                  const holder = yield* store
                    .transaction(writes('drill.hold', [block]), () =>
                      Effect.gen(function* () {
                        yield* store.db.update(block).set({ title: 'Uncommitted' }).where(eq(block.id, target.id));
                        yield* Deferred.succeed(open, undefined);
                        yield* Deferred.await(release);
                      }),
                    )
                    .pipe(Effect.forkScoped);
                  yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
                  yield* Deferred.await(open);
                  expect(yield* read).toMatchObject({ id: target.id, title: 'Edited By Hand', body: 'committed' });
                  yield* Deferred.succeed(release, undefined);
                  yield* Fiber.join(holder);
                }),
              );
              expect((yield* store.readOnly((db) => db.select().from(block).where(eq(block.id, target.id)).get()))?.title).toBe(
                'Uncommitted',
              );

              yield* pool.release(served);
              const again = yield* pool.resolve({ projectId });
              const git = (...args: string[]) => runGit(graph.git, 'drill', args, { cwd: again.layout.treeRoot });
              const before = yield* git('rev-parse', 'HEAD');
              const create = (title: string) =>
                as(
                  'drill',
                  Context.get(again.context, Blocks).create({ projectId, parentId: drillRoot, tags: ['idea'], title, body: title }),
                ).pipe(Effect.provide(again.context));
              holding = true;
              const first = yield* create('First');
              yield* Deferred.await(open);
              const born = yield* Effect.forEach(['Left', 'Right'], create, { concurrency: 2 });
              const ids = [first, ...born];
              const reads = yield* Effect.forEach(
                ids,
                (row) =>
                  Effect.andThen(again.fresh(), Context.get(again.context, BlockReads).show(row.id, 0)).pipe(Effect.provide(again.context)),
                { concurrency: 2 },
              );
              expect(reads.map((row) => [row.uuid, row.body])).toEqual(ids.map((row) => [row.uuid, row.title]));
              yield* Deferred.succeed(release, undefined);
              yield* pool.release(again);
              expect(yield* git('status', '--porcelain')).toBe('');
              const commits = Number(yield* git('rev-list', '--count', `${before}..HEAD`));
              expect(commits).toBeLessThan(ids.length);
              const tracked = yield* git('grep', '-h', '-F', ...ids.flatMap((row) => ['-e', `id: ${row.uuid}`]), 'HEAD');
              expect(tracked.trim().split('\n').sort()).toEqual(ids.map((row) => `id: ${row.uuid}`).sort());
            }),
          ),
        ),
    );
  },
);
