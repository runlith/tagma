import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Deferred, Effect, Fiber, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { FileWatcher } from '../../platform/contract/service/watch.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { Catalogs, NO_CATALOGS } from '../contract/wire/catalogs.js';
import { Selection } from '../contract/service/reads.js';
import { storageHomes, resolveStorageLayout } from '../storage/layout.js';
import { graphPool } from '../testing/doubles.js';

layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('opening graph ownership', (it) => {
  it.effect('cancelling while its watch opens releases the mirror and registration before a fresh resolve', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const watching = yield* Deferred.make<void>();
        const ready = yield* Deferred.make<void>();
        const closed = yield* Deferred.make<void>();
        let blocked = true;
        let subscribed = false;
        const watcher = FileWatcher.of({
          subscribe: () =>
            blocked
              ? Effect.gen(function* () {
                  subscribed = true;
                  yield* Deferred.succeed(watching, undefined);
                  yield* Deferred.await(ready);
                  return { close: Effect.asVoid(Deferred.succeed(closed, undefined)) };
                })
              : Effect.succeed({ close: Effect.void }),
          mark: () => Effect.succeed('mark'),
          settle: () => Effect.succeed(true),
          changedSince: () => Effect.succeed([]),
          marking: 'refresh',
          heardLateMs: 0,
        });
        const row = yield* demo.graph.projectPolicy.setStorage({ id: demo.projectId, mode: 'stealth' });
        const layout = yield* resolveStorageLayout({
          mode: 'stealth',
          projectName: row.name,
          ...storageHomes(demo.graph.store.path),
          worktree: row.rootPath,
        });
        const pool = yield* Effect.acquireRelease(
          graphPool({
            machine: Context.add(Context.add(demo.context, Catalogs, NO_CATALOGS), FileWatcher, watcher),
            sourcePath: demo.demoRoot,
            identity: testSessionIdentity,
            migrations: fixtureGraphMigrations,
          }),
          (held) => held.dispose(),
        );
        const resolve = pool.resolve({ projectId: row.id }).pipe(Effect.provideService(FileWatcher, watcher));
        yield* Effect.addFinalizer(() =>
          subscribed ? Effect.andThen(Deferred.succeed(ready, undefined), Deferred.await(closed)) : Effect.void,
        );
        const opening = yield* Effect.forkScoped(resolve);
        yield* Deferred.await(watching);
        yield* Fiber.interrupt(opening);
        yield* Deferred.succeed(ready, undefined);
        yield* Deferred.await(closed);
        expect((yield* Effect.flip(pool.freshnessGate.copyFailures(layout.treeRoot))).code).toBe('not-served');
        blocked = false;
        const served = yield* resolve;
        expect((yield* Context.get(served.context, Selection).roots(row.id)).map((root) => root.title)).toEqual(['demo']);
      }),
    ),
  );
});
