import { Database } from 'bun:sqlite';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Duration, Effect, Exit, Fiber, Latch, Layer, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { SafeIntegers, SqlClient } from 'effect/sql/SqlClient';
import type { SqlError } from 'effect/sql/SqlError';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProcessPool } from './ProcessPool.js';
import { childHosting } from './children.js';
import type { PoolState } from './ReaderPool.js';
import { HeldFor } from '@runlith/held/holding';
import { bulk, Connections, readOnly, Readers, sqliteProcessLayer } from './SqliteProcess.js';
import type { StatementTiming } from './connection.js';

const fresh = (ceiling?: number) => new ProcessPool(ceiling, 'stop', undefined, childHosting);

const withClient = Effect.fnUntraced(function* <A, E>(work: (sql: SqlClient, lost: Array<string>) => Effect.Effect<A, E>) {
  const lost: Array<string> = [];
  const context = yield* Layer.build(sqliteProcessLayer({ filename: ':memory:', onLost: (reason) => void lost.push(reason) }, fresh()));
  return yield* work(Context.get(context, SqlClient), lost);
});

const burn = (rounds: number): string =>
  `WITH RECURSIVE counter(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM counter WHERE x < ${rounds}) SELECT count(*) AS n FROM counter`;

const SLOW = burn(4_000_000);
const BRIEF = burn(1_000_000);
const STANDING = burn(2_000_000);

const answeredOrFailure = <E extends { readonly _tag: string }, R>(effect: Effect.Effect<unknown, E, R>) =>
  effect.pipe(Effect.match({ onFailure: (failure) => failure._tag, onSuccess: () => 'answered' }));

it.live('a statement answers and a transaction rolls back whole', () =>
  Effect.gen(function* () {
    const rows = yield* withClient((sql) =>
      Effect.gen(function* () {
        yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)`;
        yield* sql`INSERT INTO t (name) VALUES ('kept')`;
        yield* sql
          .withTransaction(Effect.flatMap(sql`INSERT INTO t (name) VALUES ('dropped')`, () => Effect.fail('turn back')))
          .pipe(Effect.catch(() => Effect.void));
        return yield* sql<{ name: string }>`SELECT name FROM t ORDER BY id`;
      }),
    );
    expect(rows.map((row) => row.name)).toEqual(['kept']);
  }),
);

it.live('the writer standing names the work holding it, counts only the time nothing ran in the engine, and empties when it ends', () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(sqliteProcessLayer({ filename: ':memory:', onLost: () => undefined }, fresh()));
    const sql = Context.get(context, SqlClient);
    const { writer } = Context.get(context, Connections);
    const seen = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`;
          const burning = yield* Effect.forkChild(sql`${sql.literal(SLOW)}`);
          yield* Effect.sleep(Duration.millis(100));
          const running = yield* writer;
          yield* Fiber.join(burning);
          yield* Effect.sleep(Duration.millis(80));
          return { running, quiet: yield* writer };
        }),
      )
      .pipe(Effect.provideService(HeldFor, 'project.birth'));
    expect(seen.running.holder?.heldFor).toBe('project.birth');
    expect(seen.running.holder?.quietMs).toBe(0);
    expect(seen.quiet.holder?.quietMs).toBeGreaterThanOrEqual(70);
    expect(seen.quiet.holder?.heldMs).toBeGreaterThan(seen.quiet.holder?.quietMs ?? 0);
    expect((yield* writer).holder).toBeNull();
  }),
);

it.live('a statement waiting in SQLite leaves the asking loop able to release its blocker', () =>
  Effect.gen(function* () {
    const filename = yield* onDisk;
    const context = yield* Layer.build(sqliteProcessLayer({ filename, busyTimeout: Duration.seconds(86_400), onLost: () => {} }, fresh()));
    const sql = Context.get(context, SqlClient);
    const { writer } = Context.get(context, Connections);
    yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`;
    const blocker = yield* Effect.acquireRelease(
      Effect.sync(() => new Database(filename)),
      (blocker) => Effect.sync(() => blocker.close()),
    );
    blocker.run('BEGIN IMMEDIATE');
    const writing = yield* Effect.forkChild(sql`INSERT INTO t (id) VALUES (1)`, { startImmediately: true });
    while (true) {
      const standing = yield* writer;
      if (standing.holder?.quietMs === 0) break;
      yield* Effect.yieldNow;
    }
    yield* Effect.promise(
      () =>
        new Promise<void>((resolve) =>
          setImmediate(() => {
            blocker.run('COMMIT');
            resolve();
          }),
        ),
    );
    yield* Fiber.join(writing);
    expect(yield* sql<{ id: number }>`SELECT id FROM t`).toEqual([{ id: 1 }]);
  }),
);

it.live('every statement says where its time went: the round trip, the queue, the engine', () =>
  Effect.gen(function* () {
    const timings: Array<StatementTiming> = [];
    const context = yield* Layer.build(
      sqliteProcessLayer({ filename: ':memory:', onLost: () => {}, onStatement: (timing) => void timings.push(timing) }, fresh()),
    );
    const sql = Context.get(context, SqlClient);
    yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`;
    yield* Effect.forEach([sql`${sql.literal(BRIEF)}`, sql`${sql.literal(BRIEF)}`], (each) => each, { concurrency: 2 });
    expect(timings).toHaveLength(3);
    for (const timing of timings) {
      expect(timing.operation).toBe('execute');
      expect(timing.source).toBe('writer');
      expect(Number.isFinite(timing.totalMs)).toBe(true);
      expect(timing.totalMs).toBeGreaterThanOrEqual(0);
      expect(timing.queueMs).toBeGreaterThanOrEqual(0);
      expect(timing.execMs).toBeGreaterThanOrEqual(0);
    }
    expect(Math.max(...timings.map((timing) => timing.execMs))).toBeGreaterThan(50);
  }),
);

it.live('safe integers cross whole, and the mode is the asking fiber own', () =>
  Effect.gen(function* () {
    const { exact, lossy } = yield* withClient((sql) =>
      Effect.gen(function* () {
        yield* sql`CREATE TABLE big (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)`;
        yield* sql`INSERT INTO big (n) VALUES (9007199254740993)`;
        const read = sql<{ n: number | bigint }>`SELECT n FROM big`;
        return {
          exact: (yield* Effect.provideService(read, SafeIntegers, true))[0]?.n,
          lossy: (yield* read)[0]?.n,
        };
      }),
    );
    expect(exact).toBe(9007199254740993n);
    expect(lossy).toBe(9007199254740992);
  }),
);

it.live('the database exports its own bytes', () =>
  Effect.gen(function* () {
    const header = yield* withClient((sql) =>
      Effect.gen(function* () {
        yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`;
        const bytes = yield* (sql as unknown as { export: Effect.Effect<Uint8Array> }).export;
        return new TextDecoder().decode(bytes.slice(0, 15));
      }),
    );
    expect(header).toBe('SQLite format 3');
  }),
);

it.live('a statement asked after the connection is let go fails instead of waiting', () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const context = yield* Scope.provide(Layer.build(sqliteProcessLayer({ filename: ':memory:', onLost: () => {} }, fresh())), scope);
    const sql = Context.get(context, SqlClient);
    yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`;
    yield* Scope.close(scope, Exit.void);
    const outcome = yield* sql`SELECT 1`.pipe(Effect.match({ onFailure: (failure) => failure._tag, onSuccess: () => 'answered' }));
    expect(outcome).toBe('SqlError');
  }),
);

it.live('every door of the connection answers, and the name transforms are applied', () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      sqliteProcessLayer(
        {
          filename: ':memory:',
          onLost: () => {},
          transformResultNames: (name) => name.replace(/_(.)/g, (_, letter: string) => letter.toUpperCase()),
        },
        fresh(),
      ),
    );
    const sql = Context.get(context, SqlClient);
    yield* sql`CREATE TABLE person (id INTEGER PRIMARY KEY, given_name TEXT NOT NULL)`;
    yield* sql`INSERT INTO person (given_name) VALUES ('ada')`;
    const read = sql<{ givenName: string }>`SELECT given_name FROM person`;
    const seen = {
      rows: yield* read,
      untransformed: yield* read.withoutTransform,
      unprepared: yield* read.unprepared,
      values: yield* read.values,
      valuesUnprepared: yield* read.valuesUnprepared,
    };
    expect(seen.rows).toEqual([{ givenName: 'ada' }]);
    expect(seen.untransformed.map((row) => Object.keys(row))).toEqual([['given_name']]);
    expect(seen.unprepared).toEqual([{ givenName: 'ada' }]);
    expect(seen.values).toEqual([['ada']]);
    expect(seen.valuesUnprepared).toEqual([['ada']]);
  }),
);

const connectionPids = Effect.promise(async (): Promise<Array<number>> => {
  const found = Bun.spawn(['pgrep', '-P', String(process.pid), '-f', 'sqlite-process/src/child.ts'], {
    stdout: 'pipe',
    stderr: 'ignore',
  });
  return (await new Response(found.stdout).text()).trim().split('\n').filter(Boolean).map(Number);
});

const connectionPid = Effect.gen(function* () {
  const pids = yield* connectionPids;
  expect(pids).toHaveLength(1);
  return pids[0]!;
});

it.live('the loss is published before the statements it explains fail', () =>
  Effect.gen(function* () {
    const { atFailure, afterwards, lost, outcome } = yield* withClient((sql, lost) =>
      Effect.gen(function* () {
        const running = yield* Effect.forkChild(
          sql`${sql.literal(burn(200_000_000))}`.pipe(
            Effect.match({
              onFailure: (failure) => ({ lost: [...lost], outcome: failure._tag }),
              onSuccess: () => ({ lost: [], outcome: 'answered' }),
            }),
          ),
        );
        process.kill(yield* connectionPid, 'SIGKILL');
        const atFailure = yield* Fiber.join(running);
        const afterwards = yield* answeredOrFailure(sql`SELECT 1`);
        return { atFailure: atFailure.lost, outcome: atFailure.outcome, afterwards, lost: [...lost] };
      }),
    );
    expect(outcome).toBe('SqlError');
    expect(atFailure).toHaveLength(1);
    expect(atFailure[0]).toContain('died');
    expect(afterwards).toBe('SqlError');
    expect(lost).toHaveLength(1);
  }),
);

it.live('a handler that throws leaves no waiter on the wire and does not un-announce the loss', () =>
  Effect.gen(function* () {
    const said: Array<string> = [];
    const calls: Array<string> = [];
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const error = console.error;
        console.error = (...line: Array<unknown>) => void said.push(line.join(' '));
        return error;
      }),
      (error) =>
        Effect.sync(() => {
          console.error = error;
        }),
    );
    const context = yield* Layer.build(
      sqliteProcessLayer(
        {
          filename: ':memory:',
          onLost: () => {
            calls.push('told');
            throw new Error('the handler is broken');
          },
        },
        fresh(),
      ),
    );
    const sql = Context.get(context, SqlClient);
    const running = yield* Effect.forkChild(answeredOrFailure(sql`${sql.literal(burn(200_000_000))}`));
    process.kill(yield* connectionPid, 'SIGKILL');
    const outcome = yield* Fiber.join(running);
    const afterwards = yield* answeredOrFailure(sql`SELECT 1`);
    expect(outcome).toBe('SqlError');
    expect(afterwards).toBe('SqlError');
    expect(calls).toEqual(['told']);
    expect(said.join(' ')).toContain('the onLost handler threw');
  }),
);

it.live('simultaneous statements keep their own answers and leave the connection serving', () =>
  Effect.gen(function* () {
    const { answered, still } = yield* withClient((sql) =>
      Effect.gen(function* () {
        const answered = yield* Effect.all(
          [0, 1].map((n) => sql<{ n: number }>`SELECT ${n} AS n`),
          { concurrency: 2 },
        );
        const still = yield* sql<{ n: number }>`SELECT 1 AS n`;
        return { answered: answered.map((rows) => rows[0]?.n), still: still[0]?.n };
      }),
    );
    expect(answered).toEqual([0, 1]);
    expect(still).toBe(1);
  }),
);

const onDisk = Effect.acquireRelease(
  Effect.sync(() => join(mkdtempSync(join(tmpdir(), 'sqlite-process-')), 'held.db')),
  (file) => Effect.sync(() => rmSync(join(file, '..'), { recursive: true, force: true })),
);

it.live('a statement the connection is still busy with is questioned and left to finish', () =>
  Effect.gen(function* () {
    const file = yield* onDisk;
    const said: Array<string> = [];
    const questioned = yield* Deferred.make<void>();
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const warn = console.warn;
        console.warn = (...line: Array<unknown>) => {
          const message = line.join(' ');
          said.push(message);
          if (message.startsWith('[sqlite]')) Deferred.doneUnsafe(questioned, Effect.void);
        };
        return warn;
      }),
      (warn) =>
        Effect.sync(() => {
          console.warn = warn;
        }),
    );
    const { names, lost, askedWhileHeld } = yield* Effect.gen(function* () {
      const lost: Array<string> = [];
      const context = yield* Layer.build(
        sqliteProcessLayer(
          {
            filename: file,
            busyTimeout: Duration.seconds(30),
            onLost: (reason) => void lost.push(reason),
          },
          fresh(),
        ),
      );
      const sql = Context.get(context, SqlClient);
      yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;

      const holder = new Database(file);
      yield* Effect.addFinalizer(() => Effect.sync(() => holder.close()));
      holder.run('BEGIN IMMEDIATE');
      const waiting = yield* Effect.forkChild(sql`INSERT INTO t (name) VALUES ('waited')`, { startImmediately: true });

      const askedWhileHeld = yield* Effect.gen(function* () {
        yield* TestClock.adjust('1 day');
        expect(said.filter((line) => line.startsWith('[sqlite]'))).toEqual([]);
        yield* TestClock.withLive(Deferred.await(questioned));
        return said.filter((line) => line.startsWith('[sqlite]'));
      }).pipe(Effect.ensuring(Effect.sync(() => holder.run('COMMIT'))));
      yield* Fiber.join(waiting);

      const rows = yield* sql<{ name: string }>`SELECT name FROM t`;
      return { names: rows.map((row) => row.name), lost: [...lost], askedWhileHeld };
    }).pipe(Effect.provide(TestClock.layer({ warningDelay: Duration.minutes(1) })));
    expect(askedWhileHeld).toHaveLength(1);
    expect(askedWhileHeld[0]).toContain('INSERT INTO t');
    expect(names).toEqual(['waited']);
    expect(lost).toEqual([]);
  }),
);

const withReadClient = Effect.fnUntraced(function* <A, E>(
  work: (sql: SqlClient, pool: Effect.Effect<PoolState | undefined>) => Effect.Effect<A, E>,
  readers = 1,
  onStatement?: (timing: StatementTiming) => void,
) {
  const filename = yield* onDisk;
  const context = yield* Layer.build(sqliteProcessLayer({ filename, readers, onLost: () => {}, onStatement }, fresh()));
  return yield* work(Context.get(context, SqlClient), Context.get(context, Readers).state);
});

const poolReaches = (pool: Effect.Effect<PoolState | undefined>, reached: (state: PoolState) => boolean) => {
  const look: Effect.Effect<void> = Effect.flatMap(pool, (state) =>
    state !== undefined && reached(state) ? Effect.void : Effect.flatMap(Effect.yieldNow, () => look),
  );
  return look;
};

it.live('an explained statement leaves later reads seeing subsequent commits', () =>
  withReadClient((sql) =>
    Effect.gen(function* () {
      yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)`;
      yield* sql`INSERT INTO t (id, v) VALUES (1, 'before')`;
      for (const explain of ['EXPLAIN', ' ; /* plan */ ; -- reader\n eXpLaIn QUERY PLAN']) {
        yield* readOnly(sql`${sql.literal(explain)} SELECT v FROM t WHERE id = ${1}`);
        expect(yield* readOnly(sql<{ v: string }>`SELECT v FROM t WHERE id = 1`)).toEqual([{ v: 'before' }]);
        yield* sql`UPDATE t SET v = 'after' WHERE id = 1`;
        expect(yield* readOnly(sql<{ v: string }>`SELECT v FROM t WHERE id = 1`)).toEqual([{ v: 'after' }]);
        yield* sql`UPDATE t SET v = 'before' WHERE id = 1`;
      }
    }),
  ),
);

it.live('a declared read answers the last committed row while a transaction holds an uncommitted one', () =>
  Effect.gen(function* () {
    const seen = yield* withReadClient((sql) =>
      Effect.gen(function* () {
        yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)`;
        yield* sql`INSERT INTO t (id, v) VALUES (1, 'committed')`;
        const opened = yield* Latch.make(false);
        const holding = yield* Latch.make(false);
        const writing = yield* Effect.forkChild(
          sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`UPDATE t SET v = 'uncommitted' WHERE id = 1`;
              yield* opened.open;
              yield* holding.await;
            }),
          ),
        );
        yield* opened.await;
        const during = yield* readOnly(sql<{ v: string }>`SELECT v FROM t WHERE id = 1`);
        yield* holding.open;
        yield* Fiber.join(writing);
        const after = yield* sql<{ v: string }>`SELECT v FROM t WHERE id = 1`;
        return { during: during[0]?.v, after: after[0]?.v };
      }),
    );
    expect(seen.during).toBe('committed');
    expect(seen.after).toBe('uncommitted');
  }),
);

it.live('a declared read counts its engine time on the pool and says so to the caller', () =>
  Effect.gen(function* () {
    const seen: Array<StatementTiming> = [];
    const state = yield* withReadClient(
      (sql, pool) =>
        Effect.gen(function* () {
          yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`;
          yield* readOnly(sql`SELECT count(*) AS n FROM t`);
          return yield* pool;
        }),
      1,
      (timing) => void seen.push(timing),
    );
    expect(seen.map((timing) => timing.source)).toEqual(['writer', 'reader']);
    expect(state?.statements).toBe(1);
    expect(state?.execMs).toBe(seen[1]?.execMs);
    expect(state?.queueMs).toBe(seen[1]?.queueMs);
    expect(state?.maxExecMs).toBe(seen[1]?.execMs);
    expect(state?.maxQueueMs).toBe(seen[1]?.queueMs);
  }),
);

const readersBeside = (store: ReadonlyArray<number>) => Effect.map(connectionPids, (pids) => pids.filter((pid) => !store.includes(pid)));

const readersStanding = (store: ReadonlyArray<number>) => Effect.map(readersBeside(store), (readers) => readers.length);

it.live('a reader that died sends its own statement nowhere, and the next read opens another reader', () =>
  Effect.gen(function* () {
    const seen = yield* withReadClient((sql) =>
      Effect.gen(function* () {
        yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)`;
        yield* sql`INSERT INTO t (id, v) VALUES (1, 'committed')`;

        const store = yield* connectionPids;
        yield* readOnly(sql`SELECT v FROM t WHERE id = 1`);
        const withReader = yield* connectionPids;
        const reader = withReader.find((pid) => !store.includes(pid));
        expect(withReader).toHaveLength(store.length + 1);
        expect(reader).toBeDefined();

        process.kill(reader!, 'SIGKILL');

        const opened = yield* Latch.make(false);
        const holding = yield* Latch.make(false);
        const writing = yield* Effect.forkChild(
          sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`UPDATE t SET v = 'uncommitted' WHERE id = 1`;
              yield* opened.open;
              yield* holding.await;
            }),
          ),
        );
        yield* opened.await;
        const during = yield* readOnly(sql<{ v: string }>`SELECT v FROM t WHERE id = 1`).pipe(
          Effect.retry({ while: (failure: SqlError) => failure._tag === 'SqlError' }),
        );
        yield* holding.open;
        yield* Fiber.join(writing);
        return { during: during[0]?.v, readers: yield* readersBeside(store), dead: reader };
      }),
    );
    expect(seen.during).toBe('committed');
    expect(seen.readers).toHaveLength(1);
    expect(seen.readers).not.toContain(seen.dead);
  }),
);

it.live('a read its caller leaves mid-statement frees its lane at once, and every store sharing that lane reads on', () =>
  Effect.gen(function* () {
    const processes = fresh(1);
    const open = (filename: string) =>
      Effect.map(Layer.build(sqliteProcessLayer({ filename, onLost: () => {} }, processes)), (context) => ({
        sql: Context.get(context, SqlClient),
        pool: Context.get(context, Readers).state,
      }));
    const left = yield* open(yield* onDisk);
    const right = yield* open(yield* onDisk);
    for (const store of [left, right]) {
      yield* store.sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`;
      yield* readOnly(store.sql`SELECT count(*) AS n FROM t`);
    }

    const reading = yield* Effect.forkChild(readOnly(left.sql`${left.sql.literal(burn(200_000_000))}`));
    yield* poolReaches(left.pool, (state) => state.idle === 0);
    yield* Fiber.interrupt(reading);

    const count = (sql: SqlClient) => readOnly(sql<{ n: number }>`SELECT count(*) AS n FROM t`).pipe(Effect.map((rows) => rows[0]?.n));
    const seen = { left: yield* count(left.sql), right: yield* count(right.sql), lost: (yield* left.pool)?.lost };
    expect(seen).toEqual({ left: 0, right: 0, lost: 1 });
  }),
);

it.live('a statement inside a transaction joins it even when it declares itself a read', () =>
  Effect.gen(function* () {
    const inside = yield* withReadClient((sql) =>
      Effect.gen(function* () {
        yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)`;
        yield* sql`INSERT INTO t (id, v) VALUES (1, 'before')`;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`UPDATE t SET v = 'inside' WHERE id = 1`;
            const rows = yield* readOnly(sql<{ v: string }>`SELECT v FROM t WHERE id = 1`);
            return rows[0]?.v;
          }),
        );
      }),
    );
    expect(inside).toBe('inside');
  }),
);

it.live('a write that declares itself a read is refused, not landed outside a transaction', () =>
  Effect.gen(function* () {
    const seen = yield* withReadClient((sql) =>
      Effect.gen(function* () {
        yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)`;
        const answered = yield* readOnly(sql`INSERT INTO t (id, v) VALUES (1, 'x')`).pipe(
          Effect.match({
            onFailure: (failure: SqlError) => String((failure.reason.cause as { message?: string })?.message),
            onSuccess: () => 'no failure at all',
          }),
        );
        const rows = yield* sql<{ id: number }>`SELECT id FROM t`;
        return { answered, landed: rows.length };
      }),
    );
    expect(seen.answered).toContain('readonly database');
    expect(seen.landed).toBe(0);
  }),
);

const whileReading = Effect.fnUntraced(function* <A, E>(sql: SqlClient, reads: number, at: Effect.Effect<A, E>) {
  const running: Array<Fiber.Fiber<void>> = [];
  for (let read = 0; read < reads; read += 1) {
    running.push(yield* Effect.forkChild(Effect.ignore(readOnly(sql`${sql.literal(STANDING)}`))));
  }
  const seen = yield* at;
  yield* Effect.forEach(running, (fiber) => Fiber.join(fiber));
  return seen;
});

it.live('a bulk read runs on a reader and leaves the reserve to a point read', () =>
  Effect.gen(function* () {
    const seen = yield* withReadClient(
      (sql, pool) =>
        Effect.gen(function* () {
          yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`;
          const running: Array<Fiber.Fiber<void>> = [];
          for (let read = 0; read < 3; read += 1) {
            running.push(yield* Effect.forkChild(Effect.ignore(bulk(sql`${sql.literal(STANDING)}`))));
          }
          yield* poolReaches(pool, (state) => state.standing === 1 && state.bulkQueued === 2);
          const point = yield* readOnly(sql<{ n: number }>`SELECT count(*) AS n FROM t`);
          const refused = yield* bulk(sql`INSERT INTO t (id) VALUES (1)`).pipe(
            Effect.match({ onFailure: () => 'refused', onSuccess: () => 'landed' }),
          );
          yield* Effect.forEach(running, (fiber) => Fiber.join(fiber));
          return { point: point[0]?.n, refused };
        }),
      2,
    );
    expect(seen).toEqual({ point: 0, refused: 'refused' });
  }),
);

it.live('a ceiling of none opens no reader, and declared reads run on the writer', () =>
  Effect.gen(function* () {
    const seen = yield* withReadClient(
      (sql, pool) =>
        Effect.gen(function* () {
          yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`;
          const store = yield* connectionPids;
          expect(yield* readOnly(sql<{ n: number }>`SELECT count(*) AS n FROM t`)).toEqual([{ n: 0 }]);
          return { pool: yield* pool, standing: yield* readersStanding(store) };
        }),
      0,
    );
    expect(seen.pool).toBeUndefined();
    expect(seen.standing).toBe(0);
  }),
);

it.live('a ceiling of two opens two readers for three simultaneous reads and parks the third', () =>
  Effect.gen(function* () {
    const seen = yield* withReadClient(
      (sql, pool) =>
        Effect.gen(function* () {
          yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`;
          const store = yield* connectionPids;
          const standing = yield* whileReading(
            sql,
            3,
            Effect.flatMap(
              poolReaches(pool, (state) => state.standing === 2 && state.queued === 1),
              () => readersStanding(store),
            ),
          );
          return { standing, after: yield* readersStanding(store) };
        }),
      2,
    );
    expect(seen.standing).toBe(2);
    expect(seen.after).toBe(2);
  }),
);

it.live('an in-memory client keeps every statement on its one connection', () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(sqliteProcessLayer({ filename: ':memory:', readers: 4, onLost: () => {} }, fresh()));
    const sql = Context.get(context, SqlClient);
    yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`;
    yield* sql`INSERT INTO t (id) VALUES (1)`;
    const ids = yield* readOnly(sql<{ id: number }>`SELECT id FROM t`);
    expect(ids.map((row) => row.id)).toEqual([1]);
  }),
);

const mmapOf = Effect.fnUntraced(
  function* (mmapBytes: number | undefined) {
    const context = yield* Layer.build(
      sqliteProcessLayer(
        {
          filename: yield* onDisk,
          onLost: () => {},
          mmapBytes,
        },
        fresh(),
      ),
    );
    const sql = Context.get(context, SqlClient);
    const read = sql<{ mmap_size: number }>`PRAGMA mmap_size`;
    const writer = yield* read;
    const reader = yield* readOnly(read);
    return { writer: Number(writer[0]?.mmap_size ?? -1), reader: Number(reader[0]?.mmap_size ?? -1) };
  },
  (effect) => Effect.scoped(effect),
);

it.live('a connection to a file maps it, readers included, and a caller may decline the mapping', () =>
  Effect.gen(function* () {
    const standing = yield* mmapOf(undefined);
    expect(standing.writer).toBeGreaterThan(0);
    expect(standing.reader).toBe(standing.writer);

    const declined = yield* mmapOf(0);
    expect(declined).toEqual({ writer: 0, reader: 0 });
  }),
);
