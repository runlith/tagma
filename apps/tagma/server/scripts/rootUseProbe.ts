import { Database } from 'bun:sqlite';
import { dirname, join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { makeWithDefaults } from 'drizzle-orm/effect-sqlite-bun';
import { sqliteProcessLayer } from '@runlith/sqlite-process/SqliteProcess';
import { MachineStore } from '../src/platform/contract/service/store.js';
import { storeLayer } from '../src/platform/store/open.js';
import { storeSnapshots } from '../src/platform/store/snapshot.js';
import { chain } from '../src/platform/store/chain.js';
import { migrationsFolder } from '../src/installation/closure/read.js';

const [path, mode, useId] = process.argv.slice(2);
if (path === undefined || !['open', 'estimate', 'delete'].includes(mode ?? ''))
  throw new Error('Pass an isolated APFS clone and open, estimate or delete; never the live store.');
const snapshots = storeSnapshots({});
if (mode === 'delete') {
  if (useId === undefined) throw new Error('Pass the same released use for both deletion samples.');
  const db = new Database(path);
  try {
    db.exec('pragma foreign_keys = on; pragma synchronous = FULL; pragma fullfsync = ON;');
    console.log(JSON.stringify({ phase: 'plan', rows: db.query('explain query plan delete from root_use where use_id = ?').all(useId) }));
    db.exec('begin immediate');
    db.query('delete from root_use_hold where use_id = ?').run(useId);
    const started = performance.now();
    const removed = db.query('delete from root_use where use_id = ?').run(useId);
    console.log(JSON.stringify({ phase: 'delete', elapsedMs: performance.now() - started, removed: removed.changes }));
    db.exec('rollback');
  } finally {
    db.close();
  }
} else if (mode === 'estimate') {
  const migration = chain({ folder: migrationsFolder }).at(-1)!;
  const estimate = await Effect.runPromise(
    Effect.flatMap(makeWithDefaults(), (db) => snapshots.estimate({ db, path }, [migration], migrationsFolder)).pipe(
      Effect.provide(
        sqliteProcessLayer({
          filename: path,
          readers: 0,
          onLost: (reason) => {
            throw new Error(reason);
          },
        }),
      ),
    ),
  );
  console.log(JSON.stringify({ phase: 'estimate', estimate }));
} else {
  const started = performance.now();
  const runtime = ManagedRuntime.make(
    Layer.orDie(
      storeLayer(
        MachineStore,
        path,
        {
          folder: migrationsFolder,
          seeds: join(dirname(path), 'root-use-seeds'),
          snapshots,
        },
        { readers: 0 },
      ),
    ),
  );
  try {
    const store = await runtime.runPromise(MachineStore);
    console.log(JSON.stringify({ phase: 'opened', elapsedMs: performance.now() - started, schema: store.schema }));
  } finally {
    await runtime.dispose();
  }
  console.log(JSON.stringify({ phase: 'closed', elapsedMs: performance.now() - started }));
}
