import type { MigrationChain } from '../../platform/contract/service/store.js';
import { migrationsFolder, seedDirectory } from '../../installation/testing/doubles.js';
import { rowFactsOf } from '../../platform/contract/service/manifest.js';
import { CORE_MODULES } from '../core.js';

export const fixtureMigrations: MigrationChain<'machine'> = {
  folder: migrationsFolder(),
  seeds: seedDirectory(),
  rowFacts: () => rowFactsOf(CORE_MODULES),
};
export const fixtureGraphMigrations: MigrationChain<'graph'> = { folder: migrationsFolder(), seeds: seedDirectory() };
