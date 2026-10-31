import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActivityStore, activityStoreLayer } from '@runlith/activity/store';
import { ActivityRecord } from '@runlith/activity/store/record';
import { activity } from '@runlith/activity/Activity';
import { ActivityLog } from '@runlith/activity/log';
import { MODEL_CALL } from '@runlith/activity/modelCall';
import { PerformanceStoreReader, performanceStoreLayer } from '@runlith/performance/PerformanceStore';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { childHosting } from '@runlith/sqlite-process/children';
import { Clock, Context, Effect, Layer } from 'effect';
import { PREPARATION } from './composed.js';

BunRuntime.runMain(
  Effect.scoped(
    Effect.gen(function* () {
      const root = process.argv[2]!;
      const prepared = yield* Layer.build(PREPARATION);
      const telemetry = yield* Layer.build(
        performanceStoreLayer({
          path: join(root, 'performance.sqlite'),
          instanceId: 'startup',
          maxPendingBytes: () => 1_000_000,
          maxStoredBytes: () => 1_000_000,
        }).pipe(Layer.provide(Layer.succeedContext(prepared))),
      );
      yield* Context.get(telemetry, PerformanceStoreReader).read({ type: 'vitals', limit: 1 });
      const processes = yield* Effect.acquireRelease(
        Effect.sync(() => new ProcessPool(0, 'stop', undefined, childHosting)),
        (pool) => Effect.promise(() => pool.close()),
      );
      const context = yield* Layer.build(
        activityStoreLayer({
          database: join(root, 'activity.sqlite'),
          bodies: join(root, 'bodies'),
          migrations: fileURLToPath(new URL('../../drizzle', import.meta.resolve('@runlith/activity/store'))),
          keeping: () => ({ hours: 24, bodiesMaxBytes: 1_000_000 }),
          upkeepAfter: Effect.never,
          projectsOf: (threads) => Effect.succeed(new Map(threads.map((id) => [id, 7]))),
          processes,
        }).pipe(Layer.provide(Layer.succeedContext(prepared))),
      );
      const store = Context.get(context, ActivityStore);
      yield* activity(MODEL_CALL, { provider: 'probe', model: 'probe', rung: 'high' }, Effect.void, { thread: 'thread' }).pipe(
        Effect.provideService(ActivityLog, store.log),
      );
      yield* store.settled;
      const rows = yield* Context.get(context, ActivityRecord).rows({
        project: 7,
        through: yield* Clock.currentTimeMillis,
        where: [],
        paths: ['thread'],
        limit: 1,
      });
      const db = new Database(':memory:');
      try {
        const source = db.query<{ source: string }, []>('select sqlite_source_id() as source').get()!.source;
        console.log(JSON.stringify({ source, health: (yield* store.health).state, rows: rows.rows.map((row) => row.values) }));
      } finally {
        db.close();
      }
    }),
  ),
);
