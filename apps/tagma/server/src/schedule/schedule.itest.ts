import { fixtureMigrations } from '../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Context, Deferred, Effect, Exit, Fiber, Layer, Queue, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { seededStoreLayer } from '../platform/store/open.js';
import { unitsLayer } from '../platform/store/units.js';
import { Schedules } from './contract/service/schedules.js';
import { ScheduleContributions, type ScheduleRegistration } from './contract/service/contributions.js';
import { TickReceivers } from './contract/service/receivers.js';
import { tickReceiversLayer } from './receiving.js';
import { type Tick, TickRefused, Ticks } from './contract/service/ticks.js';
import type { ScheduleState } from './contract/wire/schedule.js';
import { scheduleLayer } from './layer.js';
import { makeLedger } from './store/ledger.js';

const EVERY = 60_000;
const DAY = 86_400_000;
const storage = Layer.unwrap(
  Effect.map(sharedPool, (pool) =>
    unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool)),
    ),
  ),
);

type Receive = Ticks['Service']['deliver'];

const server = Effect.fnUntraced(function* (receive: Receive) {
  const built = yield* Layer.build(
    scheduleLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Ticks, { deliver: receive }),
          Layer.succeed(ScheduleContributions, { declare: () => Effect.succeed(() => undefined) }),
          tickReceiversLayer,
        ),
      ),
    ),
  );
  return Context.get(built, Schedules);
});

const all = (schedules: Schedules['Service']) => Effect.map(schedules.read({ after: null, limit: 100 }), (page) => page.rows);

const settled = Effect.fnUntraced(function* (schedules: Schedules['Service'], ready: (state: ScheduleState) => boolean) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const [state] = yield* all(schedules);
    if (state !== undefined && ready(state)) return state;
    yield* Effect.promise(() => Bun.sleep(5));
  }
  return yield* Effect.die('the schedule never reached the awaited state');
});

const recorded = Effect.fnUntraced(function* (owner: string) {
  const ledger = yield* makeLedger;
  for (let attempt = 0; attempt < 400; attempt++) {
    if ((yield* ledger.of(owner)).some((state) => state.last !== null)) return;
    yield* Effect.promise(() => Bun.sleep(5));
  }
  return yield* Effect.die('the run was never recorded');
});

const world = <A, E>(work: Effect.Effect<A, E, MachineStore | MachineUnits | Scope.Scope>) => work.pipe(Effect.provide(storage));

const cadence = { name: 'poll', everyMs: EVERY };

it.effect('a tick is delivered at the cadence, and the state names the last run and the next one', () =>
  world(
    Effect.gen(function* () {
      const ticks = yield* Queue.unbounded<Tick>();
      const schedules = yield* server((tick) => Queue.offer(ticks, tick).pipe(Effect.asVoid));
      yield* schedules.declare('bridge', [cadence]);
      expect(yield* all(schedules)).toMatchObject([{ owner: 'bridge', name: 'poll', nextAt: EVERY, running: false, last: null }]);

      yield* TestClock.adjust(EVERY);
      expect(yield* Queue.take(ticks)).toEqual({ owner: 'bridge', name: 'poll', scheduledAt: EVERY, startedAt: EVERY, skipped: 0 });
      const state = yield* settled(schedules, (candidate) => candidate.last !== null);
      expect(state).toMatchObject({ nextAt: 2 * EVERY, running: false, last: { outcome: 'delivered', reason: null, skipped: 0 } });
    }),
  ),
);

it.effect('a run still standing after a day is not overlapped, and the ticks that passed during it are skipped, not queued', () =>
  world(
    Effect.gen(function* () {
      const started = yield* Queue.unbounded<Tick>();
      const release = yield* Deferred.make<void>();
      const schedules = yield* server((tick) => Queue.offer(started, tick).pipe(Effect.andThen(Deferred.await(release))));
      yield* schedules.declare('bridge', [cadence]);

      yield* TestClock.adjust(EVERY);
      yield* Queue.take(started);
      yield* TestClock.adjust(DAY + 5 * EVERY);
      expect(yield* settled(schedules, (state) => state.running)).toMatchObject({ running: true, nextAt: EVERY });
      expect(yield* Queue.size(started)).toBe(0);

      yield* Deferred.succeed(release, undefined);
      const state = yield* settled(schedules, (candidate) => candidate.last !== null);
      expect(state).toMatchObject({ nextAt: DAY + 7 * EVERY, running: false, last: { outcome: 'delivered', skipped: DAY / EVERY + 5 } });
      yield* recorded('bridge');
      yield* TestClock.adjust(EVERY);
      expect((yield* Queue.take(started)).scheduledAt).toBe(DAY + 7 * EVERY);
      expect(yield* Queue.size(started)).toBe(0);
    }),
  ),
);

it.effect('a refused tick is visible with the time of the next run, and the schedule goes on', () =>
  world(
    Effect.gen(function* () {
      const ticks = yield* Queue.unbounded<Tick>();
      const schedules = yield* server((tick) =>
        Queue.offer(ticks, tick).pipe(Effect.andThen(Effect.fail(new TickRefused({ reason: 'the bridge is down' })))),
      );
      yield* schedules.declare('bridge', [cadence]);

      yield* TestClock.adjust(EVERY);
      yield* Queue.take(ticks);
      const failed = yield* settled(schedules, (state) => state.last !== null);
      expect(failed).toMatchObject({ nextAt: 2 * EVERY, running: false, last: { outcome: 'failed', reason: 'the bridge is down' } });

      yield* TestClock.adjust(EVERY);
      expect((yield* Queue.take(ticks)).scheduledAt).toBe(2 * EVERY);
    }),
  ),
);

it.effect('a schedule survives a restart, and the ticks missed while the server was stopped become one run', () =>
  world(
    Effect.gen(function* () {
      const before = yield* Scope.fork(yield* Effect.scope);
      const first = yield* Scope.provide(
        server(() => Effect.void),
        before,
      );
      yield* first.declare('bridge', [cadence]);
      yield* Scope.close(before, Exit.void);

      yield* TestClock.adjust(10 * EVERY);
      const ticks = yield* Queue.unbounded<Tick>();
      const schedules = yield* server((tick) => Queue.offer(ticks, tick).pipe(Effect.asVoid));
      expect(yield* all(schedules)).toEqual([]);
      yield* schedules.declare('bridge', [cadence]);

      expect(yield* Queue.take(ticks)).toEqual({ owner: 'bridge', name: 'poll', scheduledAt: EVERY, startedAt: 10 * EVERY, skipped: 9 });
      const state = yield* settled(schedules, (candidate) => candidate.last !== null);
      expect(state).toMatchObject({ nextAt: 11 * EVERY, last: { outcome: 'delivered', skipped: 9 } });
      expect(yield* Queue.size(ticks)).toBe(0);
    }),
  ),
);

it.effect('declaring again keeps the standing time, and a changed cadence or a dropped schedule takes effect', () =>
  world(
    Effect.gen(function* () {
      const schedules = yield* server(() => Effect.void);
      yield* schedules.declare('bridge', [cadence, { name: 'other', everyMs: 5 * EVERY }]);
      yield* TestClock.adjust(EVERY / 2);
      yield* schedules.declare('bridge', [cadence, { name: 'other', everyMs: 2 * EVERY }]);
      const names = (yield* all(schedules)).map(({ name, nextAt }) => [name, nextAt]);
      expect(names).toEqual([
        ['other', EVERY / 2 + 2 * EVERY],
        ['poll', EVERY],
      ]);

      yield* schedules.declare('bridge', []);
      expect(yield* all(schedules)).toEqual([]);
    }),
  ),
);

it.effect('a finished run is already recorded when the server restarts, so its tick does not come twice', () =>
  world(
    Effect.gen(function* () {
      const before = yield* Scope.fork(yield* Effect.scope);
      const ticks = yield* Queue.unbounded<Tick>();
      const first = yield* Scope.provide(
        server((tick) => Queue.offer(ticks, tick).pipe(Effect.asVoid)),
        before,
      );
      yield* first.declare('bridge', [cadence]);
      yield* TestClock.adjust(EVERY);
      yield* Queue.take(ticks);
      yield* settled(first, (state) => state.last !== null);
      yield* recorded('bridge');
      yield* Scope.close(before, Exit.void);

      const schedules = yield* server((tick) => Queue.offer(ticks, tick).pipe(Effect.asVoid));
      yield* schedules.declare('bridge', [cadence]);
      expect(yield* all(schedules)).toMatchObject([{ nextAt: 2 * EVERY, last: { outcome: 'delivered' } }]);
      expect(yield* Queue.size(ticks)).toBe(0);

      yield* TestClock.adjust(EVERY);
      expect((yield* Queue.take(ticks)).scheduledAt).toBe(2 * EVERY);
    }),
  ),
);

it.effect('changing the cadence of a schedule that is running ends that run before the new cadence starts', () =>
  world(
    Effect.gen(function* () {
      const started = yield* Queue.unbounded<Tick>();
      const schedules = yield* server((tick) => Queue.offer(started, tick).pipe(Effect.andThen(Effect.never)));
      yield* schedules.declare('bridge', [cadence]);
      yield* TestClock.adjust(EVERY);
      yield* Queue.take(started);

      yield* schedules.declare('bridge', [{ name: 'poll', everyMs: 3 * EVERY }]);
      expect(yield* all(schedules)).toMatchObject([{ everyMs: 3 * EVERY, nextAt: 4 * EVERY, running: false }]);

      yield* TestClock.adjust(3 * EVERY);
      expect((yield* Queue.take(started)).scheduledAt).toBe(4 * EVERY);
    }),
  ),
);

it.effect('a withdrawn contribution stays off during its finalizer, and its replacement resumes ticking after the old follower ends', () =>
  world(
    Effect.gen(function* () {
      const declared = yield* Deferred.make<ScheduleRegistration>();
      const release = yield* Deferred.make<void>();
      const finalizing = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      const delivered = yield* Queue.unbounded<Tick>();
      const routed = Layer.effect(
        Ticks,
        Effect.map(TickReceivers, (receivers) => ({ deliver: (tick: Tick) => receivers.deliver(tick) })),
      ).pipe(Layer.provideMerge(tickReceiversLayer));
      const built = yield* Layer.build(
        scheduleLayer.pipe(
          Layer.provide(routed),
          Layer.provide(
            Layer.succeed(ScheduleContributions, {
              declare: (register) => Deferred.succeed(declared, register).pipe(Effect.as(() => undefined)),
            }),
          ),
        ),
      );
      const schedules = Context.get(built, Schedules);
      const register = yield* Deferred.await(declared);
      yield* Effect.gen(function* () {
        const withdraw = yield* register('bridge', [cadence], {
          deliver: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(finalizing, undefined).pipe(Effect.andThen(Deferred.await(release)))),
            ),
        });
        yield* schedules.declare('other', [{ name: 'other', everyMs: 5 * EVERY }]);
        yield* TestClock.adjust(EVERY);
        yield* Deferred.await(started);
        yield* Effect.sync(withdraw);
        expect(yield* all(schedules)).toMatchObject([{ owner: 'other', name: 'other' }]);
        yield* Deferred.await(finalizing);

        const published = yield* Deferred.make<void>();
        const restoring = yield* Effect.forkChild(
          register('bridge', [cadence], {
            deliver: (tick) => Queue.offer(delivered, tick).pipe(Effect.asVoid),
          }).pipe(Effect.tap(() => Deferred.succeed(published, undefined))),
        );
        const early = yield* Effect.raceFirst(
          Deferred.await(published).pipe(Effect.as(true)),
          Effect.promise(() => Bun.sleep(50)).pipe(Effect.as(false)),
        );
        expect(early).toBe(false);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(restoring);
        yield* TestClock.adjust(1);
        const resumed = yield* settled(schedules, (state) => state.last !== null);
        expect(resumed).toMatchObject({ owner: 'bridge', nextAt: 2 * EVERY, last: { outcome: 'delivered' } });
        expect(yield* Queue.size(delivered)).toBe(1);
        expect((yield* all(schedules)).map(({ owner }) => owner)).toEqual(['bridge', 'other']);
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
    }),
  ),
);

it.effect('schedules are read in pages ordered by owner and name, with the total', () =>
  world(
    Effect.gen(function* () {
      const schedules = yield* server(() => Effect.void);
      yield* schedules.declare('b', [{ name: 'z', everyMs: EVERY }]);
      yield* schedules.declare('a', [
        { name: 'y', everyMs: EVERY },
        { name: 'x', everyMs: EVERY },
      ]);
      const names = ({ rows }: { readonly rows: readonly ScheduleState[] }) => rows.map(({ owner, name }) => `${owner}/${name}`);

      const first = yield* schedules.read({ after: null, limit: 2 });
      expect(names(first)).toEqual(['a/x', 'a/y']);
      expect(first).toMatchObject({ total: 3, more: true });
      const second = yield* schedules.read({ after: { owner: 'a', name: 'y' }, limit: 2 });
      expect(names(second)).toEqual(['b/z']);
      expect(second).toMatchObject({ total: 3, more: false });
    }),
  ),
);
