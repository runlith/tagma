import type { Catalogs } from '../graph/contract/wire/catalogs.js';
import { CATALOGS, catalogById, catalogsDeclaring } from './contract/wire/registry.js';

export const catalogs = (key: NonNullable<Catalogs['Service']['key']>) => ({
  key,
  all: CATALOGS,
  byId: catalogById,
  declaring: catalogsDeclaring,
});
