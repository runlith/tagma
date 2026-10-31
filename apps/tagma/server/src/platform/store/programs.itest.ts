import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { eq, sql } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Cause, Effect, Exit, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../contract/service/store.js';
import { MachineUnits, ProgramConflict } from '../contract/service/units.js';
import { writes } from '../contract/service/writes.js';
import { seededStoreLayer } from './open.js';
import { unitsLayer } from './units.js';
import { readConsequences } from './writes.js';
import { UnitInProgramRefused } from './life.js';

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

it.live('inside an open unit a program joins it, and its refusal takes back only its own writes', () =>
  Effect.gen(function* () {
    const { units, ids, insert, missing } = yield* world;
    yield* units.write(keeping, (unit) =>
      Effect.gen(function* () {
        yield* unit.run(insert('a'));
        const joined = yield* Effect.exit(
          units.program(keeping, 'test:joined', (program) => Effect.andThen(program.write(insert('b'), 1), program.guard(missing, 1))),
        );
        expect(Exit.isFailure(joined) && Cause.squash(joined.cause) instanceof ProgramConflict).toBe(true);
        yield* unit.run(insert('c'));
      }),
    );
    expect(yield* ids).toEqual(['a', 'c']);
  }).pipe(Effect.provide(storage)),
);

it.live('an interactive unit opened while a program is built is refused', () =>
  Effect.gen(function* () {
    const { units, insert } = yield* world;
    const opened = yield* Effect.exit(units.program(keeping, 'test:inside', () => units.write(keeping, (unit) => unit.run(insert('a')))));
    expect(Exit.isFailure(opened) && Cause.squash(opened.cause) instanceof UnitInProgramRefused).toBe(true);
  }).pipe(Effect.provide(storage)),
);
