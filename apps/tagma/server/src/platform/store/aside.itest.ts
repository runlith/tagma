import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Effect, Exit, FileSystem, Layer } from 'effect';
import { MachineStore, type MigrationChain, type Store } from '../contract/service/store.js';
import { ownStorePath, setAsidePath } from '../contract/service/ownStore.js';
import { storeLayer } from './open.js';

class CallStore extends Context.Service<CallStore, Store<'calls'>>()('testing/CallStore') {}

type Declared = Readonly<Record<string, { readonly sql: readonly string[]; readonly aside?: readonly string[] }>>;

const BASE = '20260101000000_base';
const SETTLE = '20260101000001_settle';
const REMOVE = '20260101000002_remove';
const AFTER = '20260101000003_after';

const MACHINE: Declared = {
  [BASE]: {
    sql: [
      'CREATE TABLE call (id text PRIMARY KEY, title text NOT NULL);',
      'CREATE TABLE line (id integer PRIMARY KEY, call_id text NOT NULL REFERENCES call(id), said text);',
      'CREATE TABLE kept (id text PRIMARY KEY);',
    ],
  },
  [SETTLE]: { sql: ['ALTER TABLE kept ADD COLUMN note text;'] },
  [REMOVE]: { sql: ['DROP TABLE line;', 'DROP TABLE call;'], aside: ['call', 'line'] },
  [AFTER]: { sql: ['CREATE TABLE later (id text PRIMARY KEY);'] },
};

const CALLS: Declared = {
  '20260201000000_calls': {
    sql: [
      'CREATE TABLE call (id text PRIMARY KEY, title text NOT NULL, heard integer NOT NULL DEFAULT 0);',
      'CREATE TABLE line (id integer PRIMARY KEY, call_id text NOT NULL);',
    ],
  },
};

const CALLS_SAID: Declared = { ...CALLS, '20260201000001_said': { sql: ['ALTER TABLE line ADD COLUMN said text;'] } };

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
  work: (store: Store<Brand>) => Effect.Effect<A, E>,
) =>
  Effect.scoped(
    Effect.flatMap(sharedPool, (pool) =>
      Effect.flatMap(Effect.map(Layer.build(Layer.orDie(storeLayer(key, path, migrations, {}, pool))), Context.get(key)), work),
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
      calls: db.query('select id, title from call order by id').all(),
      lines: db.query('select id, call_id, said from line order by id').all(),
    };
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
    calls: store.db.all(sql`select id, title, heard from call order by id`),
    lines: store.db.all(sql`select id, call_id, said from line order by id`),
  });

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

        yield* using(MachineStore, machine, before, (store) =>
          Effect.gen(function* () {
            yield* store.db.run(sql`insert into call values ('a', 'first'), ('b', 'second')`);
            yield* store.db.run(sql`insert into line values (1, 'a', 'hello'), (2, 'a', 'there'), (3, 'b', null)`);
          }),
        );
        keep(machine);
        yield* using(MachineStore, machine, after, tables);
        expect(setAsideRows(file).calls).toEqual([
          { id: 'a', title: 'first' },
          { id: 'b', title: 'second' },
        ]);

        giveBack(machine);
        yield* using(MachineStore, machine, before, (store) =>
          Effect.gen(function* () {
            yield* store.db.run(sql`insert into call values ('c', 'third')`);
            yield* store.db.run(sql`insert into line values (4, 'c', 'again')`);
          }),
        );
        expect(existsSync(file)).toBe(true);
        expect(yield* using(MachineStore, machine, after, tables)).toEqual(['kept', 'later']);
        expect(readdirSync(dirname(file))).toEqual([`${REMOVE}.sqlite`]);
        const kept = {
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
        const refused = yield* using(CallStore, own, unsaid, (store) =>
          Effect.flatMap(Effect.exit(store.adopt(file)), (exit) =>
            Effect.map(store.db.all(sql`select id from call`), (calls) => ({ exit, calls })),
          ),
        );
        expect(Exit.isFailure(refused.exit)).toBe(true);
        expect(refused.calls).toEqual([]);
        expect(existsSync(file)).toBe(true);

        const other = setAsidePath(machine, 'nobody-adopts');
        copyFileSync(file, other);
        copyFileSync(file, `${file}.copy`);
        const adopted = yield* using(CallStore, own, said, (store) =>
          Effect.gen(function* () {
            const first = yield* store.adopt(file);
            const gone = !existsSync(file);
            copyFileSync(`${file}.copy`, file);
            const again = yield* store.adopt(file);
            return { first, gone, again, last: yield* store.adopt(file), rows: yield* held(store) };
          }),
        );
        expect(adopted.first).toEqual({ outcome: 'adopted', rows: 7 });
        expect(adopted.gone).toBe(true);
        expect(adopted.again).toEqual({ outcome: 'adopted', rows: 0 });
        expect(adopted.last).toEqual({ outcome: 'absent' });
        expect(adopted.rows).toEqual({ calls: kept.calls.map((call) => ({ ...call, heard: 0 })), lines: kept.lines });
        expect(existsSync(file)).toBe(false);
        expect(setAsideRows(other)).toEqual(kept);
      }),
  );
});
