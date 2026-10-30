import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from '@runlith/effect-test';
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { childPool } from '@runlith/sqlite-process/testing/pool';
import { ActivityStore, activityStoreLayer } from './ActivityStore';

it.live('disposal retires a really blocked writer before joining its store fibers and reports unwritten work', () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'activity-shutdown-'))),
      (at) => Effect.sync(() => rmSync(at, { recursive: true, force: true })),
    );
    const database = join(root, 'activity.sqlite');
    const taken = yield* Deferred.make<void>();
    const storeScope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(storeScope, Exit.void));
    const built = yield* Layer.buildWithScope(
      activityStoreLayer({
        database,
        bodies: join(root, 'bodies'),
        migrations: fileURLToPath(new URL('../../drizzle', import.meta.url)),
        keeping: () => ({ hours: 24, bodiesMaxBytes: 1024 * 1024 }),
        processes: childPool(0),
        upkeepAfter: Effect.never,
        projectsOf: (threads) => Deferred.succeed(taken, undefined).pipe(Effect.as(new Map(threads.map((id) => [id, 7])))),
      }).pipe(Layer.provideMerge(TestClock.layer())),
      storeScope,
    );
    const store = yield* Effect.provide(ActivityStore, built);
    const holder = yield* Effect.acquireRelease(
      Effect.sync(() => new Database(database)),
      (opened) =>
        Effect.sync(() => {
          opened.exec('ROLLBACK');
          opened.close();
        }),
    );
    holder.exec('BEGIN IMMEDIATE');
    store.log.record({
      _tag: 'Opened',
      id: 'blocked',
      at: 0,
      parent: null,
      thread: 'thread',
      run: null,
      project: null,
      kind: 'work',
      actor: { kind: 'operator' },
      trigger: null,
      attrs: {},
    });
    yield* Effect.provide(TestClock.adjust(Duration.millis(100)), built);
    yield* Deferred.await(taken);
    const closing = yield* Effect.forkChild(Scope.close(storeScope, Exit.void));
    yield* Effect.yieldNow;
    yield* Effect.provide(TestClock.adjust(Duration.seconds(10)), built);
    yield* Fiber.join(closing);
    expect(yield* store.health).toMatchObject({ state: 'closed' });
    expect((yield* store.settled).unwritten).toBeGreaterThanOrEqual(1);
    expect(holder.query('select count(*) as count from activity').get()).toEqual({ count: 0 });
  }),
);
