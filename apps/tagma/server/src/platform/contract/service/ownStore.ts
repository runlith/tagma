import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from 'effect';
import { IN_MEMORY, type Store, storeDirectory } from './store.js';

const OWN_STORES = 'stores';

export type OwnStore = {
  readonly id: string;
  readonly key: Context.Key<any, Store<any>>;
  readonly migrations: string;
};

export const ownStorePath = (storePath: string, id: string): string =>
  storePath === IN_MEMORY ? IN_MEMORY : join(storeDirectory(storePath), OWN_STORES, `${id}.sqlite`);

export const ownStoreFiles = (storePath: string): readonly string[] => {
  const directory = join(storeDirectory(storePath), OWN_STORES);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sqlite'))
    .sort()
    .map((name) => join(directory, name));
};
