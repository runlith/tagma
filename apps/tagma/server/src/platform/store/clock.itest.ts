import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Deferred, Effect, Fiber } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { TestClock } from 'effect/testing';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { MachineStore } from '../contract/service/store.js';
import { seededStoreLayer } from './open.js';

const DAY = 86_400_000;

it.effect('advancing domain time leaves a live transaction and its queued statement able to commit', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    yield* store.db.run(sql`create table clock_probe (value integer not null)`);
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const first = yield* Effect.forkChild(
      store.transaction('clock-holder', () =>
        Effect.gen(function* () {
          yield* store.db.run(sql`insert into clock_probe (value) values (1)`);
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
        }),
      ),
    );
    yield* Deferred.await(entered);
    const second = yield* Effect.forkChild(store.db.run(sql`insert into clock_probe (value) values (2)`), { startImmediately: true });
    yield* TestClock.adjust(DAY).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    expect(yield* store.db.all<{ value: number }>(sql`select value from clock_probe order by value`)).toEqual([{ value: 1 }, { value: 2 }]);
    yield* store.transaction('after-clock-shift', () => store.db.run(sql`insert into clock_probe (value) values (3)`));
    expect(yield* store.db.all<{ n: number }>(sql`select count(*) as n from clock_probe`)).toEqual([{ n: 3 }]);
  }).pipe(Effect.provide(seededStoreLayer(MachineStore, fixtureMigrations, { readers: 0 }, sharedPool))),
);
