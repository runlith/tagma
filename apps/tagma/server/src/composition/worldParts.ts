import { getTableName } from 'drizzle-orm';
import type { Manifest } from '../platform/contract/service/manifest.js';
import { RELOCATIONS } from '../platform/contract/service/relocation.js';
import type { WorldParts } from '../installation/move/transfer.js';

export const worldParts = (modules: readonly Manifest[]): WorldParts => {
  const relocations = RELOCATIONS.collect(modules);
  return {
    relocations,
    entities: async () => {
      const declared = await Promise.all(modules.map((module) => module.tables?.() ?? null));
      return [
        ...declared.flatMap((tables) => (tables === null ? [] : tables.entities.map((table) => getTableName(table)))),
        ...relocations.flatMap(({ entry }) => entry.tables ?? []),
      ];
    },
  };
};
