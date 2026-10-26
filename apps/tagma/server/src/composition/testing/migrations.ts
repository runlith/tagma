import type { MigrationChain } from '../../platform/contract/service/store.js';
import { migrationsFolder, seedDirectory } from '../../installation/testing/doubles.js';

export const fixtureMigrations: MigrationChain<'machine'> = {
  folder: migrationsFolder(),
  seeds: seedDirectory(),
};
export const fixtureGraphMigrations: MigrationChain<'graph'> = { folder: migrationsFolder(), seeds: seedDirectory() };
