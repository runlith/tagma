import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Context, Deferred, Effect, FileSystem, Layer } from 'effect';
import { Maintenance } from '../../platform/contract/service/maintenance.js';
import type { Manifest } from '../../platform/contract/service/manifest.js';
import { adoptedPath, setAsidePath } from '../../platform/contract/service/ownStore.js';
import { MachineStore, type Store } from '../../platform/contract/service/store.js';
import { storeLayer } from '../../platform/store/open.js';
import { installedIn } from '../extensions.js';

class CallStore extends Context.Service<CallStore, Store<'calls'>>()('testing/CallStore') {}

const REMOVED = '20260101000002_remove';

const folderWith = Effect.fnUntraced(function* (name: string, statement: string) {
  const files = yield* FileSystem.FileSystem;
  const folder = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-set-aside-chain-' });
  mkdirSync(join(folder, name));
  writeFileSync(join(folder, name, 'migration.sql'), statement);
  return folder;
});

const planted = (file: string, ids: readonly string[]) => {
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  try {
    db.run('create table call (id text, title text)');
    for (const id of ids) db.run('insert into call values (?, ?)', [id, `call ${id}`]);
  } finally {
    db.close();
  }
};

layer(BunFileSystem.layer, { excludeTestServices: true })('a module store adopting a set-aside', (it) => {
  it.effect('adopts only once the door opened, and leaves the set-aside nobody adopts where it is', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const data = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-set-aside-data-' });
      const seeds = join(data, 'seeds');
      const pool = yield* sharedPool;
      const machineChain = yield* folderWith('20260101000000_base', 'CREATE TABLE kept (id text PRIMARY KEY);');
      const machine = Context.get(
        yield* Layer.build(Layer.orDie(storeLayer(MachineStore, join(data, 'tagma.sqlite'), { folder: machineChain, seeds }, {}, pool))),
        MachineStore,
      );
      const adopted = setAsidePath(machine.path, REMOVED);
      const unadopted = setAsidePath(machine.path, '20260101000003_elsewhere');
      planted(adopted, ['a', 'b']);
      planted(unadopted, ['z']);

      const calls: Manifest = {
        id: 'calls',
        stores: [
          {
            id: 'calls',
            key: CallStore,
            migrations: yield* folderWith('20260201000000_calls', 'CREATE TABLE call (id text PRIMARY KEY, title text NOT NULL);'),
            adopts: [REMOVED],
          },
        ],
      };
      const door = yield* Deferred.make<void>();
      const over = Context.make(MachineStore, machine).pipe(
        Context.add(Maintenance, { opened: Deferred.await(door), isOpen: Deferred.isDone(door) }),
      );
      const store = Context.getUnsafe(yield* installedIn([calls], over, seeds, yield* Effect.scope), CallStore);
      const held = store.db.all(sql`select id, title from call order by id`);

      expect(yield* held).toEqual([]);
      expect(existsSync(adopted)).toBe(true);

      yield* Deferred.succeed(door, undefined);
      yield* store.adopted;
      expect([existsSync(adopted), existsSync(adoptedPath(adopted, 'calls'))]).toEqual([false, true]);
      expect(yield* held).toEqual([
        { id: 'a', title: 'call a' },
        { id: 'b', title: 'call b' },
      ]);
      expect(existsSync(unadopted)).toBe(true);
    }),
  );
});
