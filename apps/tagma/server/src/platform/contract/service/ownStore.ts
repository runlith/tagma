import { join } from 'node:path';
import type { Context } from 'effect';
import { IN_MEMORY, type Store, storeDirectory } from './store.js';

export type OwnStore = {
  readonly id: string;
  readonly key: Context.Key<any, Store<any>>;
  readonly migrations: string;
};

export const ownStoreDirectory = (storePath: string): string => join(storeDirectory(storePath), 'stores');

export const ownStorePath = (storePath: string, id: string): string =>
  storePath === IN_MEMORY ? IN_MEMORY : join(ownStoreDirectory(storePath), `${id}.sqlite`);
