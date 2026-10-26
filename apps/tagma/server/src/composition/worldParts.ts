import { getTableName } from 'drizzle-orm';
import { MODULES } from '@tagma/server/composition/modules';
import { RELOCATIONS } from '../platform/contract/service/relocation.js';
import type { WorldParts } from '../installation/move/transfer.js';

const relocations = RELOCATIONS.collect(MODULES);

export const WORLD_PARTS: WorldParts = {
  relocations,
  entities: async () => {
    const declared = await Promise.all(MODULES.map((module) => ('tables' in module ? (module.tables?.() ?? null) : null)));
    return [
      ...declared.flatMap((tables) => (tables === null ? [] : tables.entities.map((table) => getTableName(table)))),
      ...relocations.flatMap(({ entry }) => entry.tables ?? []),
    ];
  },
};
