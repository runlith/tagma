import { expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from '@runlith/effect-test';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { Context, Deferred, Effect, Layer } from 'effect';
import { activity, note } from '../Activity';
import { MODEL_CALL } from '../modelCall';
import { ActivityLog } from '../log';
import { ActivityStore, activityPreparationLayer, activityStoreLayer } from './ActivityStore';
import { ActivityRecord } from './record';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
const EVER = Number.MAX_SAFE_INTEGER;

it.live('upkeep removes nothing until the moment its owner names has come', () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'activity-upkeep-'))),
      (at) => Effect.sync(() => rmSync(at, { recursive: true, force: true })),
    );
    const door = yield* Deferred.make<void>();
    const built = yield* Layer.build(
      Layer.orDie(
        activityStoreLayer({
          database: join(root, 'activity.sqlite'),
          bodies: join(root, 'bodies'),
          processes: yield* heldPool,
          migrations: MIGRATIONS,
          keeping: () => ({ hours: 1, bodiesMaxBytes: 2_000 }),
          upkeepAfter: Deferred.await(door),
          projectsOf: (threads) => Effect.succeed(new Map(threads.map((thread) => [thread, null]))),
        }).pipe(Layer.provide(activityPreparationLayer)),
      ),
    );
    const store = Context.get(built, ActivityStore);
    const record = Context.get(built, ActivityRecord);
    const lost = Effect.map(
      record.groups({ threads: ['thread-a'], through: EVER, where: [], group: [], count: true, sum: [], offset: 0, limit: 1 }),
      (read) => read.lost.length,
    );
    const encoded = (text: string) => ({ kind: 'request', encoded: new TextEncoder().encode(text), contentType: 'text/plain' });
    yield* activity(MODEL_CALL, { provider: 'subscription', model: 'opus', rung: 'high' }, note({ type: 'http-started' }), {
      thread: 'thread-a',
      bodies: [encoded('a'.repeat(1_200))],
      ended: () => ({ result: { finish: 'stop' }, bodies: [encoded('x'.repeat(1_200))] }),
    }).pipe(Effect.provideService(ActivityLog, store.log));
    yield* store.settled;
    yield* Effect.sleep('100 millis');
    expect(yield* lost).toBe(0);

    yield* Deferred.succeed(door, undefined);
    for (let tries = 0; tries < 100 && (yield* lost) === 0; tries += 1) yield* Effect.sleep('20 millis');
    expect(yield* lost).toBe(1);
  }),
);
