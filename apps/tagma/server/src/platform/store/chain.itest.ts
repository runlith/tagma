import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { cpSync, existsSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Cause, Context, Effect, Exit, FileSystem, Layer } from 'effect';
import { MachineStore, type MigrationChain, MigrationStatementUnresolved } from '../contract/service/store.js';
import { inDatabase, storePlace } from '../testing/connection.js';
import { storeLayer } from './open.js';
import { chain } from './chain.js';

const ownRoot = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  return yield* files.makeTempDirectoryScoped({ prefix: 'tagma-chain-' });
});

const BASE = '20260101000000_base';
const MOVE = '20260101000001_move';

const ownChain = Effect.fnUntraced(function* (statements: readonly string[]) {
  const folder = yield* ownRoot;
  const write = (name: string, body: readonly string[]) => {
    mkdirSync(join(folder, name));
    writeFileSync(join(folder, name, 'migration.sql'), body.join('\n--> statement-breakpoint\n'));
  };
  write(BASE, [
    'CREATE TABLE owner (id text PRIMARY KEY, note text);',
    'CREATE TABLE moved (id text PRIMARY KEY, owner_id text REFERENCES owner(id));',
    'CREATE TABLE pending (id text PRIMARY KEY, owner_id text);',
    'CREATE TABLE unrelated (id text PRIMARY KEY, owner_id text REFERENCES owner(id));',
    'CREATE TRIGGER copied AFTER UPDATE OF note ON owner BEGIN UPDATE pending SET owner_id = new.id; END;',
  ]);
  write(MOVE, statements);
  return { folder, seeds: join(folder, 'seeds') } satisfies MigrationChain<'machine'>;
});

const open = (path: string, mine: MigrationChain<'machine'>) =>
  Effect.flatMap(sharedPool, (pool) =>
    Effect.map(Layer.build(Layer.orDie(storeLayer(MachineStore, path, mine, { readers: 0 }, pool))), Context.get(MachineStore)),
  );

const refused = (path: string, mine: MigrationChain<'machine'>) =>
  Effect.flatMap(sharedPool, (pool) => Effect.exit(Effect.scoped(Layer.build(storeLayer(MachineStore, path, mine, { readers: 0 }, pool)))));

const planted = Effect.fnUntraced(function* (mine: MigrationChain<'machine'>, pending = false) {
  const path = yield* storePlace('tagma-chain-');
  const folder = yield* ownRoot;
  cpSync(join(mine.folder, BASE), join(folder, BASE), { recursive: true });
  yield* Effect.scoped(
    Effect.gen(function* () {
      const store = yield* open(path, { ...mine, folder });
      yield* store.db.run(sql`pragma foreign_keys = off`);
      yield* store.db.run(sql`insert into unrelated values ('ghost', 'nobody')`);
      if (pending) yield* store.db.run(sql`insert into pending values ('seen', 'nobody')`);
    }),
  );
  return path;
});

layer(BunFileSystem.layer, { excludeTestServices: true })('migration chain', (it) => {
  it.effect('switching current to another installation reads that installation migration text', () =>
    Effect.gen(function* () {
      const root = yield* ownRoot;
      for (const release of ['first', 'second']) {
        const folder = join(root, release, 'drizzle', BASE);
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'migration.sql'), `SELECT '${release}';`);
      }
      const current = join(root, 'current');
      symlinkSync(join(root, 'first'), current, 'dir');
      const first = chain({ folder: join(current, 'drizzle') });
      symlinkSync(join(root, 'second'), join(root, 'next'), 'dir');
      renameSync(join(root, 'next'), current);
      const second = chain({ folder: join(current, 'drizzle') });
      expect(first[0]?.sql).toEqual(["SELECT 'first';"]);
      expect(second[0]?.sql).toEqual(["SELECT 'second';"]);
      expect(second[0]?.hash).not.toBe(first[0]?.hash);
    }),
  );

  it.effect('a parallel migration sorted before an applied migration opens without replaying standing work', () =>
    Effect.gen(function* () {
      const mine = yield* ownChain(["INSERT INTO owner VALUES ('kept', 'applied');"]);
      const path = yield* storePlace('tagma-chain-');
      yield* Effect.scoped(open(path, mine));
      const folder = yield* ownRoot;
      for (const name of [BASE, MOVE]) cpSync(join(mine.folder, name), join(folder, name), { recursive: true });
      const inserted = '20260101000001_branch';
      mkdirSync(join(folder, inserted));
      writeFileSync(join(folder, inserted, 'migration.sql'), 'CREATE TABLE branch (id text PRIMARY KEY);');
      const merged = { ...mine, folder };
      const state = yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* open(path, merged);
          return {
            rows: yield* store.db.all(sql`select * from owner`),
            branch: yield* store.db.all(sql`select name from sqlite_master where name = 'branch'`),
            applied: yield* store.db.all(sql`select name from __drizzle_migrations order by created_at, id`),
          };
        }),
      );
      expect(state).toEqual({
        rows: [{ id: 'kept', note: 'applied' }],
        branch: [{ name: 'branch' }],
        applied: [{ name: BASE }, { name: MOVE }, { name: inserted }],
      });
      expect((yield* open(path, merged)).schema).toEqual({ applied: 3, latest: MOVE });
    }),
  );

  it.effect('opening a schema-only migration leaves an unrelated dangling row alone', () =>
    Effect.gen(function* () {
      const mine = yield* ownChain(['CREATE TABLE added (id text PRIMARY KEY);']);
      const path = yield* planted(mine);
      const store = yield* open(path, mine);
      const added = yield* store.db.all(sql`select name from sqlite_master where name = 'added'`);
      const ghosts = yield* store.db.all(sql`select id from unrelated`);
      expect({ added, ghosts, latest: store.schema.latest }).toEqual({
        added: [{ name: 'added' }],
        ghosts: [{ id: 'ghost' }],
        latest: MOVE,
      });
    }),
  );

  it.effect('a payload update of a parent with a trigger and children opens over unrelated dangling rows', () =>
    Effect.gen(function* () {
      const mine = yield* ownChain(["UPDATE owner SET note = 'after';"]);
      const path = yield* planted(mine);
      yield* inDatabase(path, (db) => db.run(sql`insert into owner values ('owner', 'before')`));
      const store = yield* open(path, mine);
      expect({ rows: yield* store.db.all(sql`select note from owner`), schema: store.schema.latest }).toEqual({
        rows: [{ note: 'after' }],
        schema: MOVE,
      });
    }),
  );

  it.effect('opening a row-moving migration rejects the references it broke and can retry without recording it', () =>
    Effect.gen(function* () {
      const mine = yield* ownChain(['INSERT INTO moved SELECT * FROM pending;', 'DELETE FROM pending;']);
      const path = yield* planted(mine, true);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const exit = yield* refused(path, mine);
        expect(Exit.isFailure(exit) && String(exit.cause).includes('dangling')).toBe(true);
      }
      expect(yield* inDatabase(path, (db) => db.all(sql`select id from pending`))).toEqual([{ id: 'seen' }]);
    }),
  );

  it.effect('a dropped table is not checked after it leaves the schema', () =>
    Effect.gen(function* () {
      const mine = yield* ownChain(['DROP TABLE pending;']);
      const path = yield* planted(mine);
      const store = yield* open(path, mine);
      expect({
        tables: yield* store.db.all(sql`select name from sqlite_master where name = 'pending'`),
        latest: store.schema.latest,
      }).toEqual({ tables: [], latest: MOVE });
    }),
  );

  it.effect('an unresolved pending statement refuses opening with its typed migration and statement, before snapshotting', () =>
    Effect.gen(function* () {
      const statement = 'CREATE TABLE copy AS SELECT * FROM owner;';
      const mine = yield* ownChain([statement]);
      const path = yield* planted(mine);
      const exit = yield* refused(path, mine);
      const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
      expect(failure).toBeInstanceOf(MigrationStatementUnresolved);
      expect(failure).toMatchObject({ migration: MOVE, statement });
      expect(existsSync(`${path}.snapshot.json`)).toBe(false);
      expect(yield* inDatabase(path, (db) => db.all(sql`select name from __drizzle_migrations`))).toEqual([{ name: BASE }]);
    }),
  );
});
