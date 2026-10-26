import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Clock, Context, Deferred, Effect, Exit, Fiber, Layer, Scope, Tracer } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import { ProcessPool } from './ProcessPool.js';
import { bulk, readOnly, sqliteProcessLayer } from './SqliteProcess.js';

const burn =
  'WITH RECURSIVE counter(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM counter WHERE x < 1000000) SELECT count(*) AS n FROM counter';

const withStores = Effect.fnUntraced(function* <A, E>(
  work: (
    open: (name: string, scope?: Scope.Scope) => Effect.Effect<SqlClient>,
    pids: Set<number>,
    lost: string[],
    readersLost: Deferred.Deferred<void>,
  ) => Effect.Effect<A, E, Scope.Scope>,
) {
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), 'sqlite-pool-'))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  );
  const held = yield* Effect.scope;
  const processes = new ProcessPool(2);
  const pids = new Set<number>();
  const lost: string[] = [];
  const readersLost = yield* Deferred.make<void>();
  const open = (name: string, scope = held) =>
    Effect.map(
      Scope.provide(
        Layer.build(
          sqliteProcessLayer(
            {
              filename: join(directory, `${name}.db`),
              onLost: (reason) => {
                lost.push(`${name}: ${reason}`);
              },
              onReaders: (event) => {
                if (event._tag === 'ReaderLost') {
                  lost.push(`${name}: reader`);
                  Deferred.doneUnsafe(readersLost, Effect.void);
                }
              },
              onSpawned: ({ pid }) => {
                pids.add(pid);
                return () => {
                  pids.delete(pid);
                };
              },
            },
            processes,
          ),
        ),
        scope,
      ),
      (context) => Context.get(context, SqlClient),
    );
  return yield* work(open, pids, lost, readersLost);
});

it.live('stores share bounded processes without sharing rows, transactions or connection lifetimes', () =>
  withStores((open, pids) =>
    Effect.gen(function* () {
      const own = yield* Scope.fork(yield* Effect.scope);
      const a = yield* open('a', own);
      const b = yield* open('b');
      for (const [index, sql] of [a, b].entries()) {
        yield* sql`CREATE TABLE item (value INTEGER)`;
        yield* sql`INSERT INTO item VALUES (${index})`;
        expect(yield* readOnly(sql`SELECT value FROM item`)).toEqual([{ value: index }]);
      }
      expect(pids.size).toBe(4);
      yield* a
        .withTransaction(
          Effect.gen(function* () {
            yield* a`INSERT INTO item VALUES (100)`;
            yield* b.withTransaction(b`INSERT INTO item VALUES (200)`);
            return yield* Effect.fail('rollback a');
          }),
        )
        .pipe(Effect.result);
      expect(yield* a`SELECT value FROM item`).toEqual([{ value: 0 }]);
      expect(yield* b`SELECT value FROM item`).toEqual([{ value: 1 }, { value: 200 }]);
      yield* Scope.close(own, Exit.void);
      expect(yield* b`SELECT value FROM item`).toEqual([{ value: 1 }, { value: 200 }]);
      expect(pids.size).toBe(3);
    }),
  ),
);

it.live('a bulk read in one store does not delay another store commit', () =>
  withStores((open, pids) =>
    Effect.gen(function* () {
      const a = yield* open('a');
      const b = yield* open('b');
      yield* a`CREATE TABLE item (value INTEGER)`;
      yield* b`CREATE TABLE item (value INTEGER)`;
      yield* bulk(a`SELECT value FROM item`);
      let ended = false;
      const timing: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          timing.push(span);
          return span;
        },
      });
      const slow = yield* Effect.forkChild(
        bulk(a.unsafe(burn)).pipe(
          Effect.withTracer(tracer),
          Effect.ensuring(
            Effect.sync(() => {
              ended = true;
            }),
          ),
        ),
      );
      yield* Effect.yieldNow;
      const started = performance.now();
      yield* b.withTransaction(b`INSERT INTO item VALUES (1)`);
      const commitMs = performance.now() - started;
      expect(ended).toBe(false);
      expect(yield* b`SELECT value FROM item`).toEqual([{ value: 1 }]);
      expect(pids.size).toBe(4);
      yield* Fiber.join(slow);
      const span = timing.find((span) => span.name === 'sql.execute')!;
      console.log(
        JSON.stringify({
          scenario: 'read A with commit B',
          commitMs,
          fingerprint: span.attributes.get('db.query.fingerprint'),
          execMs: span.attributes.get('db.exec.ms'),
          queueMs: span.attributes.get('db.queue.ms'),
        }),
      );
    }),
  ),
);

it.live('a shared reader crash fails its statement, retires every affected handle and leaves writers running', () =>
  withStores((open, pids, lost, readersLost) =>
    Effect.gen(function* () {
      const a = yield* open('a');
      const b = yield* open('b');
      yield* a`CREATE TABLE item (value INTEGER)`;
      yield* b`CREATE TABLE item (value INTEGER)`;
      const writers = [...pids];
      yield* readOnly(a`SELECT value FROM item`);
      yield* readOnly(b`SELECT value FROM item`);
      const reader = [...pids].find((pid) => !writers.includes(pid))!;
      const slow = yield* Effect.forkChild(Effect.result(readOnly(a.unsafe(burn))));
      yield* Effect.yieldNow;
      process.kill(reader, 'SIGKILL');
      yield* Deferred.await(readersLost);
      const failed = yield* Fiber.join(slow);
      expect(failed._tag).toBe('Failure');
      if (failed._tag === 'Failure') expect(failed.failure._tag).toBe('SqlError');
      expect(lost.sort()).toEqual(['a: reader', 'b: reader']);
      yield* b.withTransaction(b`INSERT INTO item VALUES (2)`);
      expect(yield* readOnly(b`SELECT value FROM item`)).toEqual([{ value: 2 }]);
      expect(yield* readOnly(a`SELECT value FROM item`)).toEqual([]);
      expect(writers.every((pid) => pids.has(pid))).toBe(true);
      expect(pids.has(reader)).toBe(false);
      expect(pids.size).toBe(4);
    }),
  ),
);

it.live('a keeping pool reuses its writer, reader and checkpoint children across store lifetimes and ends them on close', () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), 'sqlite-keep-'))),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
    );
    const processes = new ProcessPool(1, 'keep');
    const spawned: number[] = [];
    const registrant = () => {
      const held = new Set<number>();
      const onSpawned = ({ pid }: { readonly pid: number }) => {
        held.add(pid);
        spawned.push(pid);
        return () => {
          held.delete(pid);
        };
      };
      return { held, onSpawned };
    };
    const life = (owner: ReturnType<typeof registrant>, work: (sql: SqlClient) => Effect.Effect<unknown, unknown>) =>
      Effect.scoped(
        Effect.flatMap(
          Layer.build(
            sqliteProcessLayer({ filename: join(directory, 'kept.db'), onLost: () => {}, onSpawned: owner.onSpawned }, processes),
          ),
          (context) => work(Context.get(context, SqlClient)),
        ),
      );
    const first = registrant();
    const second = registrant();
    yield* life(first, (sql) => Effect.andThen(sql`CREATE TABLE item (value INTEGER)`, readOnly(sql`SELECT value FROM item`)));
    const kept = [...new Set(spawned)].sort();
    expect(kept.length).toBe(3);
    yield* life(second, (sql) => Effect.andThen(sql`INSERT INTO item VALUES (1)`, readOnly(sql`SELECT value FROM item`)));
    expect([...new Set(spawned)].sort()).toEqual(kept);
    yield* Effect.promise(() => processes.close());
    expect([...first.held, ...second.held]).toEqual([]);
    for (const pid of kept) expect(() => process.kill(pid, 0)).toThrow();
  }),
);

it.live('independent in-memory stores do not share a transaction fence', () =>
  Effect.gen(function* () {
    const processes = new ProcessPool(2);
    const open = () =>
      Effect.map(Layer.build(sqliteProcessLayer({ filename: ':memory:', onLost: () => {} }, processes)), (context) =>
        Context.get(context, SqlClient),
      );
    const a = yield* open();
    const b = yield* open();
    yield* a`CREATE TABLE item (value INTEGER)`;
    yield* b`CREATE TABLE item (value INTEGER)`;
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const first = yield* Effect.forkChild(
      a.withTransaction(
        Effect.gen(function* () {
          yield* a`INSERT INTO item VALUES (1)`;
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
        }),
      ),
    );
    yield* Deferred.await(entered);
    const second = yield* Effect.result(
      b.withTransaction(b`INSERT INTO item VALUES (2)`).pipe(Effect.ensuring(Deferred.succeed(release, undefined))),
    );
    yield* Fiber.join(first);
    expect(second._tag).toBe('Success');
    expect(yield* a`SELECT value FROM item`).toEqual([{ value: 1 }]);
    expect(yield* b`SELECT value FROM item`).toEqual([{ value: 2 }]);
  }),
);

it.live('a writer child loss rolls its transaction back and leaves another store writer running', () =>
  withStores((open, pids, lost) =>
    Effect.gen(function* () {
      const a = yield* open('a');
      const b = yield* open('b');
      yield* a`CREATE TABLE item (value INTEGER)`;
      yield* b`CREATE TABLE item (value INTEGER)`;
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const transaction = (sql: SqlClient) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO item VALUES (1)`;
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
            }),
          )
          .pipe(Effect.exit);
      const one = yield* Effect.forkChild(transaction(a));
      yield* Deferred.await(entered);
      const failed = yield* Effect.forkChild(Effect.result(a.unsafe(burn)));
      yield* Effect.yieldNow;
      process.kill([...pids][0]!, 'SIGKILL');
      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(one))._tag).toBe('Failure');
      expect((yield* Fiber.join(failed))._tag).toBe('Failure');
      expect(lost.length).toBe(1);
      yield* b.withTransaction(b`INSERT INTO item VALUES (2)`);
      expect(yield* b`SELECT value FROM item`).toEqual([{ value: 2 }]);
      const reopened = yield* open('a');
      expect(yield* reopened`SELECT value FROM item`).toEqual([]);
      expect(pids.size).toBe(3);
    }),
  ),
);

it.live('a writer whose close waits behind a blocked statement is retired within the close deadline', () =>
  withStores((open, pids) =>
    Effect.gen(function* () {
      const holder = yield* open('shared');
      yield* holder`CREATE TABLE item (value INTEGER)`;
      const before = new Set(pids);
      const own = yield* Scope.fork(yield* Effect.scope);
      const waiter = yield* open('shared', own);
      const retired = [...pids].find((pid) => !before.has(pid))!;
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const holding = yield* Effect.forkChild(
        holder.withTransaction(
          Effect.gen(function* () {
            yield* holder`INSERT INTO item VALUES (1)`;
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
          }),
        ),
      );
      yield* Deferred.await(entered);
      const blocked = yield* Effect.forkChild(Effect.exit(waiter`INSERT INTO item VALUES (2)`));
      yield* Effect.yieldNow;
      const started = yield* Clock.currentTimeMillis;
      yield* Scope.close(own, Exit.void);
      expect((yield* Clock.currentTimeMillis) - started).toBeLessThan(4000);
      expect(() => process.kill(retired, 0)).toThrow();
      expect((yield* Fiber.join(blocked))._tag).toBe('Failure');
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(holding);
      expect(yield* holder`SELECT value FROM item`).toEqual([{ value: 1 }]);
    }),
  ),
);
