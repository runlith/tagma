import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Effect, FileSystem } from 'effect';
import { inDatabase } from '../platform/testing/connection.js';
import { storeSnapshots } from '../platform/store/snapshot.js';
import { consoleAccountOf } from '../providers/credentials/consoleKeys.js';
import { credentialParticipant } from '../providers/credentials/snapshot.js';

type Manifest = {
  id: string;
  participants: { providers: { evacuated: Array<{ provider: string; stored: string; account: string }> } };
};

const manifestOf = Effect.fnUntraced(function* (path: string) {
  return JSON.parse(yield* FileSystem.FileSystem.use((files) => files.readFileString(`${path}.snapshot.json`))) as Manifest;
});

const scrubbedCopy = (path: string, id: string): Array<{ k: string }> => {
  const db = new Database(join(`${path}.snapshots`, id, 'store.sqlite'), { readonly: true });
  try {
    return db.query('select distinct key_value as k from console_key').all() as Array<{ k: string }>;
  } finally {
    db.close();
  }
};

layer(BunFileSystem.layer, { excludeTestServices: true })('snapshot credentials', (it) => {
  it.effect('capture leaves source keys readable and scrubs only the snapshot copy', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-credentials-' }));
      const path = join(root, 'store.sqlite');
      const creds = join(root, 'creds');
      yield* FileSystem.FileSystem.use((files) => files.makeDirectory(creds, { recursive: true }));
      const snapshots = storeSnapshots({ providers: credentialParticipant(creds) });
      const pending = [{ name: 'rotate', hash: 'rotate', sql: ["update console_key set key_value = 'rotated' where account = 'alice'"] }];
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table console_key (provider text, account text, key_value text)`);
          yield* db.run(sql`insert into console_key values ('muse', 'alice', 'sk-alice'), ('muse', '', 'sk-blank')`);
          yield* db.run(sql`create table fact (id text primary key, value text)`);
          yield* db.run(sql`insert into fact values ('kept', 'before')`);
          yield* snapshots.take({ path, db }, pending);
        }),
      );
      const source = yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          return yield* db.all<{ provider: string; account: string; key_value: string }>(
            sql`select provider, account, key_value from console_key order by account`,
          );
        }),
      );
      expect(source).toEqual([
        { provider: 'muse', account: '', key_value: 'sk-blank' },
        { provider: 'muse', account: 'alice', key_value: 'sk-alice' },
      ]);
      const manifest = yield* manifestOf(path);
      expect(scrubbedCopy(path, manifest.id)).toEqual([{ k: '' }]);
      expect(manifest.participants.providers.evacuated.toSorted((a, b) => a.stored.localeCompare(b.stored))).toEqual([
        { provider: 'muse', stored: '', account: consoleAccountOf('sk-blank') },
        { provider: 'muse', stored: 'alice', account: 'alice' },
      ]);
    }),
  );

  it.effect('restore keeps raw stored identities and reports a missing default without failing', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-credential-restore-' }));
      const path = join(root, 'store.sqlite');
      const creds = join(root, 'creds');
      yield* FileSystem.FileSystem.use((files) => files.makeDirectory(creds, { recursive: true }));
      const snapshots = storeSnapshots({ providers: credentialParticipant(creds) });
      const pending = [
        {
          name: 'rotate',
          hash: 'rotate',
          sql: [
            "update console_key set key_value = 'rotated' where provider = 'muse'",
            "update default_account set account = account where principal_id = 'op2'",
            "update fact set value = 'after'",
          ],
        },
      ];
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table console_key (provider text, account text, key_value text)`);
          yield* db.run(sql`insert into console_key values ('muse', 'alice', 'sk-alice'), ('muse', '', 'sk-blank')`);
          yield* db.run(sql`create table default_account (principal_id text, provider text, account text)`);
          yield* db.run(sql`insert into default_account values ('op', 'muse', 'alice'), ('op2', 'opencode-go', 'ghost')`);
          yield* db.run(sql`create table fact (id text primary key, value text)`);
          yield* db.run(sql`insert into fact values ('kept', 'before')`);
          yield* snapshots.take({ path, db }, pending);
          yield* db.run(sql`update console_key set key_value = 'rotated' where provider = 'muse'`);
          yield* db.run(sql`update fact set value = 'after'`);
        }),
      );
      const answer = yield* snapshots.restore(path);
      const credential = answer.losses.filter((loss) => loss.owner === 'providers');
      expect(credential).toHaveLength(1);
      expect(credential[0]).toMatchObject({ table: 'default_account', key: 'op2/opencode-go' });
      const after = yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          const keys = yield* db.all<{ provider: string; account: string; key_value: string }>(
            sql`select provider, account, key_value from console_key order by account`,
          );
          const accounts = yield* db.all<{ principal_id: string; provider: string; account: string }>(
            sql`select principal_id, provider, account from default_account order by principal_id`,
          );
          const facts = yield* db.all<{ value: string }>(sql`select value from fact`);
          return { keys, accounts, facts };
        }),
      );
      expect(after.keys).toEqual([
        { provider: 'muse', account: '', key_value: 'sk-blank' },
        { provider: 'muse', account: 'alice', key_value: 'sk-alice' },
      ]);
      expect(after.accounts).toEqual([
        { principal_id: 'op', provider: 'muse', account: 'alice' },
        { principal_id: 'op2', provider: 'opencode-go', account: 'ghost' },
      ]);
      expect(after.facts).toEqual([{ value: 'before' }]);
    }),
  );

  it.effect('a legacy no-account key table round-trips through capture and restore', () =>
    Effect.gen(function* () {
      const root = yield* FileSystem.FileSystem.use((files) => files.makeTempDirectoryScoped({ prefix: 'snapshot-credential-table-' }));
      const path = join(root, 'store.sqlite');
      const creds = join(root, 'creds');
      yield* FileSystem.FileSystem.use((files) => files.makeDirectory(creds, { recursive: true }));
      const snapshots = storeSnapshots({ providers: credentialParticipant(creds) });
      const pending = [
        { name: 'rotate', hash: 'rotate', sql: ["update console_key set key_value = 'rotated'", "update fact set value = 'after'"] },
      ];
      yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table console_key (provider text, key_value text)`);
          yield* db.run(sql`insert into console_key values ('muse', 'sk-legacy')`);
          yield* db.run(sql`create table fact (id text primary key, value text)`);
          yield* db.run(sql`insert into fact values ('kept', 'before')`);
          yield* snapshots.take({ path, db }, pending);
          yield* db.run(sql`update console_key set key_value = 'rotated'`);
          yield* db.run(sql`update fact set value = 'after'`);
        }),
      );
      const manifest = yield* manifestOf(path);
      expect(scrubbedCopy(path, manifest.id)).toEqual([{ k: '' }]);
      yield* snapshots.restore(path);
      const after = yield* inDatabase(path, (db) =>
        Effect.gen(function* () {
          return yield* db.all<{ provider: string; key_value: string }>(sql`select provider, key_value from console_key`);
        }),
      );
      expect(after).toEqual([{ provider: 'muse', key_value: 'sk-legacy' }]);
    }),
  );
});
