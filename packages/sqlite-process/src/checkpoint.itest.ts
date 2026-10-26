import { Database } from 'bun:sqlite';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteClient } from '@effect/sql-sqlite-bun/SqliteClient';
import { Context, Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import { Connections, sqliteProcessLayer } from './SqliteProcess.js';
import { ProcessPool } from './ProcessPool.js';
import { selectEngine, SOURCE_ID } from './engine.js';

selectEngine();

const temporaryRoot = (prefix: string) =>
  Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), prefix))),
    (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
  );

const preparedPool = Effect.acquireRelease(
  Effect.sync(() => new ProcessPool(0)),
  (processes) => Effect.promise(() => processes.closePrepared()),
);

const within = <E>(limit: Effect.Effect<boolean, E>) =>
  Effect.suspend(function standing(): Effect.Effect<boolean, E> {
    return Effect.flatMap(limit, (met) => (met ? Effect.succeed(true) : Effect.andThen(Effect.sleep('10 millis'), standing)));
  });

it.live('the supplied engine checkpoints committed WAL outside the writer and preserves schema and snapshots', () =>
  Effect.gen(function* () {
    const root = yield* temporaryRoot('sqlite-checkpoint-');
    const filename = join(root, 'store.sqlite');
    const losses: string[] = [];
    const pids: number[] = [];
    const processes = yield* preparedPool;
    let reader: Database | undefined;
    yield* Effect.addFinalizer(() => Effect.sync(() => reader?.close()));
    yield* Effect.promise(() => processes.prepare(1));
    const prepared = Bun.spawnSync(['pgrep', '-P', String(process.pid)])
      .stdout.toString()
      .trim()
      .split('\n')
      .map(Number);
    const context = yield* Layer.build(
      sqliteProcessLayer(
        {
          filename,
          readers: 0,
          synchronous: 'full',
          fullfsync: true,
          onLost: (reason) => losses.push(reason),
          onSpawned: (birth) => {
            pids.push(birth.pid);
            return () => undefined;
          },
        },
        processes,
      ),
    );
    expect(pids).toHaveLength(2);
    expect(prepared).toEqual(expect.arrayContaining(pids));
    const sql = Context.get(context, SqlClient);
    const query = <A>(text: string) => sql.unsafe<A & object>(text);
    expect(yield* query('SELECT sqlite_source_id() AS source')).toEqual([{ source: SOURCE_ID }]);
    for (const pid of pids) process.kill(pid, 'SIGTERM');
    expect(yield* query('PRAGMA synchronous')).toEqual([{ synchronous: 2 }]);
    expect(yield* query('PRAGMA fullfsync')).toEqual([{ fullfsync: 1 }]);
    expect(yield* query('PRAGMA checkpoint_fullfsync')).toEqual([{ checkpoint_fullfsync: 1 }]);
    expect(yield* query('PRAGMA wal_autocheckpoint')).toEqual([{ wal_autocheckpoint: 0 }]);
    yield* query('CREATE TABLE doc(id INTEGER PRIMARY KEY, text TEXT UNIQUE, bytes BLOB)');
    yield* query("CREATE VIRTUAL TABLE doc_fts USING fts5(text, content='', contentless_delete=1, tokenize='trigram')");
    yield* query("INSERT INTO doc VALUES(1, 'committed history', NULL)");
    yield* query("INSERT INTO doc_fts(rowid, text) VALUES(1, 'committed history')");
    reader = new Database(filename, { readonly: true });
    reader.run('BEGIN');
    expect(reader.query('SELECT count(*) AS n FROM doc').get()).toEqual({ n: 1 });
    yield* sql.withTransaction(sql.unsafe("INSERT INTO doc VALUES(2, 'durable WAL', zeroblob(4100096))"));
    const blocked = yield* query<{ log: number; checkpointed: number }>('PRAGMA wal_checkpoint(NOOP)');
    expect(blocked[0]!.log).toBeGreaterThanOrEqual(1000);
    expect(blocked[0]!.checkpointed).toBeLessThan(blocked[0]!.log);
    expect(reader.query('SELECT count(*) AS n FROM doc').get()).toEqual({ n: 1 });
    reader.run('COMMIT');
    reader.close();
    reader = undefined;
    const copied = yield* within(
      Effect.map(
        query<{ log: number; checkpointed: number }>('PRAGMA wal_checkpoint(NOOP)'),
        ([row]) => row !== undefined && row.log === row.checkpointed,
      ),
    );
    expect(copied).toBe(true);
    expect(yield* query("SELECT rowid FROM doc_fts WHERE doc_fts MATCH 'history'")).toEqual([{ rowid: 1 }]);
    const [pages] = yield* query<{ pages: number }>('SELECT count(*) AS pages FROM dbstat');
    expect(pages!.pages).toBeGreaterThan(1000);
    const snapshotPath = join(root, 'snapshot.sqlite');
    writeFileSync(snapshotPath, yield* Context.get(context, SqliteClient).export);
    const snapshot = new Database(snapshotPath, { readonly: true });
    try {
      expect(snapshot.query('SELECT length(bytes) AS n FROM doc WHERE id=2').get()).toEqual({ n: 4100096 });
    } finally {
      snapshot.close();
    }
    yield* Context.get(context, Connections).handover;
    const returned = new Database(filename, { readonly: true });
    try {
      expect(returned.query('SELECT length(bytes) AS n FROM doc WHERE id=2').get()).toEqual({ n: 4100096 });
    } finally {
      returned.close();
    }
    expect(losses).toEqual([]);
  }),
);

it.live('losing the checkpoint process tells the owners of the database', () =>
  Effect.gen(function* () {
    const root = yield* temporaryRoot('sqlite-checkpoint-lost-');
    const losses: string[] = [];
    const pids: number[] = [];
    const processes = yield* preparedPool;
    yield* Layer.build(
      sqliteProcessLayer(
        {
          filename: join(root, 'store.sqlite'),
          readers: 0,
          onLost: (reason) => losses.push(reason),
          onSpawned: (birth) => {
            pids.push(birth.pid);
            return () => undefined;
          },
        },
        processes,
      ),
    );
    yield* Effect.addFinalizer(() => Effect.sync(() => process.kill(pids[0]!, 'SIGKILL')));
    expect(pids).toHaveLength(2);
    const checkpoint = pids[1]!;
    process.kill(checkpoint, 'SIGKILL');
    yield* within(Effect.sync(() => losses.length > 0));
    expect(losses.some((reason) => reason.includes('The WAL checkpoint process was lost'))).toBe(true);
  }),
);
