import { expect } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { sql } from 'drizzle-orm';
import { Arbitrary, Context, Effect, FileSystem, Layer, Result, Schema } from 'effect';
import { fixtureMigrations, fixtureRegistry } from '../../composition/testing/migrations.js';
import type { RegistryOwner, RegistryPart } from '../../platform/contract/service/machineRegistry.js';
import { MachineStore, type MigrationChain } from '../../platform/contract/service/store.js';
import { shippedChain } from '../../platform/store/chain.js';
import { MachineRegistry } from '../contract/service/registry.js';
import { FROZEN } from '../testing/frozen.js';
import { readRegistry } from './file.js';
import { machineStoreLayer } from './restore.js';

const ISSUED = fileURLToPath(new URL('../testing/release-0.1.0.json', import.meta.url));
const decodeIssued = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ 'machine-store': Schema.Array(Schema.String) })));

const loadParts = Effect.promise(() => Promise.all(fixtureRegistry.map((owner) => owner.load())));

const opened = <A, E>(
  path: string,
  migrations: MigrationChain<'machine'>,
  work: (store: MachineStore['Service'], registry: MachineRegistry['Service']) => Effect.Effect<A, E>,
  owners: readonly RegistryOwner[] = fixtureRegistry,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(machineStoreLayer(path, migrations, sharedPool, owners));
      return yield* work(Context.get(context, MachineStore), Context.get(context, MachineRegistry));
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

  it.effect('every issued release reads the registry file today writes, and today reads every registry file an issued release wrote', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const place = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-registry-' });
      const written = yield* opened(join(place, 'tagma.sqlite'), fixtureMigrations, (store, registry) =>
        Effect.gen(function* () {
          yield* store.db.run(sql`insert into project (id, name, repo_key, root_path, kind, created_at, removed_at) values
            (10, 'kept', 'repo:kept', '/kept', 'folder', 1, null),
            (11, 'gone', 'repo:gone', '/gone', 'folder', 1, 2),
            (12, 'pair', 'group:pair', '/pair', 'group', 1, null)`);
          yield* store.db.run(sql`insert into group_member (project_id, group_id, ord) values (10, 12, 0), (11, 12, 1)`);
          yield* store.db.run(sql`insert into project_policy (project_id, strict_provenance, private, storage) values (10, 1, 1, 'team')`);
          yield* store.db.run(sql`insert into setting (scope, project_id, key, value, declined, updated_at) values
            ('user', null, 'threads.idleProjectionDays', '9', 0, 1),
            ('project', 10, 'graph.commit', null, 1, 1)`);
          yield* registry.dump;
          return yield* files.readFileString(join(place, 'registry.json'));
        }),
      );
      for (const shape of FROZEN) {
        const read = Schema.decodeUnknownResult(Schema.fromJsonString(shape.registry))(written);
        expect(Result.isSuccess(read) ? undefined : read.failure.message).toBeUndefined();
      }

      const parts = yield* loadParts;
      const path = join(place, 'issued.json');
      for (const shape of FROZEN) {
        for (const sample of yield* Arbitrary.sampleEffect(Arbitrary.schema(shape.registry), { count: 24, seed: 1 })) {
          yield* files.writeFileString(
            path,
            JSON.stringify(sample, (_key, field: unknown) => (typeof field === 'number' && !Number.isFinite(field) ? 0 : field)),
          );
          expect((yield* readRegistry(parts, path)).length).toBe(parts.length);
        }
      }
    }),
  );

  it.effect('a registration taken back while the registry is dumped leaves a file every reader still takes', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const place = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-registry-race-' });
      let midway: Effect.Effect<unknown, unknown> = Effect.void;
      const racing = (part: RegistryPart): RegistryPart => ({
        ...part,
        dump: (...input) => Effect.tap(part.dump(...input), () => Effect.orDie(midway)),
      });
      const owners = fixtureRegistry.map((owner) =>
        owner.id === 'projects/projects' ? { id: owner.id, load: async () => racing(await owner.load()) } : owner,
      );
      const dumped = yield* opened(
        join(place, 'tagma.sqlite'),
        fixtureMigrations,
        (store, registry) =>
          Effect.gen(function* () {
            yield* store.db.run(sql`insert into project (id, name, repo_key, root_path, kind, created_at) values
              (10, 'kept', 'repo:kept', '/kept', 'folder', 1), (11, 'born', 'repo:born', '/born', 'folder', 1)`);
            yield* store.db.run(sql`insert into project_policy (project_id, storage) values (10, 'team'), (11, 'stealth')`);
            yield* registry.dump;
            midway = store.db.run(sql`delete from project where id = 11`);
            return yield* Effect.exit(registry.dump);
          }),
        owners,
      );
      const read = yield* Effect.result(readRegistry(yield* loadParts, join(place, 'registry.json')));
      expect({ dumped: dumped._tag, read: read._tag }).toEqual({ dumped: 'Success', read: 'Success' });
    }),
  );
});
