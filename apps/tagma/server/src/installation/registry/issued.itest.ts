import { expect } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { sql } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { MachineStore, type MigrationChain } from '../../platform/contract/service/store.js';
import { shippedChain } from '../../platform/store/chain.js';
import { machineStoreLayer } from './restore.js';

const ISSUED = fileURLToPath(new URL('../testing/release-0.1.0.json', import.meta.url));
const decodeIssued = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ 'machine-store': Schema.Array(Schema.String) })));

const opened = <A, E>(path: string, migrations: MigrationChain<'machine'>, work: (store: MachineStore['Service']) => Effect.Effect<A, E>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(machineStoreLayer(path, migrations, sharedPool));
      return yield* work(Context.get(context, MachineStore));
    }),
  );

layer(BunFileSystem.layer, { excludeTestServices: true })('issued releases', (it) => {
  it.effect('the machine store 0.1.0 left opens through the server door, reaches the head of the shipped chain and keeps its rows', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const issued = yield* decodeIssued(yield* files.readFileString(ISSUED));
      const place = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-issued-' });
      const chain = join(place, 'drizzle');
      yield* files.makeDirectory(chain);
      for (const name of [...issued['machine-store'], 'baseline.json'])
        yield* files.copy(join(fixtureMigrations.folder, name), join(chain, name), { overwrite: true });
      const path = join(place, 'tagma.sqlite');

      const left = yield* opened(path, { folder: chain, seeds: fixtureMigrations.seeds }, (store) =>
        Effect.andThen(
          store.db.run(sql`insert into project (name, repo_key, root_path, created_at) values ('kept', 'repo:kept', '/kept', 1)`),
          Effect.succeed(store.schema),
        ),
      );
      const forward = yield* opened(path, fixtureMigrations, (store) =>
        Effect.map(store.db.all(sql`select name, repo_key, root_path from project`), (rows) => ({ schema: store.schema, rows })),
      );

      expect(left).toEqual({ applied: 69, latest: '20261023183229_worktree_facts' });
      expect(forward).toEqual({
        schema: shippedChain(fixtureMigrations),
        rows: [{ name: 'kept', repo_key: 'repo:kept', root_path: '/kept' }],
      });
    }),
  );
});
