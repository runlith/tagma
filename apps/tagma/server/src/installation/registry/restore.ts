import { existsSync, renameSync, rmSync } from 'node:fs';
import { Context, Effect, Layer } from 'effect';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { sql } from 'drizzle-orm';
import {
  type GraphStore,
  type MigrationChain,
  MachineStore,
  type StoreOpenFailure,
  type StoreFailure,
} from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { machineFileLayer, poolOf, type PoolSource, storeLayer } from '../../platform/store/open.js';
import { setting } from '../../settings/store/table.js';
import { project } from '../../projects/store/table.js';
import { projectPolicy } from '../../graph/store/policy.js';
import { restoreProjects } from '../../projects/store/restore.js';
import { restoreSettings } from '../../settings/store/restore.js';
import { restorePolicies } from '../../graph/serving/policyRestore.js';
import { MachineRegistry } from '../contract/service/registry.js';
import type { RegistryFile, RegistryUnreadable } from '../contract/wire/registry.js';
import { dumpMachineRegistry, readRegistry, registryPathFor } from './file.js';

const STORE_FILES = ['', '-wal', '-shm'] as const;

function seedRows(store: Context.Service.Shape<typeof MachineStore>, file: RegistryFile): Effect.Effect<void, StoreFailure> {
  return store.transaction(writes('registry.seed', [project, projectPolicy, setting]), (unit) =>
    Effect.gen(function* () {
      yield* restoreProjects(
        unit,
        store.db,
        file.projects.map((row) => ({
          ...row,
          createdAt: new Date(row.createdAt),
          removedAt: row.removedAt == null ? null : new Date(row.removedAt),
        })),
      );
      yield* restorePolicies(unit, store.db, file.projects);
      yield* restoreSettings(
        unit,
        store.db,
        file.settings.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt) })),
      );
    }),
  );
}

export const restoreMachineRegistry = Effect.fn('registry.restore')(function* (
  storePath: string,
  migrations: MigrationChain<'machine'>,
  file: RegistryFile,
  processes: ProcessPool,
): Effect.fn.Return<boolean, StoreOpenFailure> {
  if (existsSync(storePath)) return false;
  const building = `${storePath}.restoring`;
  for (const suffix of STORE_FILES) rmSync(`${building}${suffix}`, { force: true });
  yield* Effect.scoped(
    Effect.gen(function* () {
      const store = Context.get(yield* Layer.build(storeLayer(MachineStore, building, migrations, {}, processes)), MachineStore);
      yield* seedRows(store, file);
      yield* store.db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
    }),
  );
  renameSync(building, storePath);
  for (const suffix of STORE_FILES) rmSync(`${building}${suffix}`, { force: true });
  return true;
});

export const openMachineRegistry = Effect.fn('registry.open')(function* (
  read: RegistryFile | null,
): Effect.fn.Return<void, StoreFailure | RegistryUnreadable, MachineStore> {
  const store = yield* MachineStore;
  const held = yield* store.db.all<{ held: number }>(sql`select exists(select 1 from project) or exists(select 1 from setting) as held`);
  if (held[0]?.held === 1) {
    return yield* dumpMachineRegistry().pipe(Effect.catchCause((cause) => Effect.logError('machine registry dump failed at boot', cause)));
  }
  const path = registryPathFor(store.path);
  const file = read ?? (path !== null && existsSync(path) ? yield* readRegistry(path) : null);
  if (file !== null) yield* seedRows(store, file);
});

export const machineStoreLayer = (
  path: string,
  migrations: MigrationChain<'machine'>,
  processes: PoolSource = new ProcessPool(),
): Layer.Layer<MachineStore | GraphStore, never> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const pool = yield* poolOf(processes);
      const registry = registryPathFor(path);
      const found = registry !== null && !existsSync(path) && existsSync(registry) ? yield* readRegistry(registry) : null;
      const restored = found !== null && (yield* restoreMachineRegistry(path, migrations, found, pool));
      return Layer.effectDiscard(Effect.orDie(openMachineRegistry(restored ? null : found))).pipe(
        Layer.provideMerge(Layer.orDie(machineFileLayer(path, migrations, {}, pool))),
      );
    }).pipe(Effect.orDie),
  );

export const machineRegistryLayer: Layer.Layer<MachineRegistry> = Layer.succeed(MachineRegistry, {
  dump: dumpMachineRegistry,
  restore: restoreMachineRegistry,
  open: openMachineRegistry,
});
