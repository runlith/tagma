import { expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layer } from '@runlith/effect-test';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { activity, degraded } from '../Activity';
import { activityKind } from '../fact';
import { ActivityLog } from '../log';
import { ActivityStore, activityStoreLayer } from './ActivityStore';
import { ActivityFaults } from './faults';

const fixture = Layer.unwrap(
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'activity-faults-'))),
      (at) => Effect.sync(() => rmSync(at, { recursive: true, force: true })),
    );
    return Layer.orDie(
      activityStoreLayer({
        database: join(root, 'activity.sqlite'),
        bodies: join(root, 'bodies'),
        processes: yield* heldPool,
        migrations: fileURLToPath(new URL('../../drizzle', import.meta.url)),
        keeping: () => ({ hours: 24, bodiesMaxBytes: 1024 * 1024 }),
        projectsOf: (threads) => Effect.succeed(new Map(threads.map((thread) => [thread, 7]))),
      }),
    );
  }),
);

const STEP = activityKind<{ readonly n: number }>('step');
const RUN = activityKind<{ readonly n: number }>('run');

const recorded = Effect.fnUntraced(function* <A, E>(work: Effect.Effect<A, E>) {
  const store = yield* ActivityStore;
  const exit = yield* Effect.exit(Effect.provideService(work, ActivityLog, store.log));
  yield* store.settled;
  return exit;
});

layer(fixture, { excludeTestServices: true })('activity faults', (it) => {
  it.effect('defects group by place and message, survive nesting once, and a clear hides what came before it', () =>
    Effect.gen(function* () {
      const faults = yield* ActivityFaults;
      const ticked = yield* Deferred.make<void>();
      const watching = yield* Effect.forkChild(Stream.runForEach(faults.changes, () => Deferred.succeed(ticked, undefined)));
      yield* Effect.yieldNow;
      yield* recorded(activity(RUN, { n: 1 }, activity(STEP, { n: 1 }, Effect.die(new TypeError('row 41 broke'))), { thread: 't1' }));
      yield* recorded(activity(STEP, { n: 2 }, Effect.die(new TypeError('row 42 broke')), { thread: 't2' }));
      const survived = yield* recorded(
        activity(
          RUN,
          { n: 3 },
          degraded('preview', 'presentation only', Effect.die(new Error('no title')), () => 'none'),
          {
            thread: 't3',
          },
        ),
      );
      yield* Deferred.await(ticked);
      yield* Fiber.interrupt(watching);
      expect(survived).toMatchObject({ _tag: 'Success', value: 'none' });

      const page = yield* faults.read({ limit: 10 });
      expect(page.total).toBe(2);
      expect(page.next).toBeNull();
      expect(page.faults.map(({ kind, place, count, thread, project }) => ({ kind, place, count, thread, project }))).toEqual([
        { kind: 'degraded', place: 'preview', count: 1, thread: 't3', project: 7 },
        { kind: 'defect', place: 'step', count: 2, thread: 't2', project: 7 },
      ]);
      expect(page.faults[1]?.message).toBe('row 42 broke');
      expect(page.faults[1]?.stack).toContain('TypeError: row 42 broke');

      const first = yield* faults.read({ limit: 1 });
      const rest = first.next === null ? null : yield* faults.read({ limit: 1, after: first.next });
      expect([...first.faults, ...(rest?.faults ?? [])].map((fault) => fault.place)).toEqual(['preview', 'step']);
      expect({ total: rest?.total, next: rest?.next }).toEqual({ total: 2, next: null });

      yield* faults.clear;
      expect((yield* faults.read({ limit: 10 })).faults).toEqual([]);
      yield* Effect.sleep('2 millis');
      yield* recorded(activity(STEP, { n: 4 }, Effect.die(new TypeError('row 43 broke')), { project: 5 }));
      expect((yield* faults.read({ limit: 10 })).faults.map(({ count, thread, project }) => ({ count, thread, project }))).toEqual([
        { count: 1, thread: null, project: 5 },
      ]);
    }),
  );
});
