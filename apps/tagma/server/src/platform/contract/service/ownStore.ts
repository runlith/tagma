import { join } from 'node:path';
import type { Context } from 'effect';
import type { ChainFill } from '@runlith/sqlite-process/chainReturn';
import { IN_MEMORY, type Store, storeDirectory } from './store.js';

export type IndexFill = { readonly table: string; readonly fill: ChainFill };

export type OwnStore = {
  readonly id: string;
  readonly key: Context.Key<any, Store<any>>;
  readonly migrations: string;
  readonly adopts?: readonly string[];
  readonly indexFills?: readonly IndexFill[];
};

export const ownStoreDirectory = (storePath: string): string => join(storeDirectory(storePath), 'stores');

export const ownStorePath = (storePath: string, id: string): string =>
  storePath === IN_MEMORY ? IN_MEMORY : join(ownStoreDirectory(storePath), `${id}.sqlite`);

export const setAsideDirectory = (storePath: string): string => join(ownStoreDirectory(storePath), 'set-aside');

export const setAsidePath = (storePath: string, migration: string): string => join(setAsideDirectory(storePath), `${migration}.sqlite`);

export const adoptedPath = (setAside: string, by: string): string => setAside.replace(/\.sqlite$/u, `.adopted.${by}.sqlite`);
