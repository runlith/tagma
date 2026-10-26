import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import { openConnection } from './connection.js';
import { ProcessPool } from './ProcessPool.js';
import { Connections, Handover, readOnly, sqliteProcessLayer } from './SqliteProcess.js';

const temporaryRoot = (prefix: string) =>
  Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), prefix))),
    (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
  );

it.live('a handed-over writer releases its WAL to the successor without ending another store on the shared reader', () =>
  Effect.gen(function* () {
    const root = yield* temporaryRoot('sqlite-handover-');
    const filename = join(root, 'owned.sqlite');
    const foreignPath = join(root, 'foreign.sqlite');
    const foreignDb = new Database(foreignPath);
    foreignDb.run('create table item(value text)');
    foreignDb.run("insert into item values ('foreign')");
    foreignDb.close();
    let writer = 0;
    const losses: string[] = [];
    const processes = new ProcessPool(1);
    const foreign = yield* openConnection(processes, { filename: foreignPath, readonly: true, onLost: (reason) => losses.push(reason) }, 0);
    const priorScope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void));
    const before = yield* Layer.buildWithScope(
      sqliteProcessLayer(
        {
          filename,
          readers: 1,
          synchronous: 'full',
          fullfsync: true,
          onLost: (reason) => losses.push(reason),
          onSpawned: ({ pid }) => {
            writer = pid;
            return () => {};
          },
        },
        processes,
      ).pipe(Layer.provide(Layer.succeed(Handover, Effect.succeed(true)))),
      priorScope,
    );
    const sql = Context.get(before, SqlClient);
    yield* sql`create table item(value text)`;
    yield* sql.withTransaction(sql`insert into item values ('accepted')`);
    const refused = yield* Effect.result(
      sql.withTransaction(sql`insert into item values ('unfinished')`.pipe(Effect.andThen(Effect.fail('not accepted')))),
    );
    expect(refused._tag).toBe('Failure');
    expect(yield* readOnly(sql`select value from item`)).toEqual([{ value: 'accepted' }]);
    expect((yield* Effect.promise(() => stat(`${filename}-wal`))).size).toBeGreaterThan(0);
    const started = performance.now();
    yield* Scope.close(priorScope, Exit.void);
    const handoverMs = performance.now() - started;
    let ended: unknown;
    try {
      process.kill(writer, 0);
    } catch (cause) {
      ended = cause;
    }
    expect(ended).toMatchObject({ code: 'ESRCH' });
    expect(yield* foreign.executeRaw('select value from item', [])).toEqual([{ value: 'foreign' }]);
    const after = yield* Layer.build(
      sqliteProcessLayer(
        { filename, readers: 0, synchronous: 'full', fullfsync: true, onLost: (reason) => losses.push(reason) },
        new ProcessPool(0),
      ),
    );
    expect(yield* Context.get(after, SqlClient)`select value from item`).toEqual([{ value: 'accepted' }]);
    expect(losses).toEqual([]);
    console.log(
      JSON.stringify({ handoverMs, priorWriter: writer, wal: 'last accepted record read by successor', foreign: 'still readable' }),
    );
  }),
);

it.live('handover closes admission while an accepted transaction reaches its durable outcome', () =>
  Effect.gen(function* () {
    const root = yield* temporaryRoot('sqlite-handover-drain-');
    const filename = join(root, 'owned.sqlite');
    const before = yield* Layer.build(
      sqliteProcessLayer(
        {
          filename,
          readers: 0,
          synchronous: 'full',
          fullfsync: true,
          onLost: (reason) => {
            throw new Error(reason);
          },
        },
        new ProcessPool(0),
      ),
    );
    const sql = Context.get(before, SqlClient);
    const connections = Context.get(before, Connections);
    yield* sql`create table item(value text)`;
    const entered = yield* Deferred.make<void>();
    const finish = yield* Deferred.make<void>();
    const transaction = yield* Effect.forkChild(
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`insert into item values ('accepted')`;
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(finish);
          yield* sql`insert into item values ('finished')`;
        }),
      ),
    );
    yield* Deferred.await(entered);
    const handingOver = yield* Effect.forkChild(connections.handover, { startImmediately: true });
    expect(yield* connections.state).toBe('handing-over');
    const late = yield* Effect.result(sql`insert into item values ('late')`);
    expect(late._tag === 'Failure' ? late.failure._tag : null).toBe('SqlError');
    yield* Deferred.succeed(finish, undefined);
    yield* Fiber.join(transaction);
    yield* Fiber.join(handingOver);
    const after = yield* Layer.build(
      sqliteProcessLayer(
        {
          filename,
          readers: 0,
          onLost: (reason) => {
            throw new Error(reason);
          },
        },
        new ProcessPool(0),
      ),
    );
    expect(yield* Context.get(after, SqlClient)`select value from item order by rowid`).toEqual([
      { value: 'accepted' },
      { value: 'finished' },
    ]);
  }),
);
