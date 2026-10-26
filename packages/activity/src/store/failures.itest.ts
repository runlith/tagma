import { describe, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from '@runlith/effect-test';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { Context, Duration, Effect, Layer } from 'effect';
import { TestClock } from 'effect/testing';
import type { ActivityOpened } from '../fact';
import { ActivityStore, type ActivityStoreConfig, activityStoreLayer } from './ActivityStore';
import { ActivityRecord } from './record';

class Fixture extends Context.Service<Fixture, ActivityStoreConfig>()('@runlith/activity/test/Fixture') {}

const fixture = Layer.unwrap(
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'activity-failures-'))),
      (at) => Effect.sync(() => rmSync(at, { recursive: true, force: true })),
    );
    const config = {
      database: join(root, 'activity.sqlite'),
      bodies: join(root, 'bodies'),
      processes: yield* heldPool,
      migrations: fileURLToPath(new URL('../../drizzle', import.meta.url)),
      keeping: () => ({ hours: 24, bodiesMaxBytes: 1024 * 1024 }),
      projectsOf: (threads: readonly string[]) =>
        Effect.succeed(new Map(threads.filter((id) => id !== 'missing').map((thread) => [thread, 7]))),
    };
    return Layer.orDie(activityStoreLayer(config)).pipe(
      Layer.provideMerge(TestClock.layer()),
      Layer.provideMerge(Layer.succeed(Fixture, config)),
    );
  }),
);

const opened = (id: string, thread: string, attrs: object = {}): ActivityOpened => ({
  _tag: 'Opened',
  id,
  thread,
  attrs,
  at: 0,
  parent: null,
  run: null,
  project: null,
  kind: 'work',
  actor: { kind: 'operator' },
  trigger: null,
});
const reading = { threads: ['missing'], through: 100, since: 0, where: [], paths: ['id'], limit: 1 } as const;

describe('the activity store under failure', () => {
  it.live('an absent project mapping is counted even when project lookup succeeded', () =>
    Effect.gen(function* () {
      const store = yield* ActivityStore;
      store.log.record(opened('unscoped', 'missing'));
      const answer = yield* Effect.flatMap(ActivityRecord, (record) => record.rows(reading));
      expect(answer.rows.map((row) => row.values)).toEqual([{ id: 'unscoped' }]);
      expect(answer.lost).toEqual([{ scope: 'global', unknown: false, cause: 'unattributed', facts: 1, bodies: 0, bytes: 0 }]);
    }).pipe(Effect.provide(fixture)),
  );

  it.live('a failed flush reaches empty-read coverage immediately and retry is driven after the producer goes quiet', () =>
    Effect.gen(function* () {
      const attrs: { self?: object } = {};
      attrs.self = attrs;
      const store = yield* ActivityStore;
      store.log.record(opened('bad', 'bad', attrs));
      const answer = yield* Effect.flatMap(ActivityRecord, (record) => record.rows({ ...reading, threads: ['bad'] }));
      expect(answer.rows).toEqual([]);
      expect(answer.lost).toContainEqual(expect.objectContaining({ scope: 'global', cause: 'unwritten', facts: 1 }));
      const health = yield* store.health;
      expect(health.state).toBe('degraded');
      expect(health.retryAt).toBe(1000);
      yield* TestClock.adjust(Duration.seconds(1));
      while (true) {
        const next = yield* store.health;
        if (next.state === 'live' && next.retryAt === null) break;
        yield* TestClock.adjust(1);
        yield* TestClock.withLive(Effect.sleep(1));
      }
      expect(yield* store.health).toMatchObject({ state: 'live', pending: 0, retryAt: null, lost: [] });
      const persisted = yield* Effect.flatMap(ActivityRecord, (record) => record.rows({ ...reading, threads: ['bad'], through: 1000 }));
      expect(persisted.lost).toContainEqual(expect.objectContaining({ scope: 'global', cause: 'unwritten', facts: 1 }));
    }).pipe(Effect.provide(fixture)),
  );

  it.live('a missing startup resource reports degradation without retiring a healthy database', () =>
    Effect.gen(function* () {
      const config = yield* Fixture;
      const healthy = yield* ActivityStore;
      healthy.log.record(opened('retained', 'healthy'));
      yield* healthy.settled;
      const unavailable = yield* Layer.build(
        activityStoreLayer({ ...config, migrations: join(config.database, '..', 'absent-migrations') }),
      );
      const store = Context.get(unavailable, ActivityStore);
      expect((yield* store.health).state).toBe('degraded');
      store.log.record(opened('discarded', 'missing'));
      expect(yield* store.settled).toEqual({ unwritten: 1 });
      const answer = yield* Effect.result(Context.get(unavailable, ActivityRecord).rows(reading));
      expect(answer._tag).toBe('Failure');
      const original = yield* Effect.flatMap(ActivityRecord, (record) => record.activity('retained'));
      expect(original?.id).toBe('retained');
    }).pipe(Effect.provide(fixture)),
  );
});
