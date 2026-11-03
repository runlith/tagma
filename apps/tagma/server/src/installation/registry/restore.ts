import { existsSync, renameSync, rmSync } from 'node:fs';
import { Context, Effect, Layer } from 'effect';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { sql } from 'drizzle-orm';
import type { RegistryOwner, RegistryPart, RegistryRestore } from '../../platform/contract/service/machineRegistry.js';
import {
  type GraphStore,
  type MigrationChain,
  MachineStore,
  type StoreOpenFailure,
  type StoreFailure,
} from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { machineFileLayer, poolOf, type PoolSource, storeLayer } from '../../platform/store/open.js';
import { MachineRegistry } from '../contract/service/registry.js';
import type { RegistryUnreadable } from '../contract/wire/registry.js';
import { dumpMachineRegistry, readRegistry, registryPathFor } from './file.js';

const STORE_FILES = ['', '-wal', '-shm'] as const;

const seedRows = (
  store: Context.Service.Shape<typeof MachineStore>,
  parts: readonly RegistryPart[],
  restores: readonly RegistryRestore[],
): Effect.Effect<void, StoreFailure> =>
  store.transaction(
    writes(
      'registry.seed',
      parts.flatMap((part) => part.tables),
    ),
    (unit) => Effect.forEach(restores, (restore) => restore(unit, store.db), { discard: true }),
  );

const restoreMachineRegistry = Effect.fn('registry.restore')(function* (
  storePath: string,
  migrations: MigrationChain<'machine'>,
  parts: readonly RegistryPart[],
  restores: readonly RegistryRestore[],
  processes: ProcessPool,
): Effect.fn.Return<boolean, StoreOpenFailure> {
  if (existsSync(storePath)) return false;
  const building = `${storePath}.restoring`;
  for (const suffix of STORE_FILES) rmSync(`${building}${suffix}`, { force: true });
  yield* Effect.scoped(
    Effect.gen(function* () {
      const store = Context.get(yield* Layer.build(storeLayer(MachineStore, building, migrations, {}, processes)), MachineStore);
      yield* seedRows(store, parts, restores);
      yield* store.db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
    }),
  );
  renameSync(building, storePath);
  for (const suffix of STORE_FILES) rmSync(`${building}${suffix}`, { force: true });
  return true;
});

const openMachineRegistry = Effect.fn('registry.open')(function* (
  parts: readonly RegistryPart[],
  read: readonly RegistryRestore[] | null,
): Effect.fn.Return<void, StoreFailure | RegistryUnreadable, MachineStore> {
  const store = yield* MachineStore;
  const held = yield* store.db.all<{ held: number }>(sql`select exists(select 1 from project) or exists(select 1 from setting) as held`);
  if (held[0]?.held === 1) {
    return yield* dumpMachineRegistry(parts).pipe(
      Effect.catchCause((cause) => Effect.logError('machine registry dump failed at boot', cause)),
    );
  }
  const path = registryPathFor(store.path);
  const restores = read ?? (path !== null && existsSync(path) ? yield* readRegistry(parts, path) : null);
  if (restores !== null) yield* seedRows(store, parts, restores);
});

const registryOf = (parts: readonly RegistryPart[]) =>
  Effect.map(MachineStore, (store) =>
    MachineRegistry.of({
      dump: Effect.provideService(dumpMachineRegistry(parts), MachineStore, store),
      watch: (changed) => Effect.forEach(parts, (part) => part.watch?.(changed) ?? Effect.void, { discard: true }),
    }),
  );

export const machineStoreLayer = (
  path: string,
  migrations: MigrationChain<'machine'>,
  processes: PoolSource,
  owners: readonly RegistryOwner[],
): Layer.Layer<MachineStore | GraphStore | MachineRegistry, never> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const parts = yield* Effect.promise(() => Promise.all(owners.map((owner) => owner.load())));
      const pool = yield* poolOf(processes);
      const registry = registryPathFor(path);
      const found = registry !== null && !existsSync(path) && existsSync(registry) ? yield* readRegistry(parts, registry) : null;
      const restored = found !== null && (yield* restoreMachineRegistry(path, migrations, parts, found, pool));
      return Layer.merge(
        Layer.effectDiscard(Effect.orDie(openMachineRegistry(parts, restored ? null : found))),
        Layer.effect(MachineRegistry, registryOf(parts)),
      ).pipe(Layer.provideMerge(Layer.orDie(machineFileLayer(path, migrations, {}, pool))));
    }).pipe(Effect.orDie),
  );
