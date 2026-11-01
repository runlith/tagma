import { declarationsOf, type CollectedDeclarations } from '../../platform/contract/wire/manifest.js';
import { projectedOperations } from '../../platform/contract/wire/projection.js';
import { CATALOG_MODULES } from '../developer/catalog.js';

const collected = await declarationsOf(CATALOG_MODULES);

export const OPERATIONS: ReturnType<typeof projectedOperations<CollectedDeclarations<typeof CATALOG_MODULES>>> = projectedOperations(
  collected.declarations,
);

export type CatalogOperationId = keyof typeof OPERATIONS;

export const OPERATION_IDS = Object.keys(OPERATIONS) as readonly CatalogOperationId[];
