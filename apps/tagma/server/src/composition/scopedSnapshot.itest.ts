import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Effect, FileSystem, Layer } from 'effect';
import { MachineStore } from '../platform/contract/service/store.js';
import { storeLayer } from '../platform/store/open.js';
import { inDatabase } from '../platform/testing/connection.js';
import { fixtureMigrations } from './testing/migrations.js';
import { storeSnapshots } from '../platform/store/snapshot.js';
import { SnapshotFailed } from '../platform/contract/service/snapshots.js';
import { rolloutParticipant } from '../threads/testing/doubles.js';

layer(BunFileSystem.layer, { excludeTestServices: true })('snapshot lifecycle', (it) => {
  it.effect('a schema-only migration after the baseline snapshots the ledger without thread history', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-baseline-' }));
      const path = join(root, 'store.sqlite');
      const snapshots = storeSnapshots({ threads: rolloutParticipant(path, join(root, 'rollouts')) });
      const migration = 'alter table thread add column baseline_note text';
      yield* Effect.scoped(Effect.provide(Effect.void, Layer.orDie(storeLayer(MachineStore, path, fixtureMigrations))));
      yield* inDatabase(path, (db) => snapshots.take({ path, db }, [{ name: 'next', hash: 'next', sql: [migration] }]));
      const manifest = JSON.parse(yield* FileSystem.FileSystem.use((files) => files.readFileString(`${path}.snapshot.json`))) as {
        tables: Array<{ name: string; data: boolean }>;
        participants: Record<string, unknown>;
      };
      expect(
        manifest.tables
          .filter((table) => table.data)
          .map((table) => table.name)
          .sort(),
      ).toEqual(['__drizzle_migrations']);
      expect(manifest.participants).toEqual({});
    }),
  );

  it.effect('a failed private-copy scrub removes the unpublished cut and keeps the standing cut', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-cleanup-' }));
      const path = join(root, 'store.sqlite');
      let shouldFail = false;
      const snapshots = storeSnapshots({
        fault: {
          tables: ['fact'],
          scrub: () => (shouldFail ? Effect.fail(new SnapshotFailed({ path, reason: 'injected scrub failure' })) : Effect.void),
        },
      });
      const pending = [{ name: 'next', hash: 'next', sql: ['update fact set value = 2'] }];
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table fact (value integer)`);
          yield* db.run(sql`insert into fact values (1)`);
          yield* snapshots.take({ path, db }, pending);
        }),
      );
      const before = yield* FileSystem.FileSystem.use((files) => files.readFileString(`${path}.snapshot.json`));
      shouldFail = true;
      const result = yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`update fact set value = 3`);
          return yield* Effect.result(snapshots.take({ path, db }, pending));
        }),
      );
      expect(result._tag).toBe('Failure');
      expect(yield* FileSystem.FileSystem.use((files) => files.readFileString(`${path}.snapshot.json`))).toBe(before);
      expect(yield* FileSystem.FileSystem.use((files) => files.readDirectory(`${path}.snapshots`))).toEqual([
        (JSON.parse(before) as { id: string }).id,
      ]);
    }),
  );

  it.effect('a participant receives only full-data selected tables', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-participant-' }));
      const path = join(root, 'store.sqlite');
      const seen: Array<readonly string[]> = [];
      const snapshots = storeSnapshots({
        scoped: {
          tables: ['fact', 'other'],
          prepare: (store) =>
            Effect.sync((): void => {
              seen.push([...store.tables]);
            }),
        },
      });
      const pending = [
        {
          name: 'migrate-participant',
          hash: 'participant',
          sql: ["update fact set value = 'migrated'", 'alter table other add column extra text'],
        },
      ];
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table fact (id text primary key, value text)`);
          yield* db.run(sql`insert into fact values ('kept', 'before')`);
          yield* db.run(sql`create table other (id text primary key, value text)`);
          yield* db.run(sql`insert into other values ('kept', 'keep')`);
          yield* snapshots.take({ path, db }, pending);
        }),
      );
      expect(seen).toEqual([['fact']]);
    }),
  );

  it.effect('a newer untouched child blocks restore without committing or publishing', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-foreign-key-' }));
      const path = join(root, 'store.sqlite');
      const snapshots = storeSnapshots({});
      const pending = [{ name: 'migrate-parent', hash: 'parent', sql: ["update parent set value = 'migrated' where id = 'kept'"] }];
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table parent (id text primary key, value text)`);
          yield* db.run(sql`insert into parent values ('kept', 'before')`);
          yield* db.run(sql`create table child (id text primary key, parent_id text references parent (id))`);
          yield* snapshots.take({ path, db }, pending);
          yield* db.run(sql`insert into parent values ('new', 'new')`);
          yield* db.run(sql`insert into child values ('c', 'new')`);
        }),
      );
      expect((yield* Effect.result(snapshots.restore(path)))._tag).toBe('Failure');
      expect(yield* FileSystem.FileSystem.use((files) => files.readDirectory(root))).not.toContain('store.sqlite.restore.json');
      expect(yield* FileSystem.FileSystem.use((files) => files.readDirectory(root))).not.toContain('store.sqlite.snapshot-quarantine');
      expect(yield* snapshots.standing(path)).toBe(true);
      const after = yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          const parents = yield* db.all<{ id: string; value: string }>(sql`select id, value from parent order by id`);
          const children = yield* db.all<{ id: string; parent_id: string }>(sql`select id, parent_id from child`);
          return { parents, children };
        }),
      );
      expect(after.parents).toEqual([
        { id: 'kept', value: 'before' },
        { id: 'new', value: 'new' },
      ]);
      expect(after.children).toEqual([{ id: 'c', parent_id: 'new' }]);
    }),
  );

  it.effect('a capture-boot snapshot survives its own opened and ready and falls after a later boot', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-retention-' }));
      const path = join(root, 'store.sqlite');
      const snapshots = storeSnapshots({});
      const pending = [{ name: 'm1', hash: 'h1', sql: ["update fact set value = 'migrated'"] }];
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table fact (id text primary key, value text)`);
          yield* db.run(sql`insert into fact values ('kept', 'before')`);
          yield* db.run(sql`create table __drizzle_migrations (name text, hash text)`);
          yield* snapshots.take({ path, db }, pending);
          yield* db.run(sql`update fact set value = 'migrated'`);
          yield* db.run(sql`insert into __drizzle_migrations values ('m1', 'h1')`);
          yield* snapshots.opened({ path, db });
        }),
      );
      yield* snapshots.ready;
      expect(yield* snapshots.standing(path)).toBe(true);
      const server = join(import.meta.dir, '..', '..');
      const storeModule = join(import.meta.dir, '..', 'platform', 'store', 'snapshot.ts');
      const connectionModule = join(import.meta.dir, '..', 'platform', 'testing', 'connection.ts');
      const code = [
        "import { Effect } from 'effect';",
        `import { storeSnapshots } from ${JSON.stringify(storeModule)};`,
        `import { inDatabase } from ${JSON.stringify(connectionModule)};`,
        'const path = process.env.RETAIN_PATH as string;',
        'const snapshots = storeSnapshots({});',
        'await Effect.runPromise(inDatabase(path, (db) => Effect.gen(function* () {',
        '  yield* snapshots.opened({ path, db });',
        '  yield* snapshots.ready;',
        '})));',
      ].join('\n');
      const child = Bun.spawn([process.execPath, '-e', code], {
        cwd: server,
        env: { ...process.env, RETAIN_PATH: path },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const exit = yield* Effect.promise(() => child.exited);
      expect(exit, yield* Effect.promise(() => new Response(child.stderr).text())).toBe(0);
      expect(yield* snapshots.standing(path)).toBe(false);
    }),
  );

  it.effect('concurrent opens of one store after a later boot retire its snapshot once without failing', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-concurrent-retire-' }));
      const path = join(root, 'store.sqlite');
      const snapshots = storeSnapshots({});
      const pending = [{ name: 'm1', hash: 'h1', sql: ["update fact set value = 'migrated'"] }];
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table fact (id text primary key, value text)`);
          yield* db.run(sql`insert into fact values ('kept', 'before')`);
          yield* db.run(sql`create table __drizzle_migrations (name text, hash text)`);
          yield* snapshots.take({ path, db }, pending);
          yield* db.run(sql`insert into __drizzle_migrations values ('m1', 'h1')`);
        }),
      );
      const manifest = JSON.parse(yield* FileSystem.FileSystem.use((files) => files.readFileString(`${path}.snapshot.json`))) as Record<
        string,
        unknown
      >;
      yield* FileSystem.FileSystem.use((files) =>
        files.writeFileString(`${path}.snapshot.json`, JSON.stringify({ ...manifest, completed: randomUUID() })),
      );
      yield* snapshots.ready;
      yield* inDatabase(path, (db) =>
        Effect.all(
          [1, 2, 3, 4].map(() => snapshots.opened({ path, db })),
          { concurrency: 2 },
        ),
      );
      expect(yield* snapshots.standing(path)).toBe(false);
    }),
  );
});
