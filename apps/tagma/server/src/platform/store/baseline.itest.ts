import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cause, Context, Effect, Exit, FileSystem, Layer } from 'effect';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { makeWithDefaults } from 'drizzle-orm/effect-sqlite-bun';
import { sqliteProcessLayer } from '@runlith/sqlite-process/SqliteProcess';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { BaselineNotReached, MachineStore, MigrationChainInvalid, type MigrationChain } from '../contract/service/store.js';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { sourceStore } from '../testing/baseline.js';
import { inDatabase } from '../testing/connection.js';
import { baselineObjects, schemaDigest, translateBaseline, type BaselineReceipt, type SchemaObject } from './baseline.js';
import { storeLayer } from './open.js';
import { storeSnapshots } from './snapshot.js';
import { SnapshotFailed } from '../contract/service/snapshots.js';
import { pendingMigrations } from './chain.js';

const baselineFixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const folder = yield* files.makeTempDirectoryScoped({ prefix: 'baseline-chain-' });
  const statements = [
    ['20260101000002_base', ['CREATE TABLE event (ts integer, op text, payload text);', 'CREATE TABLE meta (key text, value text);']],
    ['20260101000003_following', ['CREATE TABLE following (id integer PRIMARY KEY);']],
    ['20260101000004_indexed', ['CREATE INDEX following_id ON following(id);']],
  ] as const;
  for (const [name, sql] of statements) {
    yield* files.makeDirectory(join(folder, name));
    yield* files.writeFileString(join(folder, name, 'migration.sql'), sql.join('\n--> statement-breakpoint\n'));
  }
  const local = readMigrationFiles({ migrationsFolder: folder });
  const fingerprints = yield* Effect.acquireUseRelease(
    Effect.sync(() => new Database(':memory:')),
    (db) =>
      Effect.sync(() =>
        local.map((migration) => {
          for (const statement of migration.sql) db.exec(statement);
          return schemaDigest(db.query<SchemaObject, []>(baselineObjects).all());
        }),
      ),
    (db) => Effect.sync(() => db.close()),
  );
  const receipt: BaselineReceipt = {
    migration: local[0]!.name,
    release: 'baseline-fixture',
    schema: fingerprints[0]!,
    retiredTables: [],
    chain: [
      { name: '20260101000000_event', hash: 'event-schema', folderMillis: 0 },
      { name: '20260101000001_meta', hash: 'meta-schema', folderMillis: 1 },
    ],
    tail: local.slice(1).map((migration, at) => ({
      name: migration.name,
      hash: migration.hash,
      folderMillis: migration.folderMillis,
      schema: fingerprints[at + 1]!,
    })),
  };
  yield* files.writeFileString(join(folder, 'baseline.json'), JSON.stringify(receipt));
  return { migrations: { folder, seeds: join(folder, 'seeds') } satisfies MigrationChain<'machine'>, local, receipt };
});

class BaselineFixture extends Context.Service<BaselineFixture, Effect.Success<typeof baselineFixture>>()('testing/BaselineFixture') {}

const place = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  return join(yield* files.makeTempDirectoryScoped({ prefix: 'store-baseline-' }), 'tagma.sqlite');
});
const open = Effect.fnUntraced(function* (path: string, migrations?: MigrationChain<'machine'>) {
  const chosen = migrations ?? (yield* BaselineFixture).migrations;
  return Context.get(
    yield* Layer.build(Layer.orDie(storeLayer(MachineStore, path, chosen, { readers: 0, durable: false }, yield* sharedPool))),
    MachineStore,
  );
});
const refused = Effect.fnUntraced(function* (path: string) {
  const { migrations } = yield* BaselineFixture;
  return yield* Effect.exit(
    Effect.scoped(Layer.build(storeLayer(MachineStore, path, migrations, { readers: 0, durable: false }, yield* sharedPool))),
  );
});
const rowsOf = (path: string) =>
  Effect.sync(() => {
    const db = new Database(path, { readonly: true });
    try {
      return db.query<{ name: string; hash: string }, []>('select name, hash from __drizzle_migrations order by created_at, id').all();
    } finally {
      db.close();
    }
  });
const nameHash = ({ name, hash }: { readonly name: string; readonly hash: string }) => ({ name, hash });

layer(Layer.effect(BaselineFixture, baselineFixture).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'store baseline',
  (it) => {
    it.effect('a fresh store records the baseline and every following migration and seeds its rows', () =>
      Effect.gen(function* () {
        const path = yield* place;
        const store = yield* open(path, fixtureMigrations);
        expect(yield* rowsOf(path)).toEqual(readMigrationFiles({ migrationsFolder: fixtureMigrations.folder }).map(nameHash));
        expect(yield* store.db.all(sql`select outcome, count from terminal_request_key_tally order by outcome`)).toEqual([
          { outcome: 'admitted', count: 0 },
          { outcome: 'expired', count: 0 },
          { outcome: 'pending', count: 0 },
          { outcome: 'settled', count: 0 },
          { outcome: 'uncertain', count: 0 },
        ]);
        expect(yield* store.db.all(sql`select key, value from meta`)).toEqual([{ key: 'type-index-pending', value: '1' }]);
      }),
    );

    it.effect('a source store at the cut translates without changing its history and applies the missing tail', () =>
      Effect.gen(function* () {
        const path = yield* place;
        const { migrations, local, receipt } = yield* BaselineFixture;
        sourceStore(path, migrations);
        const db = new Database(path);
        try {
          db.exec('insert into event (ts, op, payload) values (1, \'kept\', \'{"history":"unchanged"}\')');
        } finally {
          db.close();
        }
        const before = yield* rowsOf(path);
        const pending = yield* inDatabase(path, (db) => pendingMigrations(db, local, migrations.folder));
        expect(pending.map(nameHash)).toEqual(local.slice(1).map(nameHash));
        expect(yield* rowsOf(path)).toEqual(before);
        const schema = yield* Effect.scoped(
          Effect.gen(function* () {
            const store = yield* open(path);
            expect(yield* rowsOf(path)).toEqual(local.map(nameHash));
            expect(yield* store.db.all(sql`select ts, op, payload from event`)).toEqual([
              { ts: 1, op: 'kept', payload: '{"history":"unchanged"}' },
            ]);
            return store.schema;
          }),
        );
        expect((yield* open(path)).schema).toEqual(schema);
      }),
    );

    for (const tail of [1, 2])
      it.effect(`translation preserves an applied following prefix of ${tail} migrations and executes only its remainder`, () =>
        Effect.gen(function* () {
          const path = yield* place;
          const { migrations, local, receipt } = yield* BaselineFixture;
          sourceStore(path, migrations, tail);
          const db = new Database(path, { readonly: true });
          let before: { id: number; name: string; hash: string; applied_at: string }[];
          try {
            before = db
              .query<{ id: number; name: string; hash: string; applied_at: string }, []>(
                'select id, name, hash, applied_at from __drizzle_migrations',
              )
              .all()
              .slice(receipt.chain.length);
          } finally {
            db.close();
          }
          const beforeLedger = yield* rowsOf(path);
          expect((yield* inDatabase(path, (db) => pendingMigrations(db, local, migrations.folder))).map(({ name }) => name)).toEqual(
            local.slice(1 + tail).map(({ name }) => name),
          );
          expect(yield* rowsOf(path)).toEqual(beforeLedger);
          const store = yield* open(path);
          const after = yield* store.db.all<{ id: number; name: string; hash: string; applied_at: string }>(
            sql`select id, name, hash, applied_at from __drizzle_migrations order by created_at, id`,
          );
          expect(after.slice(1, 1 + tail)).toEqual(before);
          expect(after.map(({ name }) => name)).toEqual(local.map(({ name }) => name));
        }),
      );

    it.effect('a source ledger below the cut refuses and keeps every standing ledger row', () =>
      Effect.gen(function* () {
        const path = yield* place;
        const { migrations, local, receipt } = yield* BaselineFixture;
        sourceStore(path, migrations);
        const db = new Database(path);
        try {
          db.query('delete from __drizzle_migrations where name = ?').run(receipt.chain.at(-1)!.name);
        } finally {
          db.close();
        }
        const before = yield* rowsOf(path);
        const result = yield* refused(path);
        expect(Exit.isFailure(result) && Cause.squash(result.cause)).toBeInstanceOf(BaselineNotReached);
        expect(Exit.isFailure(result) && (Cause.squash(result.cause) as BaselineNotReached).release).toBe(receipt.release);
        expect(yield* rowsOf(path)).toEqual(before);
      }),
    );

    it.effect('different applied text or a different schema refuses without rewriting the ledger', () =>
      Effect.gen(function* () {
        const path = yield* place;
        const { migrations, local, receipt } = yield* BaselineFixture;
        sourceStore(path, migrations);
        const head = receipt.chain.at(-1)!;
        const db = new Database(path);
        db.query('update __drizzle_migrations set hash = ? where name = ?').run('changed', head.name);
        let before = yield* rowsOf(path);
        let result = yield* refused(path);
        expect(Exit.isFailure(result) && Cause.squash(result.cause)).toBeInstanceOf(MigrationChainInvalid);
        expect(yield* rowsOf(path)).toEqual(before);
        db.query('update __drizzle_migrations set hash = ? where name = ?').run(head.hash, head.name);
        db.exec('create table unaccounted (id integer)');
        db.close();
        before = yield* rowsOf(path);
        result = yield* refused(path);
        expect(Exit.isFailure(result) && Cause.squash(result.cause)).toBeInstanceOf(MigrationChainInvalid);
        expect(yield* rowsOf(path)).toEqual(before);
      }),
    );

    it.effect('a committed translation retires its folded snapshot even when retirement was interrupted, while tail snapshots stand', () =>
      Effect.gen(function* () {
        const path = yield* place;
        const { migrations, local, receipt } = yield* BaselineFixture;
        sourceStore(path, migrations);
        const snapshots = storeSnapshots({}, yield* sharedPool);
        yield* inDatabase(path, (db) =>
          snapshots.take({ path, db }, [{ name: receipt.chain.at(-1)!.name, hash: 'pending', sql: ["update meta set value = '1'"] }]),
        );
        const standing = JSON.parse(readFileSync(`${path}.snapshot.json`, 'utf8')) as { id: string };
        const stopped = yield* Effect.exit(
          Effect.scoped(
            Layer.build(
              storeLayer(
                MachineStore,
                path,
                {
                  ...migrations,
                  snapshots: {
                    ...snapshots,
                    release: () => Effect.fail(new SnapshotFailed({ path, reason: 'retirement interrupted' })),
                  },
                },
                { readers: 0, durable: false },
                yield* sharedPool,
              ),
            ),
          ),
        );
        expect(Exit.isFailure(stopped) && Cause.squash(stopped.cause)).toBeInstanceOf(SnapshotFailed);
        expect(yield* rowsOf(path)).toEqual([{ name: local[0]!.name, hash: local[0]!.hash }]);
        expect(existsSync(join(`${path}.snapshots`, standing.id))).toBe(true);
        yield* Effect.scoped(open(path));
        expect(existsSync(join(`${path}.snapshots`, standing.id))).toBe(false);
        expect(existsSync(`${path}.snapshot.json`)).toBe(local.length > 1);
        if (local.length > 1) {
          const current = JSON.parse(readFileSync(`${path}.snapshot.json`, 'utf8')) as { id: string; pending: { name: string }[] };
          expect(current.pending.map(({ name }) => name)).toEqual(local.slice(1).map(({ name }) => name));
          yield* Effect.scoped(open(path));
          expect(JSON.parse(readFileSync(`${path}.snapshot.json`, 'utf8')).id).toBe(current.id);
        }
      }),
    );

    it.effect('ledger translation is confined to the catalog and ledger even when history exists', () =>
      Effect.gen(function* () {
        const path = yield* place;
        const { migrations, local, receipt } = yield* BaselineFixture;
        sourceStore(path, migrations);
        const source = new Database(path);
        source.exec('insert into event (ts, op, payload) values (1, \'kept\', \'{"history":"unread"}\')');
        source.close();
        const allowed = new Set(['sqlite_master', 'pragma_table_info', 'pragma_table_list', '__drizzle_migrations']);
        const translated = yield* Effect.scoped(
          Effect.gen(function* () {
            const db = yield* makeWithDefaults();
            return yield* translateBaseline(db, local, migrations.folder, () => Effect.void);
          }),
        ).pipe(
          Effect.provide(
            sqliteProcessLayer(
              {
                filename: path,
                readers: 0,
                onLost: (reason) => console.error(reason),
                checkStatement: (statement) =>
                  Effect.sync(() => {
                    for (const match of statement.matchAll(/\b(?:from|join|update|into)\s+["`]?([a-z_]+)\b/gi))
                      if (!allowed.has(match[1]!.toLowerCase())) throw new Error(`Translation crossed the metadata boundary: ${statement}`);
                  }),
              },
              yield* sharedPool,
            ),
          ),
        );
        expect(translated).toBe(true);
        expect(yield* rowsOf(path)).toEqual([{ name: local[0]!.name, hash: local[0]!.hash }]);
      }),
    );
  },
);
