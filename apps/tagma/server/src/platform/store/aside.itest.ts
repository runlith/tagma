import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Deferred, Effect, FileSystem, Layer } from 'effect';
import { MachineStore, type MigrationChain, type Store } from '../contract/service/store.js';
import { ownStorePath, setAsidePath } from '../contract/service/ownStore.js';
import { type StoreOptions, storeLayer } from './open.js';

class CallStore extends Context.Service<CallStore, Store<'calls'>>()('testing/CallStore') {}

type Declared = Readonly<Record<string, { readonly sql: readonly string[]; readonly aside?: readonly string[] }>>;

const BASE = '20260101000000_base';
const SETTLE = '20260101000001_settle';
const REMOVE = '20260101000002_remove';
const AFTER = '20260101000003_after';

const ATTENDEE = 'CREATE TABLE attendee (call_id text NOT NULL REFERENCES call(id), name text NOT NULL, PRIMARY KEY (call_id, name));';

const MACHINE: Declared = {
  [BASE]: {
    sql: [
      'CREATE TABLE call (id text PRIMARY KEY, title text NOT NULL);',
      'CREATE TABLE line (id integer PRIMARY KEY, call_id text NOT NULL REFERENCES call(id), said text);',
      ATTENDEE,
      'CREATE TABLE kept (id text PRIMARY KEY);',
    ],
  },
  [SETTLE]: { sql: ['ALTER TABLE kept ADD COLUMN note text;'] },
  [REMOVE]: { sql: ['DROP TABLE attendee;', 'DROP TABLE line;', 'DROP TABLE call;'], aside: ['attendee', 'call', 'line'] },
  [AFTER]: { sql: ['CREATE TABLE later (id text PRIMARY KEY);'] },
};

const CALLS: Declared = {
  '20260201000000_calls': {
    sql: [
      'CREATE TABLE call (id text PRIMARY KEY, title text NOT NULL, heard integer NOT NULL DEFAULT 0);',
      'CREATE TABLE line (id integer PRIMARY KEY, call_id text NOT NULL REFERENCES call(id));',
      ATTENDEE,
    ],
  },
};

const CALLS_SAID: Declared = { ...CALLS, '20260201000001_said': { sql: ['ALTER TABLE line ADD COLUMN said text;'] } };

const GUARDED: Declared = {
  '20260301000000_guarded': {
    sql: [
      'CREATE TABLE keyless (id text, note text);',
      'CREATE TABLE counted (id integer PRIMARY KEY, note text);',
      'CREATE TABLE emptied (id text PRIMARY KEY, note text);',
      'CREATE TABLE titled (id text PRIMARY KEY, title text UNIQUE);',
    ],
  },
};

const chainOf = Effect.fnUntraced(function* <Brand extends string>(declared: Declared, seeds: string) {
  const files = yield* FileSystem.FileSystem;
  const folder = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-aside-chain-' });
  for (const [name, migration] of Object.entries(declared)) {
    mkdirSync(join(folder, name));
    writeFileSync(join(folder, name, 'migration.sql'), migration.sql.join('\n--> statement-breakpoint\n'));
    if (migration.aside !== undefined) writeFileSync(join(folder, name, 'aside.json'), JSON.stringify({ tables: migration.aside }));
  }
  return { folder, seeds } satisfies MigrationChain<Brand>;
});

const using = <I, Brand extends string, A, E>(
  key: Context.Key<I, Store<Brand>>,
  path: string,
  migrations: MigrationChain<Brand>,
  options: StoreOptions,
  work: (store: Store<Brand>) => Effect.Effect<A, E>,
) =>
  Effect.scoped(
    Effect.flatMap(sharedPool, (pool) =>
      Effect.flatMap(Effect.map(Layer.build(Layer.orDie(storeLayer(key, path, migrations, options, pool))), Context.get(key)), work),
    ),
  );

const SIDES = ['', '-wal', '-shm'] as const;

const keep = (path: string) => {
  for (const side of SIDES) {
    rmSync(`${path}${side}.kept`, { force: true });
    if (existsSync(`${path}${side}`)) copyFileSync(`${path}${side}`, `${path}${side}.kept`);
  }
};

const giveBack = (path: string) => {
  for (const side of SIDES) {
    rmSync(`${path}${side}`, { force: true });
    if (existsSync(`${path}${side}.kept`)) copyFileSync(`${path}${side}.kept`, `${path}${side}`);
  }
};

const setAsideRows = (file: string) => {
  const db = new Database(file, { readonly: true });
  try {
    return {
      attendees: db.query('select call_id, name from attendee order by call_id, name').all(),
      calls: db.query('select id, title from call order by id').all(),
      lines: db.query('select id, call_id, said from line order by id').all(),
    };
  } finally {
    db.close();
  }
};

const planted = (file: string, statements: readonly string[]) => {
  const db = new Database(file);
  try {
    for (const statement of statements) db.run(statement);
  } finally {
    db.close();
  }
};

const tables = <Brand extends string>(store: Store<Brand>) =>
  Effect.map(store.db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' order by name`), (rows) =>
    rows.map((row) => row.name).filter((name) => !name.startsWith('__') && !name.startsWith('sqlite_')),
  );

const held = <Brand extends string>(store: Store<Brand>) =>
  Effect.all({
    attendees: store.db.all(sql`select call_id, name from attendee order by call_id, name`),
    calls: store.db.all(sql`select id, title, heard from call order by id`),
    lines: store.db.all(sql`select id, call_id, said from line order by id`),
  });

const adopting = (files: readonly string[]): StoreOptions => ({ adopting: { files, after: Effect.void } });

layer(BunFileSystem.layer, { excludeTestServices: true })('tables a migration sets aside', (it) => {
  it.effect(
    'a removing migration keeps the rows whole across a rolled-back start and a version skip, and a module store adopts them exactly once',
    () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const data = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-aside-data-' });
        const seeds = join(data, 'seeds');
        const machine = join(data, 'tagma.sqlite');
        const before = yield* chainOf<'machine'>({ [BASE]: MACHINE[BASE]! }, seeds);
        const after = yield* chainOf<'machine'>(MACHINE, seeds);
        const file = setAsidePath(machine, REMOVE);

        yield* using(MachineStore, machine, before, {}, (store) =>
          Effect.gen(function* () {
            yield* store.db.run(sql`insert into call values ('a', 'first'), ('b', 'second')`);
            yield* store.db.run(sql`insert into line values (1, 'a', 'hello'), (2, 'a', 'there'), (3, 'b', null)`);
            yield* store.db.run(sql`insert into attendee values ('a', 'Ada')`);
          }),
        );
        keep(machine);
        yield* using(MachineStore, machine, after, {}, tables);
        expect(setAsideRows(file).calls).toEqual([
          { id: 'a', title: 'first' },
          { id: 'b', title: 'second' },
        ]);

        giveBack(machine);
        yield* using(MachineStore, machine, before, {}, (store) =>
          Effect.gen(function* () {
            yield* store.db.run(sql`insert into call values ('c', 'third')`);
            yield* store.db.run(sql`insert into line values (4, 'c', 'again')`);
            yield* store.db.run(sql`insert into attendee values ('c', 'Cy')`);
          }),
        );
        expect(existsSync(file)).toBe(true);
        expect(yield* using(MachineStore, machine, after, {}, tables)).toEqual(['kept', 'later']);
        expect(readdirSync(dirname(file))).toEqual([`${REMOVE}.sqlite`]);
        const kept = {
          attendees: [
            { call_id: 'a', name: 'Ada' },
            { call_id: 'c', name: 'Cy' },
          ],
          calls: [
            { id: 'a', title: 'first' },
            { id: 'b', title: 'second' },
            { id: 'c', title: 'third' },
          ],
          lines: [
            { id: 1, call_id: 'a', said: 'hello' },
            { id: 2, call_id: 'a', said: 'there' },
            { id: 3, call_id: 'b', said: null },
            { id: 4, call_id: 'c', said: 'again' },
          ],
        };
        expect(setAsideRows(file)).toEqual(kept);

        const own = ownStorePath(machine, 'calls');
        const unsaid = yield* chainOf<'calls'>(CALLS, seeds);
        const said = yield* chainOf<'calls'>(CALLS_SAID, seeds);
        const adopted = (chain: MigrationChain<'calls'>, read: (store: Store<'calls'>) => Effect.Effect<unknown, unknown>) =>
          using(CallStore, own, chain, adopting([file]), (store) => Effect.andThen(store.adopted, read(store)));
        const left = (store: Store<'calls'>) =>
          Effect.all({ attendees: store.db.all(sql`select name from attendee`), calls: store.db.all(sql`select id from call`) });
        expect(yield* adopted(unsaid, left)).toEqual({ attendees: [], calls: [] });
        expect(existsSync(file)).toBe(true);

        const other = setAsidePath(machine, 'nobody-adopts');
        copyFileSync(file, other);
        copyFileSync(file, `${file}.copy`);
        const whole = { ...kept, calls: kept.calls.map((call) => ({ ...call, heard: 0 })) };
        expect(yield* adopted(said, held)).toEqual(whole);
        expect(existsSync(file)).toBe(false);
        copyFileSync(`${file}.copy`, file);
        expect(yield* adopted(said, held)).toEqual(whole);
        expect(existsSync(file)).toBe(false);
        expect(yield* adopted(said, held)).toEqual(whole);
        expect(setAsideRows(other)).toEqual(kept);
      }),
  );

  it.effect('a set-aside whose rows the store cannot take exactly once by its primary keys stays, and adds nothing', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const data = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-aside-guarded-' });
      const chain = yield* chainOf<'calls'>(GUARDED, join(data, 'seeds'));
      const keyless = join(data, 'keyless.sqlite');
      const unkeyed = join(data, 'unkeyed.sqlite');
      const emptied = join(data, 'emptied.sqlite');
      const clashing = join(data, 'clashing.sqlite');
      planted(keyless, ['create table keyless (id text, note text)', "insert into keyless values ('k', 'kept')"]);
      planted(unkeyed, ['create table counted (note text)', "insert into counted values ('counted')"]);
      planted(emptied, ['create table emptied (id text, note text)', "insert into emptied values (null, 'nameless')"]);
      planted(clashing, ['create table titled (id text, title text)', "insert into titled values ('y', 'same')"]);
      const go = yield* Deferred.make<void>();
      const options = { adopting: { files: [keyless, unkeyed, emptied, clashing], after: Deferred.await(go) } };
      const rows = yield* using(CallStore, join(data, 'calls.sqlite'), chain, options, (store) =>
        Effect.gen(function* () {
          yield* store.db.run(sql`insert into titled values ('x', 'same')`);
          yield* Deferred.succeed(go, undefined);
          yield* store.adopted;
          return yield* Effect.all({
            keyless: store.db.all(sql`select id from keyless`),
            counted: store.db.all(sql`select id from counted`),
            emptied: store.db.all(sql`select id from emptied`),
            titled: store.db.all(sql`select id, title from titled`),
          });
        }),
      );
      expect(rows).toEqual({ keyless: [], counted: [], emptied: [], titled: [{ id: 'x', title: 'same' }] });
      expect([keyless, unkeyed, emptied, clashing].map((file) => existsSync(file))).toEqual([true, true, true, true]);
    }),
  );
});
