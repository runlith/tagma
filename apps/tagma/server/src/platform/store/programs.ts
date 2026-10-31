import { carryCost, rootCost } from '@runlith/performance/CostLedger';
import { CurrentWriter, type WriterMetrics } from '@runlith/performance/WriterMetrics';
import type { Programs } from '@runlith/sqlite-process/programs';
import { is, sql } from 'drizzle-orm';
import { SQLiteDeleteBase, SQLiteInsertBase, SQLiteUpdateBase } from 'drizzle-orm/sqlite-core';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { Cause, Data, Effect, Exit } from 'effect';
import { classifySqliteError, SqlError } from 'effect/sql/SqlError';
import type { StoreBrand, StoreFailure, StoreIdentity } from '../contract/service/store.js';
import {
  ProgramConflict,
  type ProgramQuery,
  type ProgramUnit,
  programUnitOf,
  type Unit,
  type WriteUnit,
  writeUnitOf,
} from '../contract/service/units.js';
import type { WriteSet } from '../contract/service/writes.js';
import { type Building, ProgramOpen, UnitLife } from './life.js';
import type { TableMoves } from './moves.js';
import { afterOuterCommit } from './transaction.js';
import { checkStatement, movedTables, UnitWrites } from './writes.js';

const same = (left: StoreIdentity | null, right: StoreIdentity): boolean =>
  left !== null && left.path === right.path && left.generation === right.generation;

class ProgramUnplannable extends Data.TaggedError('ProgramUnplannable')<{ readonly store: string; readonly reason: string }> {
  override get message(): string {
    return `${this.store}: this work cannot be planned as a program (${this.reason}), so its interactive unit writes it`;
  }
}

type ProgramWrite<Brand extends StoreBrand> = WriteUnit<Brand> & { readonly program: ProgramUnit<Brand> };

const plainWrite = (query: unknown): query is ProgramQuery =>
  (is(query, SQLiteInsertBase) || is(query, SQLiteUpdateBase) || is(query, SQLiteDeleteBase)) &&
  !/\breturning\b/i.test((query as unknown as ProgramQuery).toSQL().sql);

export const programWriteUnit = <Brand extends StoreBrand>(program: ProgramUnit<Brand>): ProgramWrite<Brand> => ({
  ...writeUnitOf<Brand>({
    store: program.store,
    run: <A>(query: Effect.Effect<A, StoreFailure>): Effect.Effect<A, StoreFailure> =>
      plainWrite(query) ? Effect.as(program.write(query), [] as A) : unplannable(program, 'a read through the program unit'),
    afterCommit: program.afterCommit,
  }),
  program,
});

export const programOf = <Brand extends StoreBrand>(unit: Unit<Brand>): ProgramUnit<Brand> | null =>
  'program' in unit ? (unit as ProgramWrite<Brand>).program : null;

export const unplannable = <Brand extends StoreBrand>(program: ProgramUnit<Brand>, reason: string): Effect.Effect<never> =>
  Effect.die(new ProgramUnplannable({ store: program.store.path, reason }));

const fellBack = (cause: Cause.Cause<unknown>): boolean =>
  cause.reasons.length > 0 &&
  cause.reasons.every(
    (reason) =>
      (Cause.isDieReason(reason) && reason.defect instanceof ProgramUnplannable) ||
      (Cause.isFailReason(reason) && reason.error instanceof ProgramConflict),
  );

export const planned = <A, E>(attempt: Effect.Effect<A, E>): Effect.Effect<A | null, E> =>
  Effect.flatMap(Effect.exit(attempt), (exit) =>
    Exit.isSuccess(exit) ? Effect.succeed(exit.value) : fellBack(exit.cause) ? Effect.succeed(null) : Effect.failCause(exit.cause),
  );

const UNIQUE = /^SQLITE_CONSTRAINT_(UNIQUE|PRIMARYKEY)$/;

const built = <Brand extends StoreBrand>(building: Building, set: WriteSet): ProgramUnit<Brand> => {
  const add = (statement: ProgramQuery, counts: 'rows' | 'changes', expect: number | null) =>
    Effect.sync(() => {
      const { sql, params } = statement.toSQL();
      building.statements.push({ sql, params, counts, expect, set });
    });
  return programUnitOf<Brand>({
    store: building.store,
    write: (statement, changes) => add(statement, 'changes', changes ?? null),
    guard: (statement, rows) => add(statement, 'rows', rows),
    afterCommit: (effect) => Effect.sync(() => void building.tails.push(carryCost(effect))),
  });
};

const joined = <Brand extends StoreBrand>(
  db: EffectSQLiteBunDatabase,
  identity: StoreIdentity,
  set: WriteSet,
  key: string,
): ProgramUnit<Brand> => {
  let next = 0;
  const counted = (statement: number, expected: number, actual: number) =>
    expected === actual
      ? Effect.void
      : Effect.die(new ProgramConflict({ store: identity.path, operation: set.operation, identity: key, statement, expected, actual }));
  return programUnitOf<Brand>({
    store: identity,
    write: (statement, changes) =>
      Effect.suspend(() => {
        const at = next++;
        return Effect.andThen(
          statement,
          changes === undefined
            ? Effect.void
            : Effect.flatMap(db.get<{ n: number }>(sql`select changes() as n`), (row) => counted(at, changes, row?.n ?? 0)),
        );
      }),
    guard: (statement, rows) =>
      Effect.suspend(() => {
        const at = next++;
        return Effect.flatMap(statement, (found) => counted(at, rows, Array.isArray(found) ? found.length : found === undefined ? 0 : 1));
      }),
    afterCommit: afterOuterCommit,
  });
};

const refusedBy = (thrown: { readonly name: string; readonly message: string; readonly code: string | number | undefined }) =>
  new SqlError({ reason: classifySqliteError(thrown, { message: 'Failed to execute a program statement', operation: 'programs' }) });

export const storeProgram =
  <Brand extends StoreBrand>(
    db: EffectSQLiteBunDatabase,
    programs: Programs['Service'],
    identity: StoreIdentity,
    moves: TableMoves,
    classed: boolean,
    metrics?: WriterMetrics['Service'],
  ) =>
  <A, E>(
    set: WriteSet,
    key: string,
    work: (unit: ProgramUnit<Brand>) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | StoreFailure | ProgramConflict> =>
    submitted(db, programs, identity, moves, classed, metrics, set, key, work);

const submitted = Effect.fnUntraced(function* <Brand extends StoreBrand, A, E>(
  db: EffectSQLiteBunDatabase,
  programs: Programs['Service'],
  identity: StoreIdentity,
  moves: TableMoves,
  classed: boolean,
  metrics: WriterMetrics['Service'] | undefined,
  set: WriteSet,
  key: string,
  work: (unit: ProgramUnit<Brand>) => Effect.Effect<A, E>,
) {
  const open = yield* ProgramOpen;
  if (open !== null && same(open.store, identity)) {
    open.sets.push(set);
    return yield* work(built<Brand>(open, set));
  }
  const life = yield* UnitLife;
  if (life !== null && life.open && same(life.identity, identity)) {
    const writing = new Map(yield* UnitWrites).set(identity, set);
    return yield* Effect.acquireUseRelease(
      db.run(sql`savepoint program`),
      () => Effect.provideService(work(joined<Brand>(db, identity, set, key)), UnitWrites, writing),
      (_, exit) =>
        Effect.orDie(
          Exit.isSuccess(exit)
            ? db.run(sql`release program`)
            : Effect.andThen(db.run(sql`rollback to program`), db.run(sql`release program`)),
        ),
    ).pipe(
      Effect.catchCause((cause: Cause.Cause<E | StoreFailure>): Effect.Effect<never, E | StoreFailure | ProgramConflict> => {
        const conflict = cause.reasons.find((reason) => Cause.isDieReason(reason) && reason.defect instanceof ProgramConflict);
        return conflict !== undefined && Cause.isDieReason(conflict)
          ? Effect.fail(conflict.defect as ProgramConflict)
          : Effect.failCause(cause);
      }),
    );
  }
  return yield* rootCost(
    set.operation,
    Effect.useSpan('Store.program', { attributes: { opKind: set.operation, 'db.program.key': key } }, () =>
      Effect.gen(function* () {
        const building: Building = { store: identity, statements: [], tails: [], sets: [set] };
        const value = yield* Effect.provideService(work(built<Brand>(building, set)), ProgramOpen, building);
        for (const statement of building.statements) {
          if (statement.counts === 'changes')
            yield* Effect.provideService(checkStatement(identity)(statement.sql), UnitWrites, new Map([[identity, statement.set]]));
        }
        if (building.statements.length > 0) {
          const frame = metrics?.begin(set.operation, identity.path) ?? null;
          const answered = yield* Effect.exit(
            Effect.provideService(
              programs.submit({
                operation: set.operation,
                program: { statements: building.statements.map(({ set: _set, ...statement }) => statement) },
                synchronous: classed ? (set.durability === 'relaxed' ? 'normal' : 'full') : null,
              }),
              CurrentWriter,
              frame,
            ),
          );
          if (frame !== null && metrics !== undefined) {
            const outcome = Exit.isSuccess(answered) ? answered.value.outcome._tag : null;
            metrics.end(frame, outcome === 'Applied' ? 'success' : 'failure');
          }
          if (Exit.isFailure(answered)) return yield* Effect.failCause(answered.cause);
          const { outcome } = answered.value;
          if (outcome._tag === 'Conflict')
            return yield* new ProgramConflict({
              store: identity.path,
              operation: set.operation,
              identity: key,
              statement: outcome.statement,
              expected: outcome.expected,
              actual: outcome.actual,
            });
          if (outcome._tag === 'Refused') {
            if (typeof outcome.thrown.code === 'string' && UNIQUE.test(outcome.thrown.code))
              return yield* new ProgramConflict({
                store: identity.path,
                operation: set.operation,
                identity: key,
                statement: outcome.statement,
                expected: null,
                actual: null,
              });
            return yield* refusedBy(outcome.thrown);
          }
          for (const each of building.sets) moves.committed(movedTables(identity, each));
        }
        let lost = Cause.empty as Cause.Cause<never>;
        for (const tail of building.tails) {
          const ended = yield* Effect.exit(tail);
          if (Exit.isFailure(ended)) lost = Cause.combine(lost, ended.cause);
        }
        if (lost.reasons.length > 0) return yield* Effect.failCause(lost);
        return value;
      }),
    ),
  );
});
