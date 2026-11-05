import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProcessPool } from './ProcessPool.js';
import { childHosting } from './children.js';
import { sqliteProcessLayer } from './SqliteProcess.js';
import { selectEngine } from './engine.js';

selectEngine();

it.live('a statement the child fails with SQLITE_IOERR names the database file, the SQLite code and the errno', () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'sqlite-ioerr-'))),
      (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
    );
    const filename = join(root, 'store.sqlite');
    let broken = false;
    class FailingPool extends ProcessPool {
      override connect(...args: Parameters<ProcessPool['connect']>) {
        const [lane, receive, lost, spawned, purpose] = args;
        return super.connect(
          lane,
          (said) =>
            receive(
              broken && said._tag === 'Rows'
                ? {
                    _tag: 'Failed',
                    id: said.id,
                    queueMs: said.queueMs,
                    execMs: said.execMs,
                    thrown: {
                      name: 'SQLiteError',
                      message: 'disk I/O error',
                      code: 'SQLITE_IOERR_SHORT_READ',
                      errno: 522,
                      constraint: undefined,
                    },
                  }
                : said,
            ),
          lost,
          spawned,
          purpose,
        );
      }
    }
    const context = yield* Layer.build(
      sqliteProcessLayer({ filename, onLost: () => undefined }, new FailingPool(undefined, 'stop', undefined, childHosting)),
    );
    const sql = Context.get(context, SqlClient);
    yield* sql`CREATE TABLE item(id INTEGER PRIMARY KEY)`;
    broken = true;
    const failure = yield* Effect.flip(sql`SELECT * FROM item`);
    expect(failure.message).toContain(filename);
    expect(failure.message).toContain('SQLITE_IOERR_SHORT_READ');
    expect(failure.message).toContain('errno 522');
    expect(failure.reason.cause).toMatchObject({ message: 'disk I/O error', code: 'SQLITE_IOERR_SHORT_READ', errno: 522, filename });
  }),
);
