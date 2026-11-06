import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ChainFills } from '@runlith/sqlite-process/chainReturn';
import { ACTIVITY_DATABASE } from '../activity/contract/service/place.js';
import { mirrorsHome } from '../graph/storage/layout.js';
import {
  ACTIVITY_MIGRATIONS,
  EVIDENCE_MIGRATIONS,
  EXECUTIONS,
  MIGRATIONS,
  STORE_MIGRATIONS,
} from '../installation/contract/wire/manifest.js';
import type { StoreFile } from '../installation/process/returning.js';
import { PERFORMANCE_DATABASE } from '../performance/contract/service/place.js';
import type { Manifest } from '../platform/contract/service/manifest.js';
import { ownStoreDirectory } from '../platform/contract/service/ownStore.js';
import { storeDirectory } from '../platform/contract/service/store.js';

const DATABASE = '.sqlite';

export type StoreFills = { readonly machine: ChainFills; readonly own: ReadonlyMap<string, ChainFills> };

const UNFILLED: StoreFills = { machine: new Map(), own: new Map() };

export const fillsOf = (modules: readonly Manifest[]): StoreFills => ({
  machine: new Map(modules.flatMap((module) => module.indexFills ?? []).map((index) => [index.table, index.fill])),
  own: new Map(
    modules
      .flatMap((module) => module.stores ?? [])
      .map((store) => [store.id, new Map((store.indexFills ?? []).map((index) => [index.table, index.fill]))]),
  ),
});

export const copiedStores = (storePath: string): readonly StoreFile[] => {
  const data = storeDirectory(storePath);
  return [
    { path: storePath, chain: MIGRATIONS },
    { path: join(data, ACTIVITY_DATABASE), chain: ACTIVITY_MIGRATIONS },
    { path: join(data, PERFORMANCE_DATABASE), chain: EVIDENCE_MIGRATIONS },
  ];
};

const databasesUnder = (directory: string): readonly string[] =>
  !existsSync(directory)
    ? []
    : readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const at = join(directory, entry.name);
        return entry.isDirectory() ? databasesUnder(at) : entry.name.endsWith(DATABASE) ? [at] : [];
      });

const ownStores = (storePath: string, fills: StoreFills): readonly StoreFile[] => {
  const directory = ownStoreDirectory(storePath);
  return !existsSync(directory)
    ? []
    : readdirSync(directory)
        .filter((name) => name.endsWith(DATABASE) && statSync(join(directory, name)).isFile())
        .map((name) => {
          const id = name.slice(0, -DATABASE.length);
          return { path: join(directory, name), chain: `${STORE_MIGRATIONS}/${id}`, fills: fills.own.get(id) };
        });
};

export const dataStores = (storePath: string, hosts: readonly string[], fills: StoreFills = UNFILLED): readonly StoreFile[] => [
  ...copiedStores(storePath).map((store) => (store.chain === MIGRATIONS ? { ...store, fills: fills.machine } : store)),
  ...ownStores(storePath, fills),
  ...databasesUnder(mirrorsHome(storeDirectory(storePath))).map((path) => ({ path, chain: MIGRATIONS, fills: fills.machine })),
  ...hosts.map((state) => ({ path: join(state, 'executions.sqlite'), chain: `${EXECUTIONS}/${MIGRATIONS}` })),
];
