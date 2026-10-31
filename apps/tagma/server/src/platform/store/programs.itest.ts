import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { eq, sql } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../contract/service/store.js';
import { MachineUnits, ProgramConflict } from '../contract/service/units.js';
import { writes } from '../contract/service/writes.js';
import { seededStoreLayer } from './open.js';
import { unitsLayer } from './units.js';
import { readConsequences } from './writes.js';
import { UnitInProgramRefused } from './life.js';
import { planned, unplannable } from './programs.js';

const kept = sqliteTable('programs_kept', { id: text('id').primaryKey() });
const keeping = writes('programs.keep', [kept]);

const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
);

const world = Effect.gen(function* () {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  yield* store.db.run(sql`create table programs_kept (id text primary key)`);
  yield* readConsequences(store.identity, store.db);
  const counted = { reads: 0 };
  const count = store.moves.answers<string, number>([kept]).read(
    'all',
    units.read((unit) =>
      Effect.map(unit.run(store.db.all(sql`select id from programs_kept`)), (rows) => {
        counted.reads += 1;
        return rows.length;
      }),
    ),
  );
  const ids = Effect.map(store.db.all<{ id: string }>(sql`select id from programs_kept order by id`), (rows) => rows.map((row) => row.id));
  const insert = (id: string) => store.db.insert(kept).values({ id });
  const missing = store.db.select({ id: kept.id }).from(kept).where(eq(kept.id, 'missing'));
  return { units, count, counted, ids, insert, missing };
});

it.live('a program and the programs nested in it commit together, then its after-commit work runs and its tables shift', () =>
  Effect.gen(function* () {
    const { units, count, counted, ids, insert } = yield* world;
    expect(yield* count).toBe(0);
    const order: string[] = [];
    const value = yield* units.program(keeping, 'test:a', (unit) =>
      Effect.gen(function* () {
        yield* unit.write(insert('a'), 1);
        yield* units.program(keeping, 'test:b', (inner) => inner.write(insert('b'), 1));
        yield* unit.afterCommit(Effect.sync(() => void order.push('tail')));
        return 'done';
      }),
    );
    expect({ value, order, ids: yield* ids, count: yield* count, reads: counted.reads }).toEqual({
      value: 'done',
      order: ['tail'],
      ids: ['a', 'b'],
      count: 2,
      reads: 2,
    });
  }).pipe(Effect.provide(storage)),
);

it.live('a guard that counts other rows, or a broken uniqueness, refuses the program typed and keeps nothing of it', () =>
  Effect.gen(function* () {
    const { units, ids, insert, missing } = yield* world;
    const tails: string[] = [];
    const guarded = yield* Effect.exit(
      units.program(keeping, 'test:guard', (unit) =>
        Effect.gen(function* () {
          yield* unit.write(insert('a'), 1);
          yield* unit.guard(missing, 1);
          yield* unit.afterCommit(Effect.sync(() => void tails.push('guard')));
        }),
      ),
    );
    yield* units.program(keeping, 'test:first', (unit) => unit.write(insert('b'), 1));
    const unique = yield* Effect.exit(units.program(keeping, 'test:again', (unit) => unit.write(insert('b'))));
    const refused = [guarded, unique].map((exit) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : null)) as readonly ProgramConflict[];
    expect(refused.map((failure) => failure instanceof ProgramConflict)).toEqual([true, true]);
    expect(refused.map(({ statement, expected, actual }) => ({ statement, expected, actual }))).toEqual([
      { statement: 1, expected: 1, actual: 0 },
      { statement: 0, expected: null, actual: null },
    ]);
    expect({ ids: yield* ids, tails }).toEqual({ ids: ['b'], tails: [] });
  }).pipe(Effect.provide(storage)),
);

it.live(
  'inside an open unit a refused program takes back its writes and after-commit work, and a joined one shifts its tables at the outer commit',
  () =>
    Effect.gen(function* () {
      const { units, ids, insert, missing, count } = yield* world;
      expect(yield* count).toBe(0);
      const tails: string[] = [];
      const tail = (name: string) => Effect.sync(() => void tails.push(name));
      yield* units.write(writes('programs.outer', []), () =>
        Effect.gen(function* () {
          const refused = yield* Effect.exit(
            units.program(keeping, 'test:refused', (program) =>
              Effect.gen(function* () {
                yield* program.write(insert('b'), 1);
                yield* program.afterCommit(tail('refused'));
                yield* program.guard(missing, 1);
              }),
            ),
          );
          expect(Exit.isFailure(refused) && Cause.squash(refused.cause) instanceof ProgramConflict).toBe(true);
          yield* units.program(keeping, 'test:joined', (program) =>
            Effect.andThen(program.write(insert('c'), 1), program.afterCommit(tail('joined'))),
          );
        }),
      );
      expect({ ids: yield* ids, tails, count: yield* count }).toEqual({ ids: ['c'], tails: ['joined'], count: 1 });
    }).pipe(Effect.provide(storage)),
);

it.live('a program interrupted while it waits for the writer still runs its after-commit work and shifts its tables once it commits', () =>
  Effect.gen(function* () {
    const { units, ids, insert, count } = yield* world;
    expect(yield* count).toBe(0);
    const holding = yield* Deferred.make<void>();
    const released = yield* Deferred.make<void>();
    const holder = yield* Effect.forkChild(
      units.write(keeping, () => Effect.andThen(Deferred.succeed(holding, undefined), Deferred.await(released))),
    );
    yield* Deferred.await(holding);
    const tails: string[] = [];
    const built = yield* Deferred.make<void>();
    const program = yield* Effect.forkChild(
      units.program(keeping, 'test:interrupted', (unit) =>
        Effect.gen(function* () {
          yield* unit.write(insert('a'), 1);
          yield* unit.afterCommit(Effect.sync(() => void tails.push('tail')));
          yield* Deferred.succeed(built, undefined);
        }),
      ),
      { startImmediately: true },
    );
    yield* Deferred.await(built);
    const interrupting = yield* Effect.forkChild(Fiber.interrupt(program), { startImmediately: true });
    yield* Deferred.succeed(released, undefined);
    yield* Fiber.join(holder);
    yield* Fiber.join(interrupting);
    expect({ ids: yield* ids, tails, count: yield* count }).toEqual({ ids: ['a'], tails: ['tail'], count: 1 });
  }).pipe(Effect.provide(storage)),
);

it.live('a program nested in one being built cannot fall back alone: the outer program falls back whole and writes nothing', () =>
  Effect.gen(function* () {
    const { units, ids, insert } = yield* world;
    const outer = yield* planned(
      units.program(keeping, 'test:outer', (unit) =>
        Effect.gen(function* () {
          yield* unit.write(insert('a'), 1);
          return yield* planned(
            units.program(keeping, 'test:inner', (inner) => Effect.andThen(inner.write(insert('b'), 1), unplannable(inner, 'test'))),
          );
        }),
      ),
    );
    expect({ outer, ids: yield* ids }).toEqual({ outer: null, ids: [] });
  }).pipe(Effect.provide(storage)),
);

it.live('an interactive unit opened while a program is built is refused', () =>
  Effect.gen(function* () {
    const { units, insert } = yield* world;
    const opened = yield* Effect.exit(units.program(keeping, 'test:inside', () => units.write(keeping, (unit) => unit.run(insert('a')))));
    expect(Exit.isFailure(opened) && Cause.squash(opened.cause) instanceof UnitInProgramRefused).toBe(true);
  }).pipe(Effect.provide(storage)),
);
