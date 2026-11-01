import { declarationsOf, type DeclaredCatalog } from '../../platform/contract/wire/manifest.js';
import { CATALOG_MODULES } from './catalog.js';

const declared: DeclaredCatalog<typeof CATALOG_MODULES> = await declarationsOf(CATALOG_MODULES);

export const OPERATIONS: DeclaredCatalog<typeof CATALOG_MODULES>['declarations'] = declared.declarations;

export const operationsOwnedBy: DeclaredCatalog<typeof CATALOG_MODULES>['ownedBy'] = declared.ownedBy;
