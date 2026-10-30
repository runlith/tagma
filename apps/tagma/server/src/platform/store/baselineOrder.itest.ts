import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Database } from 'bun:sqlite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { sourceStore } from '../testing/baseline.js';
import { inDatabase, storePlace } from '../testing/connection.js';
import { BaselineNotReached, MigrationChainInvalid } from '../contract/service/store.js';
import { translateBaseline, type BaselineReceipt } from './baseline.js';
import { makeWithDefaults } from 'drizzle-orm/effect-sqlite-bun';
import { sqliteProcessLayer } from '@runlith/sqlite-process/SqliteProcess';
import { storeSnapshots } from './snapshot.js';

const receipt = JSON.parse(await readFile(join(fixtureMigrations.folder, 'baseline.json'), 'utf8')) as BaselineReceipt;
const local = readMigrationFiles({ migrationsFolder: fixtureMigrations.folder });
const first = receipt.chain.findIndex((row, index) => row.folderMillis === receipt.chain[index + 1]?.folderMillis);
if (first < 0) throw new Error('The source receipt contains no equal-time pair.');
const a = receipt.chain[first]!;
const b = receipt.chain[first + 1]!;
const next = receipt.chain.find((row) => row.folderMillis > a.folderMillis)!;
const ledgerOf = (db: Database) => db.query('select name, hash, created_at from __drizzle_migrations order by created_at, id').all();
const swap = (db: Database, left: string, right: string) => {
  db.query(
    'update __drizzle_migrations set name = case name when ? then ? else ? end, hash = case name when ? then ? else ? end where name in (?, ?)',
  ).run(
    left,
    right,
    left,
    left,
    receipt.chain.find(({ name }) => name === right)!.hash,
    receipt.chain.find(({ name }) => name === left)!.hash,
    left,
    right,
  );
};

layer(BunFileSystem.layer, { excludeTestServices: true })('baseline translation order', (it) => {
  for (const reverse of [false, true])
    it.effect(`translation preserves history for the ${reverse ? 'reversed' : 'recorded'} equal-time order`, () =>
      Effect.gen(function* () {
        const path = yield* storePlace('baseline-order-');
        sourceStore(path, fixtureMigrations);
        const db = new Database(path);
        db.exec("insert into event (ts, op, payload) values (1, 'kept', 'unchanged')");
        if (reverse) swap(db, a.name, b.name);
        db.close();
        const result = yield* inDatabase(path, (db) =>
          Effect.gen(function* () {
            const translated = yield* translateBaseline(db, local, fixtureMigrations.folder, () => Effect.void);
            const history = yield* db.all(sql`select ts, op, payload from event`);
            const ledger = yield* db.all(sql`select name, hash from __drizzle_migrations order by created_at, id`);
            return { translated, history, ledger };
          }),
        );
        expect(result).toEqual({
          translated: true,
          history: [{ ts: 1, op: 'kept', payload: 'unchanged' }],
          ledger: [{ name: local[0]!.name, hash: local[0]!.hash }],
        });
      }),
    );

  it.effect('a ledger changed between admission and the translation transaction refuses without retiring its snapshot', () =>
    Effect.gen(function* () {
      const path = yield* storePlace('baseline-changed-');
      sourceStore(path, fixtureMigrations);
      const snapshots = storeSnapshots({}, yield* sharedPool);
      yield* inDatabase(path, (db) =>
        snapshots.take({ path, db }, [{ name: receipt.chain.at(-1)!.name, hash: 'future', sql: ["update meta set value = '1'"] }]),
      );
      const before = yield* Effect.promise(() => readFile(`${path}.snapshot.json`, 'utf8'));
      const changed = yield* Effect.scoped(
        Effect.gen(function* () {
          const db = yield* makeWithDefaults();
          return yield* Effect.flip(
            translateBaseline(db, local, fixtureMigrations.folder, (names) => Effect.asVoid(snapshots.release(path, names))),
          );
        }),
      ).pipe(
        Effect.provide(
          sqliteProcessLayer(
            {
              filename: path,
              readers: 0,
              onLost: (reason) => {
                throw new Error(reason);
              },
              checkStatement: (statement) =>
                Effect.sync(() => {
                  if (statement.toUpperCase() !== 'BEGIN IMMEDIATE') return;
                  const writer = new Database(path);
                  try {
                    writer.query('update __drizzle_migrations set hash = ? where name = ?').run('changed', receipt.chain.at(-1)!.name);
                  } finally {
                    writer.close();
                  }
                }),
            },
            yield* sharedPool,
          ),
        ),
      );
      expect(changed).toBeInstanceOf(MigrationChainInvalid);
      expect(yield* Effect.promise(() => readFile(`${path}.snapshot.json`, 'utf8'))).toBe(before);
      const after = yield* inDatabase(path, (db) =>
        db.all<{ name: string; hash: string }>(sql`select name, hash from __drizzle_migrations order by created_at, id`),
      );
      expect(after).toHaveLength(receipt.chain.length);
      expect(after.at(-1)).toEqual({ name: receipt.chain.at(-1)!.name, hash: 'changed' });
    }),
  );

  for (const mutation of ['missing', 'duplicate', 'hash', 'cross-time'] as const)
    it.effect(`translation refuses a ${mutation} ledger and keeps its rows`, () =>
      Effect.gen(function* () {
        const path = yield* storePlace('baseline-refusal-');
        sourceStore(path, fixtureMigrations);
        const db = new Database(path);
        if (mutation === 'missing') db.query('delete from __drizzle_migrations where name = ?').run(a.name);
        if (mutation === 'duplicate')
          db.query('update __drizzle_migrations set name = ?, hash = ? where name = ?').run(a.name, a.hash, b.name);
        if (mutation === 'hash') db.query('update __drizzle_migrations set hash = ? where name = ?').run('wrong', a.name);
        if (mutation === 'cross-time') swap(db, a.name, next.name);
        const before = ledgerOf(db);
        db.close();
        const result = yield* inDatabase(path, (db) =>
          Effect.flip(translateBaseline(db, local, fixtureMigrations.folder, () => Effect.void)),
        );
        expect(result).toBeInstanceOf(mutation === 'missing' ? BaselineNotReached : MigrationChainInvalid);
        const after = new Database(path, { readonly: true });
        try {
          expect(ledgerOf(after)).toEqual(before);
        } finally {
          after.close();
        }
      }),
    );
});
