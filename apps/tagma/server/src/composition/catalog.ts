import type { Schema } from 'effect';
import type { DeclaredAnswer } from '../platform/contract/wire/operation.js';
import { declarationsOf, type CollectedDeclarations } from '../platform/contract/wire/manifest.js';
import { projectedOperations } from '../platform/contract/wire/projection.js';
import { CATALOG_MODULES } from './developer/catalog.js';

const collected = await declarationsOf(CATALOG_MODULES);

export const OPERATIONS: ReturnType<typeof projectedOperations<CollectedDeclarations<typeof CATALOG_MODULES>>> = projectedOperations(
  collected.declarations,
);
export type CatalogOperationId = keyof typeof OPERATIONS;

export type OperationInput<Id extends CatalogOperationId> = (typeof OPERATIONS)[Id]['params']['Type'];

export type OperationAnswer<Id extends CatalogOperationId> = (typeof OPERATIONS)[Id] extends {
  readonly answer: infer Answer extends Schema.Top;
}
  ? DeclaredAnswer<Answer>
  : unknown;

export const OPERATION_IDS = Object.keys(OPERATIONS) as readonly CatalogOperationId[];

export const operationsOwnedBy = (module: (typeof CATALOG_MODULES)[number]['id']): readonly CatalogOperationId[] =>
  OPERATION_IDS.filter((id) => collected.owners.get(id) === module);

export type SocketOnlyOperationId = {
  [K in CatalogOperationId]: (typeof OPERATIONS)[K] extends { readonly doors: { readonly socket: true; readonly http: false } } ? K : never;
}[CatalogOperationId];

export type HttpOperationId = Exclude<CatalogOperationId, SocketOnlyOperationId>;
