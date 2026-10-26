import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { Data, Effect, FileSystem } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { CHANNELS } from '../../../installation/contract/wire/channel.js';
import { transferWorld, type WorldParts } from '../../../installation/move/transfer.js';
import { migrationsFolder } from '../../../installation/closure/read.js';
import { RELOCATIONS } from '../../../platform/contract/service/relocation.js';
import { MODULES } from '@tagma/server/composition/modules';
import { lockDataDirectory } from '../../../platform/lock/dataDirectory.js';
import { fixtureHome } from '../../../platform/testing/roots.js';

const parts: WorldParts = { relocations: RELOCATIONS.collect(MODULES), entities: async () => ['place'] };
class TransferDatabaseRefused extends Data.TaggedError('TransferDatabaseRefused')<{ readonly path: string; readonly cause: unknown }> {
  override readonly message = `${this.path}: ${String(this.cause)}`;
}
const database = Effect.fn('transferFixture.database')(<A>(path: string, use: (database: Database) => A) =>
  Effect.acquireUseRelease(
    Effect.try({ try: () => new Database(path), catch: (cause) => new TransferDatabaseRefused({ path, cause }) }),
    (db) => Effect.try({ try: () => use(db), catch: (cause) => new TransferDatabaseRefused({ path, cause }) }),
    (db) => Effect.sync(() => db.close()),
  ),
);
const newHome = Effect.fn('transferFixture.home')(function* () {
  const files = yield* FileSystem.FileSystem;
  return yield* files.realPath(yield* files.makeTempDirectoryScoped({ directory: fixtureHome(), prefix: 'tagma-world-transfer-' }));
});
const transfer = (home: string) => Effect.result(transferWorld(CHANNELS.dev, CHANNELS.stable, { HOME: home }, parts, migrationsFolder));

layer(BunFileSystem.layer, { excludeTestServices: true })('a channel’s empty world is filled from another channel’s', (it) => {
  it.effect('the database, rollouts and graphs are copied and name the new world; the source stays as it was', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const home = yield* newHome();
      const dev = join(home, CHANNELS.dev.data);
      yield* files.makeDirectory(join(dev, 'threads', '5'), { recursive: true });
      yield* files.writeFileString(join(dev, 'threads', '5', 't.jsonl'), '{}\n');
      yield* database(join(dev, 'tagma.sqlite'), (db) => {
        db.run('CREATE TABLE place (id INTEGER PRIMARY KEY, path TEXT)');
        db.run('INSERT INTO place (path) VALUES (?)', [join(dev, 'threads')]);
      });
      const done = yield* transfer(home);
      expect(done._tag).toBe('Success');
      const stable = join(home, CHANNELS.stable.data);
      expect(yield* files.readFileString(join(stable, 'threads', '5', 't.jsonl'))).toBe('{}\n');
      expect(yield* database(join(stable, 'tagma.sqlite'), (db) => db.query('SELECT path FROM place').get())).toEqual({
        path: join(stable, 'threads'),
      });
      expect(yield* database(join(dev, 'tagma.sqlite'), (db) => db.query('SELECT path FROM place').get())).toEqual({
        path: join(dev, 'threads'),
      });
      expect(yield* transfer(home)).toMatchObject({ failure: { code: 'world-not-empty' } });
    }),
  );

  it.effect('a running source refuses before anything is copied', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const home = yield* newHome();
      const dev = join(home, CHANNELS.dev.data);
      yield* files.makeDirectory(dev, { recursive: true });
      yield* database(join(dev, 'tagma.sqlite'), () => undefined);
      yield* Effect.acquireRelease(lockDataDirectory(dev), (lock) => lock.release);
      expect(yield* transfer(home)).toMatchObject({ failure: { code: 'source-held' } });
      expect(yield* files.exists(join(home, CHANNELS.stable.data, 'tagma.sqlite'))).toBe(false);
    }),
  );

  it.effect('a source this build cannot read refuses before anything is copied', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const home = yield* newHome();
      const dev = join(home, CHANNELS.dev.data);
      yield* files.makeDirectory(dev, { recursive: true });
      yield* database(join(dev, 'tagma.sqlite'), (db) => {
        db.run('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at INTEGER, name TEXT)');
        db.run("INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES ('h', 1, '99999999999999_from_the_future')");
      });
      expect(yield* transfer(home)).toMatchObject({ failure: { code: 'source-newer' } });
      expect(yield* files.exists(join(home, CHANNELS.stable.data, 'tagma.sqlite'))).toBe(false);
    }),
  );
});
