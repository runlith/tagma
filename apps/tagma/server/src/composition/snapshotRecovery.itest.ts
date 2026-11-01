import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Effect, FileSystem } from 'effect';
import { rolloutParticipant } from '../threads/testing/doubles.js';
import { SnapshotFailed } from '../platform/contract/service/snapshots.js';
import { storeSnapshots } from '../platform/store/snapshot.js';
import { inDatabase } from '../platform/testing/connection.js';

layer(BunFileSystem.layer, { excludeTestServices: true })('snapshot recovery', (it) => {
  it.effect('publication failure resumes its intent and preserves distinct retry-time rollout bytes', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-recovery-' }));
      const path = join(root, 'store.sqlite');
      const home = join(root, 'threads');
      const rollout = join(home, '1', 'a.jsonl');
      const before = '{"before":true}\n';
      const after = '{"afterSnapshot":true}\n';
      const later = '{"afterFailure":true}\n';
      const pending = [
        {
          name: 'next',
          hash: 'next',
          sql: [
            "insert into thread_event (thread_id, position, id, kind, payload) values ('1', 1, 'evt-1', 'message', '{}')",
            "update fact set value = 'after'",
          ],
        },
      ];
      let fail = true;
      const snapshots = storeSnapshots(
        {
          threads: rolloutParticipant(path, home),
          fault: {
            tables: ['fact'],
            restore: (store) =>
              Effect.sync(() =>
                store.registerPublication(() =>
                  fail ? Effect.fail(new SnapshotFailed({ path, reason: 'injected publication failure' })) : Effect.void,
                ),
              ),
          },
        },
        yield* sharedPool,
      );
      yield* FileSystem.FileSystem.use((files) => files.makeDirectory(join(home, '1'), { recursive: true }));
      yield* FileSystem.FileSystem.use((files) => files.writeFileString(rollout, before));
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table fact(value text)`);
          yield* db.run(sql`insert into fact values ('before')`);
          yield* db.run(sql`create table thread_event(thread_id text, position integer, id text, kind text, payload text)`);
          yield* db.run(sql`create table thread_rollout_home(path text primary key, imported_at integer not null)`);
          yield* db.run(sql`insert into thread_rollout_home values (${home}, 1)`);
          yield* snapshots.take({ path, db }, pending);
          yield* db.run(sql`insert into thread_event values ('1', 1, 'evt-1', 'message', '{}')`);
          yield* db.run(sql`update fact set value='after'`);
        }),
      );
      yield* FileSystem.FileSystem.use((files) => files.writeFileString(rollout, after));
      yield* FileSystem.FileSystem.use((files) => files.writeFileString(join(home, '1', 'born.jsonl'), '{"born":true}\n'));
      expect((yield* Effect.result(snapshots.restore(path)))._tag).toBe('Failure');
      const intent = JSON.parse(yield* FileSystem.FileSystem.use((files) => files.readFileString(`${path}.restore.json`))) as {
        restoration: string;
        id: string;
      };
      expect((yield* Effect.result(snapshots.release(path)))._tag).toBe('Failure');
      const live = new Database(path, { readonly: true });
      try {
        expect(live.query('select value from fact').get()).toEqual({ value: 'after' });
        expect(live.query('select path from thread_rollout_home').all()).toEqual([{ path: home }]);
      } finally {
        live.close();
      }
      yield* FileSystem.FileSystem.use((files) => files.writeFileString(rollout, later));
      fail = false;
      const answer = yield* snapshots.restore(path);
      const restored = new Database(path, { readonly: true });
      try {
        expect(restored.query('select value from fact').get()).toEqual({ value: 'before' });
        expect(restored.query('select path from thread_rollout_home').all()).toEqual([]);
      } finally {
        restored.close();
      }
      expect(answer.quarantine.endsWith(intent.restoration)).toBe(true);
      expect(answer.losses.some((loss) => loss.owner === 'threads' && loss.key === '1/born')).toBe(true);
      expect(yield* FileSystem.FileSystem.use((files) => files.readFileString(rollout))).toBe(before);
      const kept = join(answer.quarantine, 'rollouts', '1');
      expect(yield* FileSystem.FileSystem.use((files) => files.readFileString(join(kept, 'a.jsonl')))).toBe(after);
      const copies = (yield* FileSystem.FileSystem.use((files) => files.readDirectory(kept))).filter((name) => name.startsWith('a.jsonl.'));
      expect(copies).toHaveLength(1);
      expect(yield* FileSystem.FileSystem.use((files) => files.readFileString(join(kept, copies[0]!)))).toBe(later);
      expect(answer.losses.some((loss) => loss.key === '1/a' && loss.reason.includes(copies[0]!))).toBe(true);
      expect(yield* snapshots.release(path)).toEqual([intent.id]);
      expect(yield* snapshots.standing(path)).toBe(false);
      expect(yield* FileSystem.FileSystem.use((files) => files.readFileString(join(kept, 'a.jsonl')))).toBe(after);
    }),
  );

  it.effect('an identical pending source reuses its cut while changed selected data recaptures', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-reuse-' }));
      const path = join(root, 'store.sqlite');
      const snapshots = storeSnapshots({}, yield* sharedPool);
      const pending = [{ name: 'one', hash: 'one', sql: ["update fact set value = 'migrated'"] }];
      const identity = Effect.fnUntraced(function* () {
        return (JSON.parse(yield* FileSystem.FileSystem.use((files) => files.readFileString(`${path}.snapshot.json`))) as { id: string })
          .id;
      });
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table fact(id text primary key, value text)`);
          yield* db.run(sql`insert into fact values ('kept', 'before')`);
          yield* db.run(sql`create table other(id text primary key, value text)`);
          yield* db.run(sql`insert into other values ('seed', 'seed')`);
          yield* snapshots.take({ path, db }, pending);
        }),
      );
      const initial = yield* identity();
      yield* inDatabase(path, (db) => snapshots.take({ path, db }, pending));
      expect(yield* identity()).toBe(initial);
      yield* inDatabase(path, (db) => db.run(sql`update fact set value = 'changed'`));
      yield* inDatabase(path, (db) => snapshots.take({ path, db }, pending));
      const recaptured = yield* identity();
      expect(recaptured).not.toBe(initial);
      yield* snapshots.restore(path);
      const restored = new Database(path, { readonly: true });
      try {
        expect(restored.query('select value from fact').get()).toEqual({ value: 'changed' });
      } finally {
        restored.close();
      }
      yield* inDatabase(path, (db) => db.run(sql`insert into other values ('new', 'new')`));
      yield* inDatabase(path, (db) => snapshots.take({ path, db }, pending));
      expect(yield* identity()).toBe(recaptured);
    }),
  );
});
