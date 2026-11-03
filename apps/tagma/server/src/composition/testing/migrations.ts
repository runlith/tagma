import type { MigrationChain } from '../../platform/contract/service/store.js';
import { migrationsFolder, seedDirectory } from '../../installation/testing/doubles.js';
import { rowFactsOf } from '../../platform/contract/service/manifest.js';
import { MACHINE_REGISTRY, type RegistryOwner } from '../../platform/contract/service/machineRegistry.js';
import { CORE_MODULES } from '../core.js';

export const fixtureMigrations: MigrationChain<'machine'> = {
  folder: migrationsFolder(),
  seeds: seedDirectory(),
  rowFacts: () => rowFactsOf(CORE_MODULES),
};
export const fixtureGraphMigrations: MigrationChain<'graph'> = { folder: migrationsFolder(), seeds: seedDirectory() };
export const fixtureRegistry: readonly RegistryOwner[] = MACHINE_REGISTRY.collect(CORE_MODULES).map(({ entry }) => entry);
