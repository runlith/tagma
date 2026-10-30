import { fixtureGraphMigrations, fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { GraphStore, MachineStore, StoreIdentityConflict } from '../contract/service/store.js';
import { type Unit, GraphUnits, MachineUnits } from '../contract/service/units.js';
import { seededStoreLayer } from './open.js';
import { unitsLayer } from './units.js';

const machine = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
);

const graph = unitsLayer(GraphUnits, GraphStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(GraphStore, fixtureGraphMigrations, { readers: 0 }, sharedPool))),
);

const held = sql`select id from unit_isolation_probe where id = 'held'`;

const race = Effect.fn('race')(function* (settle: 'commit' | 'rollback') {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  yield* store.db.run(sql`create table unit_isolation_probe (id text primary key)`);

  const handle = yield* Deferred.make<Unit<'machine'> | null>();
  const letGo = yield* Deferred.make<void>();

  const writing = yield* Effect.forkChild(
    units
      .write('units.writing', (unit) =>
        Effect.gen(function* () {
          yield* unit.run(store.db.run(sql`insert into unit_isolation_probe (id) values ('held')`));
          yield* Deferred.succeed(handle, unit);
          yield* Deferred.await(letGo);
          return settle === 'commit' ? undefined : yield* Effect.fail('rollback' as const);
        }),
      )
      .pipe(
        Effect.exit,
        Effect.tap(() => Deferred.succeed(handle, null)),
      ),
  );

  const unit = yield* Deferred.await(handle);
  if (unit === null) return yield* Effect.die('the unit ended before it handed its handle out');

  const admitted = yield* unit.run(store.db.all<{ id: string }>(held));

  const during = yield* units.read((outside) => outside.run(store.db.all<{ id: string }>(held)));

  yield* Deferred.succeed(letGo, undefined);
  yield* Fiber.await(writing);

  const after = yield* units.read((outside) => outside.run(store.db.all<{ id: string }>(held)));
  const standing = yield* store.db.all<{ id: string }>(sql`select id from unit_isolation_probe`);

  return { admitted, during, after, standing };
});

it.live('a read answers while a unit is open, and answers what that unit has not written', () =>
  Effect.gen(function* () {
    const { admitted, during, after, standing } = yield* race('rollback');

    expect(admitted).toEqual([{ id: 'held' }]);
    expect(during).toEqual([]);
    expect(after).toEqual([]);
    expect(standing).toEqual([]);
  }).pipe(Effect.provide(machine)),
);

it.live('the read that did not wait for a unit sees what that unit committed, once it has', () =>
  Effect.gen(function* () {
    const { admitted, during, after, standing } = yield* race('commit');

    expect(admitted).toEqual([{ id: 'held' }]);
    expect(during).toEqual([]);
    expect(after).toEqual([{ id: 'held' }]);
    expect(standing).toEqual([{ id: 'held' }]);
  }).pipe(Effect.provide(machine)),
);

it.live('a unit refuses statements from another graph instance before they write', () =>
  Effect.gen(function* () {
    const first = yield* Layer.build(graph);
    const second = yield* Layer.build(graph);
    const other = Context.get(second, GraphStore);
    const units = Context.get(first, GraphUnits);
    yield* other.db.run(sql`create table instance_probe (id text primary key)`);
    const writing = yield* Effect.exit(
      units.write('instance.write', (unit) => unit.run(other.db.run(sql`insert into instance_probe values ('crossed')`))),
    );
    expect(Exit.isFailure(writing) && Cause.squash(writing.cause)).toBeInstanceOf(StoreIdentityConflict);
    const reading = yield* Effect.exit(units.read((unit) => unit.run(other.db.all(sql`select * from instance_probe`))));
    expect(Exit.isFailure(reading) && Cause.squash(reading.cause)).toBeInstanceOf(StoreIdentityConflict);
    expect(yield* other.db.all(sql`select * from instance_probe`)).toEqual([]);
    const independent = yield* units.write('instance.independent', () => other.db.all(sql`select * from instance_probe`));
    expect(independent).toEqual([]);
  }),
);
