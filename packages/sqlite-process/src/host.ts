import { Database } from 'bun:sqlite';
import {
  thrownShapeOf,
  type ProgramOutcome,
  type ReturnedRows,
  type SqliteAsk,
  type SqliteProgram,
  type SqliteReply,
  type SqliteRequest,
  type SqliteSaid,
} from './channel.js';
import { checkEngine } from './engine.js';

const CHECKPOINT_PAGES = 1000;
const STATEMENTS = 512;

Database.MAX_QUERY_CACHE_SIZE = Math.max(Database.MAX_QUERY_CACHE_SIZE, STATEMENTS);
const EXPLAIN = /^(?:[\s;]|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*explain\b/i;

export type SqliteHost = {
  readonly answer: (request: SqliteRequest, queueMs: number) => SqliteSaid;
  readonly answered: (request: SqliteRequest, said: SqliteSaid) => void;
  readonly serve: (request: SqliteRequest, queueMs: number) => void;
  readonly busyTimeoutMs: (request: SqliteRequest) => number;
  readonly open: () => number;
  readonly maintaining: () => boolean;
  readonly close: () => void;
};

export const busy = (said: SqliteSaid): boolean =>
  said._tag === 'Failed' && (said.thrown.code === 'SQLITE_BUSY' || said.thrown.errno === 5);

const applied = (db: Database, program: SqliteProgram): ProgramOutcome => {
  const started = performance.now();
  db.run('SAVEPOINT program');
  let at = 0;
  const returned: ReturnedRows[] = [];
  try {
    for (; at < program.statements.length; at += 1) {
      const step = program.statements[at]!;
      const statement = db.query(step.sql);
      const params = step.params as [];
      let count: number;
      if (step.counts === 'changes') count = statement.run(...params).changes;
      else {
        const rows = statement.values(...params) ?? [];
        if (step.counts === 'returned') returned.push(rows);
        count = rows.length;
      }
      if (step.expect !== null && count !== step.expect) {
        db.run('ROLLBACK TO program');
        db.run('RELEASE program');
        return { _tag: 'Conflict', statement: at, expected: step.expect, actual: count, execMs: performance.now() - started };
      }
    }
    db.run('RELEASE program');
    const execMs = performance.now() - started;
    return returned.length === 0 ? { _tag: 'Applied', execMs } : { _tag: 'Applied', execMs, returned };
  } catch (cause) {
    if (!db.inTransaction) throw cause;
    db.run('ROLLBACK TO program');
    db.run('RELEASE program');
    return { _tag: 'Refused', statement: at, thrown: thrownShapeOf(cause), execMs: performance.now() - started };
  }
};

export const makeSqliteHost = (reply: (said: SqliteReply) => void, waits: 'engine' | 'caller' = 'engine'): SqliteHost => {
  const databases = new Map<number, Database>();
  const writers = new Map<number, string>();
  const timeouts = new Map<number, number>();
  let maintaining = false;

  const answer = (connection: number, ask: SqliteAsk, queueMs: number): SqliteSaid => {
    const started = performance.now();
    const db = databases.get(connection);
    try {
      switch (ask._tag) {
        case 'Open': {
          const opening = new Database(ask.config.filename, {
            readonly: ask.config.readonly,
            readwrite: ask.config.readwrite,
            create: ask.config.create,
          });
          try {
            checkEngine(opening);
            opening.run(`PRAGMA busy_timeout = ${waits === 'engine' ? ask.config.busyTimeoutMs : 0};`);
            if (ask.config.mmapBytes > 0) opening.run(`PRAGMA mmap_size = ${ask.config.mmapBytes};`);
            if (!ask.config.disableWAL && !ask.config.readonly) {
              opening.run('PRAGMA journal_mode = WAL;');
              if (ask.config.filename !== ':memory:') opening.run('PRAGMA wal_autocheckpoint = 0;');
            }
          } catch (cause) {
            opening.close();
            throw cause;
          }
          databases.set(connection, opening);
          timeouts.set(connection, ask.config.busyTimeoutMs);
          if (!ask.config.disableWAL && !ask.config.readonly && ask.config.filename !== ':memory:')
            writers.set(connection, ask.config.filename);
          return { _tag: 'Did', id: ask.id };
        }
        case 'Run': {
          const explained = EXPLAIN.test(ask.sql);
          const statement = explained ? db!.prepare(ask.sql) : db!.query(ask.sql);
          try {
            statement.safeIntegers(ask.safeIntegers);
            const rows =
              ask.shape === 'values' ? (statement.values(...(ask.params as [])) ?? []) : (statement.all(...(ask.params as [])) ?? []);
            const returnedAt = performance.now();
            return {
              _tag: 'Rows',
              id: ask.id,
              rows,
              queueMs,
              execMs: returnedAt - started,
              commitReturnedAt: ask.sql === 'COMMIT' ? performance.timeOrigin + returnedAt : undefined,
            };
          } finally {
            if (explained) statement.finalize();
          }
        }
        case 'Export':
          return { _tag: 'Exported', id: ask.id, bytes: db!.serialize() };
        case 'LoadExtension':
          db!.loadExtension(ask.path);
          return { _tag: 'Did', id: ask.id };
        case 'Close':
          db?.close();
          databases.delete(connection);
          writers.delete(connection);
          timeouts.delete(connection);
          return { _tag: 'Did', id: ask.id };
        case 'Checkpoint': {
          const checkpoint = new Database(ask.filename, { readwrite: true, create: false });
          try {
            checkEngine(checkpoint);
            checkpoint.run(
              ask.durable
                ? 'PRAGMA busy_timeout = 0; PRAGMA synchronous = FULL; PRAGMA fullfsync = ON; PRAGMA checkpoint_fullfsync = ON;'
                : 'PRAGMA busy_timeout = 0; PRAGMA synchronous = OFF;',
            );
            const [row] = checkpoint.query('PRAGMA wal_checkpoint(PASSIVE)').values() as [number, number, number][];
            if (row === undefined) throw new Error('SQLite answered no WAL checkpoint result.');
            return { _tag: 'Checkpointed', id: ask.id, log: row[1], copied: row[2] };
          } finally {
            checkpoint.close();
          }
        }
        case 'Programs': {
          if (ask.synchronous !== null) db!.run(`PRAGMA synchronous = ${ask.synchronous.toUpperCase()}`);
          db!.run('BEGIN IMMEDIATE');
          try {
            const outcomes = ask.programs.map((program) => applied(db!, program));
            db!.run('COMMIT');
            const returnedAt = performance.now();
            return {
              _tag: 'Committed',
              id: ask.id,
              outcomes,
              queueMs,
              execMs: returnedAt - started,
              commitReturnedAt: performance.timeOrigin + returnedAt,
            };
          } catch (cause) {
            if (db!.inTransaction) db!.run('ROLLBACK');
            throw cause;
          }
        }
        case 'Maintain':
          maintaining = true;
          return { _tag: 'Maintaining', id: 0 };
        case 'Ping':
          return { _tag: 'Did', id: ask.id };
      }
    } catch (cause) {
      return { _tag: 'Failed', id: ask.id, thrown: thrownShapeOf(cause), queueMs, execMs: performance.now() - started };
    }
  };

  const answered = ({ connection, ask }: SqliteRequest, said: SqliteSaid): void => {
    reply({ connection, said });
    const filename = writers.get(connection);
    const db = databases.get(connection);
    const wrote = (ask._tag === 'Run' && said._tag === 'Rows') || said._tag === 'Committed';
    if (!wrote || filename === undefined || db === undefined || db.inTransaction) return;
    try {
      const [row] = db.query('PRAGMA wal_checkpoint(NOOP)').values() as [number, number, number][];
      if (row !== undefined && row[1] - row[2] >= CHECKPOINT_PAGES) reply({ connection, said: { _tag: 'Changed', id: 0, filename } });
    } catch (cause) {
      reply({ connection, said: { _tag: 'CheckpointFailed', id: 0, filename, thrown: thrownShapeOf(cause) } });
    }
  };

  return {
    answer: (request, queueMs) => answer(request.connection, request.ask, queueMs),
    answered,
    serve: (request, queueMs) => answered(request, answer(request.connection, request.ask, queueMs)),
    busyTimeoutMs: ({ connection, ask }) => (ask._tag === 'Open' ? ask.config.busyTimeoutMs : (timeouts.get(connection) ?? 0)),
    open: () => databases.size,
    maintaining: () => maintaining,
    close: () => {
      for (const db of databases.values()) db.close();
      databases.clear();
      writers.clear();
    },
  };
};
