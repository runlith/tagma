import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import { CurrentWriter, type WriterFrame } from '@runlith/performance/WriterMetrics';
import type { SqliteProgram } from './channel.js';
import { childHosting } from './children.js';
import { ProcessPool } from './ProcessPool.js';
import { Programs } from './programs.js';
import { Connections, sqliteProcessLayer } from './SqliteProcess.js';

const opened = Effect.gen(function* () {
  const context = yield* Layer.build(
    sqliteProcessLayer({ filename: ':memory:', onLost: () => undefined }, new ProcessPool(undefined, 'stop', undefined, childHosting)),
  );
  return { sql: Context.get(context, SqlClient), programs: Context.get(context, Programs), connections: Context.get(context, Connections) };
});

const inserted = (table: string, value: string | number, guard?: number): SqliteProgram => ({
  statements: [
    { sql: `INSERT INTO ${table} VALUES (?)`, params: [value], counts: 'changes', expect: 1 },
    ...(guard === undefined ? [] : [{ sql: `SELECT 1 FROM ${table} WHERE 0`, params: [], counts: 'rows' as const, expect: guard }]),
  ],
});

const batched = Effect.fnUntraced(function* (store: Effect.Success<typeof opened>, programs: readonly SqliteProgram[]) {
  const { sql, connections } = store;
  const submit = (program: SqliteProgram) => store.programs.submit({ operation: 'test', program, synchronous: null });
  const holding = yield* Deferred.make<void>();
  const released = yield* Deferred.make<void>();
  const holder = yield* Effect.forkChild(
    sql.withTransaction(Effect.andThen(Deferred.succeed(holding, undefined), Deferred.await(released))),
  );
  yield* Deferred.await(holding);
  const ahead = yield* Effect.forkChild(submit({ statements: [] }), { startImmediately: true });
  while ((yield* connections.writer).waiting === 0) yield* Effect.yieldNow;
  const queued = yield* Effect.forEach(programs, (program) => Effect.forkChild(Effect.exit(submit(program)), { startImmediately: true }));
  yield* Deferred.succeed(released, undefined);
  yield* Fiber.join(holder);
  yield* Fiber.join(ahead);
  return yield* Effect.forEach(queued, Fiber.join);
});

it.live('a guard conflict rolls back only its own program, and the rest of its batch commits together', () =>
  Effect.gen(function* () {
    const store = yield* opened;
    yield* store.sql`CREATE TABLE t (name TEXT PRIMARY KEY)`;
    const exits = yield* batched(store, [inserted('t', 'a'), inserted('t', 'b', 1), inserted('t', 'c')]);
    const answers = exits.map((exit) => (Exit.isSuccess(exit) ? exit.value : null));
    expect(answers.map((answer) => answer?.outcome._tag)).toEqual(['Applied', 'Conflict', 'Applied']);
    expect(answers[1]?.outcome).toMatchObject({ statement: 1, expected: 1, actual: 0 });
    expect(new Set(answers.map((answer) => answer?.commitReturnedAt)).size).toBe(1);
    const rows = yield* store.sql<{ name: string }>`SELECT name FROM t ORDER BY name`;
    expect(rows.map((row) => row.name)).toEqual(['a', 'c']);
  }),
);

it.live('a transaction waiting for the writer takes it between program batches while programs stay queued', () =>
  Effect.gen(function* () {
    const { sql, connections, programs } = yield* opened;
    yield* sql`CREATE TABLE t (n INTEGER)`;
    const holding = yield* Deferred.make<void>();
    const released = yield* Deferred.make<void>();
    const holder = yield* Effect.forkChild(
      sql.withTransaction(Effect.andThen(Deferred.succeed(holding, undefined), Deferred.await(released))),
    );
    yield* Deferred.await(holding);
    const queued = yield* Effect.forEach(
      Array.from({ length: 640 }, (_, n) => n),
      (n) =>
        Effect.forkChild(programs.submit({ operation: 'test', program: inserted('t', n), synchronous: null }), { startImmediately: true }),
    );
    while ((yield* connections.writer).waiting === 0) yield* Effect.yieldNow;
    const between = yield* Effect.forkChild(sql.withTransaction(sql`INSERT INTO t VALUES (-1)`), { startImmediately: true });
    while ((yield* connections.writer).waiting < 2) yield* Effect.yieldNow;
    yield* Deferred.succeed(released, undefined);
    yield* Fiber.join(holder);
    yield* Fiber.join(between);
    yield* Effect.forEach(queued, Fiber.join);
    const [order] = yield* sql<{ before: number; after: number }>`SELECT
      (SELECT count(*) FROM t WHERE rowid < (SELECT rowid FROM t WHERE n = -1)) AS before,
      (SELECT count(*) FROM t WHERE rowid > (SELECT rowid FROM t WHERE n = -1)) AS after`;
    expect({ before: (order?.before ?? 0) > 0, after: (order?.after ?? 0) > 0 }).toEqual({ before: true, after: true });
  }),
);

it.live('a handover waits for a program batch already sent to the writer to be answered', () =>
  Effect.gen(function* () {
    const { sql, connections, programs } = yield* opened;
    yield* sql`CREATE TABLE t (n INTEGER)`;
    const frame: WriterFrame = {
      operation: 'test',
      store: ':memory:',
      rootId: null,
      owner: null,
      acquired: false,
      waitMs: 0,
      holdMs: 0,
      childMs: 0,
      repliesComplete: true,
      commitReturnedAt: null,
      writerPid: null,
    };
    const slow: SqliteProgram = {
      statements: [
        {
          sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 2000000) SELECT count(*) FROM c',
          params: [],
          counts: 'rows',
          expect: 1,
        },
        { sql: 'INSERT INTO t VALUES (1)', params: [], counts: 'changes', expect: 1 },
      ],
    };
    const submitted = yield* Effect.forkChild(
      Effect.provideService(programs.submit({ operation: 'test', program: slow, synchronous: null }), CurrentWriter, frame),
      { startImmediately: true },
    );
    while (!frame.acquired) yield* Effect.yieldNow;
    yield* connections.handover;
    expect((yield* Fiber.join(submitted)).outcome._tag).toBe('Applied');
  }),
);

it.live('a COMMIT that fails answers every program of its batch with the failure and keeps none of them', () =>
  Effect.gen(function* () {
    const store = yield* opened;
    yield* store.sql`PRAGMA foreign_keys = ON`;
    yield* store.sql`CREATE TABLE parent (id INTEGER PRIMARY KEY)`;
    yield* store.sql`CREATE TABLE child (parent INTEGER REFERENCES parent (id) DEFERRABLE INITIALLY DEFERRED)`;
    const answers = yield* batched(store, [inserted('parent', 1), inserted('child', 7)]);
    expect(answers.map((exit) => (Exit.isFailure(exit) ? 'failed' : exit.value.outcome._tag))).toEqual(['failed', 'failed']);
    const kept = yield* store.sql<{ n: number }>`SELECT (SELECT count(*) FROM parent) + (SELECT count(*) FROM child) AS n`;
    expect(kept[0]?.n).toBe(0);
  }),
);
