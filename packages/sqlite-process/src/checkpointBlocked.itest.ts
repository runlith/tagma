import { Database } from 'bun:sqlite';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect } from 'effect';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Checkpoints } from './Checkpoints.js';
import { ProcessPool } from './ProcessPool.js';
import { childHosting } from './children.js';
import { thrownShapeOf, type SqliteSaid } from './channel.js';
import { checkEngine, selectEngine } from './engine.js';

selectEngine();

it.live('an implicit read cursor blocks the writer probe without losing the store, and the deferred checkpoint completes', () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'sqlite-checkpoint-blocked-'))),
      (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
    );
    const filename = join(root, 'store.sqlite');
    let open = true;
    const db = yield* Effect.acquireRelease(
      Effect.sync(() => new Database(filename)),
      (db) =>
        Effect.sync(() => {
          if (open) db.close();
        }),
    );
    db.run('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE item(value); INSERT INTO item VALUES(1),(2)');
    checkEngine(db);
    db.run('CREATE TABLE waiting(id INTEGER PRIMARY KEY)');
    db.query(
      "EXPLAIN QUERY PLAN SELECT item.* FROM item JOIN waiting ON waiting.id=item.rowid WHERE item.value IN (SELECT value FROM json_each('[1,2]'))",
    ).all();
    expect(db.query('PRAGMA wal_checkpoint(NOOP)').values()[0]?.[0]).toBe(0);
    const cursor = db.query('SELECT * FROM item').iterate();
    cursor.next();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        cursor.return?.();
      }),
    );
    expect(db.inTransaction).toBe(false);
    const blocked = yield* Effect.flip(Effect.try({ try: () => db.query('PRAGMA wal_checkpoint(NOOP)').values(), catch: thrownShapeOf }));
    expect(blocked.code).toBe('SQLITE_LOCKED');
    const completed = yield* Deferred.make<Extract<SqliteSaid, { _tag: 'Checkpointed' }>>();
    const rejected = yield* Deferred.make<Extract<SqliteSaid, { _tag: 'Failed' }>>();
    const recovered = yield* Deferred.make<Extract<SqliteSaid, { _tag: 'Checkpointed' }>>();
    let failed = false;
    class ObservedPool extends ProcessPool {
      override connect(...args: Parameters<ProcessPool['connect']>) {
        const [lane, receive, lost, spawned, purpose] = args;
        return super.connect(
          lane,
          (said) => {
            receive(said);
            if (said._tag === 'Checkpointed') Deferred.doneUnsafe(completed, Effect.succeed(said));
            if (said._tag === 'Checkpointed' && failed) Deferred.doneUnsafe(recovered, Effect.succeed(said));
            if (said._tag === 'Failed') {
              failed = true;
              Deferred.doneUnsafe(rejected, Effect.succeed(said));
            }
          },
          lost,
          spawned,
          purpose,
        );
      }
    }
    const checkpoints = new Checkpoints(new ObservedPool(0, 'stop', undefined, childHosting));
    const losses: string[] = [];
    checkpoints.add(
      1,
      filename,
      true,
      (reason) => ({
        announce: () => {
          losses.push(reason);
        },
        wake: () => {},
      }),
      undefined,
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => checkpoints.drop(1)));
    checkpoints.failed(filename, blocked);
    expect(losses).toEqual([]);
    cursor.return?.();
    const copied = yield* Deferred.await(completed);
    expect(copied.log).toBeGreaterThan(0);
    expect(copied.copied).toBe(copied.log);
    db.run('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');
    checkpoints.changed(filename);
    const busy = yield* Deferred.await(rejected);
    expect(busy.thrown.code).toBe('SQLITE_BUSY');
    expect((busy.thrown.errno ?? 0) & 0xff).toBe(5);
    expect(losses).toEqual([]);
    db.run('ROLLBACK');
    db.close();
    open = false;
    const finished = yield* Deferred.await(recovered);
    expect(finished.copied).toBe(finished.log);
    expect(losses).toEqual([]);
    const reopened = yield* Effect.acquireRelease(
      Effect.sync(() => new Database(filename)),
      (db) => Effect.sync(() => db.close()),
    );
    expect(reopened.query('SELECT value FROM item').all()).toEqual([{ value: 1 }, { value: 2 }]);
    checkpoints.failed(filename, {
      name: 'SQLiteError',
      message: 'disk I/O error',
      code: 'SQLITE_IOERR',
      errno: 10,
      constraint: undefined,
    });
    expect(losses).toEqual(['disk I/O error']);
  }),
);
