import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { and, asc, eq, sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../contract/service/store.js';
import type { ReturnedRows } from '@runlith/sqlite-process/channel';
import { SafeIntegers } from 'effect/sql/SqlClient';
import { MachineUnits, ProgramConflict } from '../contract/service/units.js';
import { writes } from '../contract/service/writes.js';
import { seededStoreLayer } from './open.js';
import { unitsLayer } from './units.js';
import { readConsequences } from './writes.js';
import { UnitInProgramRefused } from './life.js';
import { planned, unplannable } from './programs.js';
import { bindQuery } from './queries.js';

const kept = sqliteTable('programs_kept', {
  id: text('id').primaryKey(),
  details: text('details', { mode: 'json' }),
  at: integer('at', { mode: 'timestamp_ms' }),
});
const keeping = writes('programs.keep', [kept]);

const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool))),
);

const world = Effect.gen(function* () {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  yield* store.db.run(sql`create table programs_kept (id text primary key, details text, at integer)`);
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

it.live('prepared program writes and guards bind encoded values in standalone and joined units', () =>
  Effect.gen(function* () {
    const { units } = yield* world;
    const { db } = yield* MachineStore;
    const insert = db
      .insert(kept)
      .values({ id: sql.placeholder('id'), details: sql.placeholder('details'), at: sql.placeholder('at') })
      .prepare();
    const guard = db
      .select({ id: kept.id })
      .from(kept)
      .where(and(eq(kept.id, sql.placeholder('id')), eq(kept.at, sql.param(sql.placeholder('at'), kept.at))))
      .prepare();
    const at = new Date(yield* Clock.currentTimeMillis);
    yield* units.program(keeping, 'test:prepared', (program) =>
      program.write(bindQuery(insert, { id: 'a', details: { text: '漢🙂' }, at }), 1),
    );
    yield* units.write(keeping, () =>
      units.program(keeping, 'test:prepared-joined', (program) =>
        Effect.andThen(
          program.guard(bindQuery(guard, { id: 'b', at }), 0),
          program.write(bindQuery(insert, { id: 'b', details: null, at: null }), 1),
        ),
      ),
    );
    const refused = yield* Effect.result(
      units.program(keeping, 'test:prepared-refused', (program) =>
        Effect.andThen(
          program.guard(bindQuery(guard, { id: 'a', at }), 0),
          program.write(bindQuery(insert, { id: 'c', details: null, at: null }), 1),
        ),
      ),
    );
    expect(refused._tag).toBe('Failure');
    if (refused._tag === 'Failure') expect(refused.failure._tag).toBe('ProgramConflict');
    expect(yield* db.select().from(kept).orderBy(asc(kept.id))).toEqual([
      { id: 'a', details: { text: '漢🙂' }, at },
      { id: 'b', details: null, at: null },
    ]);
  }).pipe(Effect.provide(storage)),
);

it.live(
  'a returning write hands its rows to its place among the after-commit work of a program and of a joined program, and nothing when refused',
  () =>
    Effect.gen(function* () {
      const { units, insert, missing, ids } = yield* world;
      const seen: unknown[] = [];
      const note = (name: string) => (rows: ReturnedRows) => {
        seen.push([name, rows]);
        return Effect.void;
      };
      const inserted = (id: string) => insert(id).returning({ id: kept.id });
      yield* units.program(keeping, 'test:returning', (program) =>
        Effect.gen(function* () {
          yield* program.afterCommit(Effect.sync(() => void seen.push('before')));
          yield* program.returning(inserted('a'), note('program'));
          yield* program.afterCommit(Effect.sync(() => void seen.push('after')));
          expect(seen).toEqual([]);
        }),
      );
      yield* units.write(writes('programs.outer', []), () =>
        Effect.gen(function* () {
          yield* units.program(keeping, 'test:joined', (program) => program.returning(inserted('b'), note('joined')));
          const enclosing = yield* Effect.exit(
            units.program(keeping, 'test:enclosing', (program) =>
              Effect.andThen(
                units.program(keeping, 'test:inner', (inner) => inner.returning(inserted('d'), note('inner'))),
                program.guard(missing, 1),
              ),
            ),
          );
          expect(Exit.isFailure(enclosing)).toBe(true);
          expect(seen).toHaveLength(3);
        }),
      );
      const refused = yield* Effect.exit(
        units.program(keeping, 'test:refused', (program) =>
          Effect.andThen(program.returning(inserted('c'), note('refused')), program.guard(missing, 1)),
        ),
      );
      expect(Exit.isFailure(refused)).toBe(true);
      expect({ seen, ids: yield* ids }).toEqual({ seen: ['before', ['program', [['a']]], 'after', ['joined', [['b']]]], ids: ['a', 'b'] });
    }).pipe(Effect.provide(storage)),
);

it.live('a returning write answers integers in the safe-integer mode of the program that carries it', () =>
  Effect.gen(function* () {
    const { units, insert } = yield* world;
    const kinds: string[] = [];
    const large = (id: string) => insert(id).returning({ large: sql<number>`9007199254740993` });
    const typed = (rows: ReturnedRows) => Effect.sync(() => void kinds.push(typeof rows[0]?.[0]));
    yield* Effect.provideService(
      units.program(keeping, 'test:safe', (program) => program.returning(large('safe'), typed)),
      SafeIntegers,
      true,
    );
    yield* units.program(keeping, 'test:plain', (program) => program.returning(large('plain'), typed));
    expect(kinds).toEqual(['bigint', 'number']);
  }).pipe(Effect.provide(storage)),
);

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
