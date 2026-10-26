import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Database } from 'bun:sqlite';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Context, Effect, Layer } from 'effect';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { sourceStore } from '../testing/baseline.js';
import { storePlace } from '../testing/connection.js';
import { MachineStore } from '../contract/service/store.js';
import { baselineObjects, type BaselineReceipt, type SchemaObject } from './baseline.js';
import { storeLayer } from './open.js';

const receipt = JSON.parse(await readFile(join(fixtureMigrations.folder, 'baseline.json'), 'utf8')) as BaselineReceipt;
const local = readMigrationFiles({ migrationsFolder: fixtureMigrations.folder });

const opened = (path: string) =>
  Effect.flatMap(sharedPool, (pool) =>
    Effect.map(
      Layer.build(Layer.orDie(storeLayer(MachineStore, path, fixtureMigrations, { readers: 0 }, pool))),
      Context.get(MachineStore),
    ),
  );

layer(BunFileSystem.layer, { excludeTestServices: true })('baseline tail', (it) => {
  it.effect('the tail keeps only the running receipt, and the run completing drops it', () =>
    Effect.gen(function* () {
      const path = yield* storePlace('baseline-tail-');
      sourceStore(path, fixtureMigrations);
      const db = new Database(path);
      db.exec(
        "insert into thread (id, origin, spawn_root_id, principal_id, agent_id, reader_order_at, created_at) values ('t', 'unscoped', 't', 'operator', 'tagma', 1, 1)",
      );
      const run = db.query(
        'insert into thread_run (id, thread_id, status, owner_id, created_at, started_at, heartbeat_at, updated_at, applied_seq) values (?, ?, ?, ?, 1, 1, 1, 1, 2)',
      );
      run.run('running', 't', 'running', 'owner');
      run.run('ended', 't', 'completed', 'owner');
      const transition = db.query('insert into thread_run_transition values (?, ?, ?, ?, ?)');
      transition.run('running', 1, 'previous', 'plan', '{"previous":true}');
      transition.run('running', 2, 'latest', 'plan', '{"kept":true}');
      transition.run('ended', 2, 'ended', 'plan', '{"ended":true}');
      expect(db.query("select name from sqlite_master where type='trigger' and name='thread_run_receipt_end'").all()).toEqual([]);
      db.close();

      const store = yield* opened(path);
      expect(yield* store.db.all(sql`select run_id, seq, request_digest, result from thread_run_receipt`)).toEqual([
        { run_id: 'running', seq: 2, request_digest: 'latest', result: '{"kept":true}' },
      ]);
      const objects = yield* store.db.all<SchemaObject>(sql.raw(baselineObjects));
      expect(objects.find(({ name }) => name === 'thread_run_receipt_end')?.type).toBe('trigger');
      yield* store.db.run(sql`update thread_run set status='completed' where id='running'`);
      expect(yield* store.db.all(sql`select * from thread_run_receipt`)).toEqual([]);
      expect(yield* store.db.all(sql`select id, applied_seq from thread_run order by id`)).toEqual([
        { id: 'ended', applied_seq: 2 },
        { id: 'running', applied_seq: 2 },
      ]);
    }),
  );

  for (const retired of [true, false])
    it.effect(`a store at the full tail translates with its retired table ${retired ? 'present' : 'removed'}`, () =>
      Effect.gen(function* () {
        const path = yield* storePlace('baseline-tail-');
        sourceStore(path, fixtureMigrations, receipt.tail.length);
        if (!retired) {
          const db = new Database(path);
          db.exec('drop table retired_run_transition');
          db.close();
        }
        const store = yield* opened(path);
        expect(
          (yield* store.db.all<{ name: string }>(sql`select name from __drizzle_migrations order by created_at, id`)).map(
            ({ name }) => name,
          ),
        ).toEqual(local.map(({ name }) => name));
      }),
    );
});
