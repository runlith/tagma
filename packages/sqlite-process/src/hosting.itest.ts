import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Duration, Effect, Fiber, Layer } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import type { SqlError } from 'effect/sql/SqlError';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childHosting } from './children.js';
import type { Hosting } from './hosting.js';
import { inlineHosting } from './inline.js';
import { ProcessPool } from './ProcessPool.js';
import { Connections, readOnly, Readers, sqliteProcessLayer } from './SqliteProcess.js';

const database = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), 'sqlite-hosting-'))),
  (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
).pipe(Effect.map((directory) => join(directory, 'store.sqlite')));

const pooled = (hosting: Hosting) =>
  Effect.acquireRelease(
    Effect.sync(() => new ProcessPool(1, 'stop', undefined, hosting)),
    (pool) => Effect.promise(() => pool.close()),
  );

const opened = Effect.fnUntraced(function* (pool: ProcessPool, filename: string) {
  const context = yield* Layer.build(sqliteProcessLayer({ filename, readers: 1, synchronous: 'off', onLost: () => undefined }, pool));
  return { sql: Context.get(context, SqlClient), connections: Context.get(context, Connections), readers: Context.get(context, Readers) };
});

for (const [name, hosting] of [
  ['child', childHosting],
  ['in-process', inlineHosting],
] as const) {
  describe(`${name} hosting`, () => {
    it.live('a committed row reads back on a reader lane and a constraint failure keeps its class', () =>
      Effect.gen(function* () {
        const { sql, readers } = yield* opened(yield* pooled(hosting), yield* database);
        yield* sql`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)`;
        yield* sql.withTransaction(sql`INSERT INTO t (name) VALUES ('kept')`);
        expect(yield* readOnly(sql<{ name: string }>`SELECT name FROM t`)).toEqual([{ name: 'kept' }]);
        expect((yield* readers.state)?.statements).toBe(1);
        const failed = yield* sql`INSERT INTO t (name) VALUES ('kept')`.pipe(
          Effect.match({ onFailure: (failure: SqlError) => failure.reason._tag, onSuccess: () => 'inserted' }),
        );
        expect(failed).toBe('UniqueViolation');
      }),
    );

    it.live('a second writer of the file waits out a transaction held across an await, then writes', () =>
      Effect.gen(function* () {
        const pool = yield* pooled(hosting);
        const filename = yield* database;
        const first = yield* opened(pool, filename);
        const second = yield* opened(pool, filename);
        yield* first.sql`CREATE TABLE t (name TEXT NOT NULL)`;
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const holding = yield* Effect.forkChild(
          first.sql.withTransaction(
            Effect.andThen(
              first.sql`INSERT INTO t (name) VALUES ('first')`,
              Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)),
            ),
          ),
        );
        yield* Deferred.await(entered);
        const waiting = yield* Effect.forkChild(second.sql`INSERT INTO t (name) VALUES ('second')`);
        yield* Effect.sleep(Duration.millis(100));
        expect(waiting.pollUnsafe()).toBeUndefined();
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(holding);
        yield* Fiber.join(waiting);
        expect(yield* first.sql<{ name: string }>`SELECT name FROM t ORDER BY rowid`).toEqual([{ name: 'first' }, { name: 'second' }]);
      }),
    );

    it.live('a log past the checkpoint threshold is copied into the database file', () =>
      Effect.gen(function* () {
        const filename = yield* database;
        const { sql } = yield* opened(yield* pooled(hosting), filename);
        yield* sql`CREATE TABLE t (body BLOB NOT NULL)`;
        yield* sql`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 1200) INSERT INTO t SELECT zeroblob(4096) FROM n`;
        yield* sql`SELECT 1`;
        while (statSync(filename).size < 4096 * 1200) yield* Effect.sleep(Duration.millis(20));
      }),
    );

    it.live('retired connections refuse the next statement', () =>
      Effect.gen(function* () {
        const { sql, connections } = yield* opened(yield* pooled(hosting), yield* database);
        yield* sql`SELECT 1`;
        yield* connections.retire;
        expect(yield* connections.state).toBe('retired');
        const after = yield* sql`SELECT 1`.pipe(
          Effect.match({ onFailure: (failure: SqlError) => failure._tag, onSuccess: () => 'answered' }),
        );
        expect(after).toBe('SqlError');
      }),
    );
  });
}
