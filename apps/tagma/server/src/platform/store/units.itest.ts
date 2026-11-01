import { fixtureGraphMigrations, fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { CostLedger, costLedgerLayer, rootCost } from '@runlith/performance/CostLedger';
import { CurrentWriter } from '@runlith/performance/WriterMetrics';
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

it.live('a snapshot read keeps its first cut while writes commit and releases its reader on every ending', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.run(sql`create table snapshot_probe (value integer not null)`);
    yield* store.db.run(sql`insert into snapshot_probe values (1)`);
    const rows = () => store.db.all<{ value: number }>(sql`select value from snapshot_probe`);
    const seen = yield* units.read(
      (unit) =>
        Effect.gen(function* () {
          const first = yield* unit.run(rows());
          yield* units.write('snapshot.concurrent', (writing) => writing.run(store.db.run(sql`update snapshot_probe set value = 2`)));
          const second = yield* unit.run(rows());
          const readOnly = yield* Effect.result(unit.run(store.db.run(sql`update snapshot_probe set value = 3`)));
          expect(readOnly).toMatchObject({ _tag: 'Failure' });
          return { first, second, unit };
        }),
      { snapshot: true },
    );
    expect(seen.first).toEqual([{ value: 1 }]);
    expect(seen.second).toEqual([{ value: 1 }]);
    expect(yield* rows()).toEqual([{ value: 2 }]);
    expect(yield* Effect.flip(seen.unit.run(rows()))).toMatchObject({ _tag: 'SqlError' });

    const refused = yield* Effect.result(
      units.read((unit) => Effect.andThen(unit.run(rows()), Effect.fail('refused' as const)), { snapshot: true }),
    );
    expect(refused).toMatchObject({ _tag: 'Failure', failure: 'refused' });

    const opened = yield* Deferred.make<void>();
    const cancelled = yield* Effect.forkChild(
      units.read((unit) => Effect.andThen(unit.run(rows()), Effect.andThen(Deferred.succeed(opened, undefined), Effect.never)), {
        snapshot: true,
      }),
    );
    yield* Deferred.await(opened);
    yield* Fiber.interrupt(cancelled);
    const ending = yield* Fiber.await(cancelled);
    expect(Exit.isFailure(ending) && Cause.hasInterruptsOnly(ending.cause)).toBe(true);
    expect(yield* units.read((unit) => unit.run(rows()), { snapshot: true })).toEqual([{ value: 2 }]);
  }).pipe(Effect.provide(machine)),
);

it.live('a snapshot read refuses a store without reader lanes instead of taking its writer', () =>
  Effect.gen(function* () {
    const store = yield* GraphStore;
    const units = yield* GraphUnits;
    const rows = () => store.db.all<{ value: number }>(sql`select 1 as value`);
    expect(yield* Effect.flip(units.read((unit) => unit.run(rows()), { snapshot: true }))).toMatchObject({ _tag: 'SqlError' });
    expect(yield* units.read((unit) => unit.run(rows()))).toEqual([{ value: 1 }]);
  }).pipe(Effect.provide(graph)),
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
    const writers = Context.get(first, GraphStore).processes.writerMetrics;
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 1 })));
    const independent = yield* rootCost(
      'independent',
      units.write('instance.independent', () =>
        Effect.gen(function* () {
          const frame = yield* CurrentWriter;
          if (frame === null) return yield* Effect.die('the physical unit has no measurement frame');
          const childMs = frame.childMs;
          const waitMs = frame.waitMs;
          const rows = yield* other.db.all(sql`select * from instance_probe`);
          expect(frame.childMs).toBe(childMs);
          expect(frame.waitMs).toBe(waitMs);
          expect(frame.holdMs).toBe(0);
          return rows;
        }),
      ),
      'independent-root',
    ).pipe(Effect.provideService(CostLedger, ledger));
    expect(independent).toEqual([]);
    const physical = writers.units({ rootId: 'independent-root', operation: 'instance.independent', limit: 1 }).rows[0]!;
    const total = ledger.read({ rootId: 'independent-root', limit: 1 }).rows[0]!.total;
    expect(total.statements).toBe(3);
    expect(total.writerHoldMs).toBeGreaterThan(physical.holdMs);
    expect(total.writerWaitMs).toBeGreaterThan(physical.waitMs);
  }),
);
