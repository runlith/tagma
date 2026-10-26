import type { Actor } from '../platform/contract/wire/actor.js';
import type { Schema } from 'effect';
import type { CheckSubjectKind, DeclaredAnswer, Operation } from '../platform/contract/wire/operation.js';
import { declarationsOf, type CollectedDeclarations } from '../platform/contract/wire/manifest.js';
import { projectedOperations } from '../platform/contract/wire/projection.js';
import { CATALOG_MODULES } from '@tagma/server/composition/catalogModules';

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

export type OperatorOnlyOperationId = {
  [K in CatalogOperationId]: (typeof OPERATIONS)[K] extends { readonly callers: 'operator' } ? K : never;
}[CatalogOperationId];

export type PerformOnlyOperationId = {
  [K in CatalogOperationId]: (typeof OPERATIONS)[K] extends { readonly doors: { readonly http: 'perform' } } ? K : never;
}[CatalogOperationId];

const declared = (id: CatalogOperationId): Operation => OPERATIONS[id];

export const SOCKET_ONLY_OPERATIONS: readonly SocketOnlyOperationId[] = OPERATION_IDS.filter(
  (id): id is SocketOnlyOperationId => declared(id).doors?.socket === true && declared(id).doors?.http === false,
);

export const OPERATOR_ONLY_OPERATIONS: readonly OperatorOnlyOperationId[] = OPERATION_IDS.filter(
  (id): id is OperatorOnlyOperationId => declared(id).callers === 'operator',
);

export const PERFORM_ONLY_OPERATIONS: readonly PerformOnlyOperationId[] = OPERATION_IDS.filter(
  (id): id is PerformOnlyOperationId => declared(id).doors?.http === 'perform',
);

export const SUBMIT_OPERATION: CatalogOperationId = 'submit_work';
export const WORLD_TOOL_CHECKS: Readonly<Record<string, CheckSubjectKind>> = { edit: 'file', write: 'file' };

export function checkSubjectOf(op: string): CheckSubjectKind | null {
  const world = WORLD_TOOL_CHECKS[op];
  if (world !== undefined) return world;
  if (!Object.hasOwn(OPERATIONS, op)) return null;
  const entry: Operation = OPERATIONS[op as CatalogOperationId];
  if (entry.subject !== undefined) return entry.subject === 'none' ? null : entry.subject;
  return entry.checks ?? (entry.mutates === true ? null : 'head');
}

type SubjectArguments<K extends CatalogOperationId> = (typeof OPERATIONS)[K]['subjects'] extends (...args: infer A) => unknown ? A : never;
type PreparedArgument<K extends CatalogOperationId> =
  SubjectArguments<K> extends readonly [unknown, infer Prepared, ...unknown[]] ? Prepared : undefined;
export type OperationSubjectTail<K extends CatalogOperationId> = [prepared: PreparedArgument<K>, actor: Actor];

export function operationSubjects<K extends CatalogOperationId>(
  id: K,
  input: (typeof OPERATIONS)[K]['params']['Type'],
  ...tail: OperationSubjectTail<K>
) {
  const entry: Operation = OPERATIONS[id];
  const [prepared, actor] = tail;
  return entry.subjects(input, prepared, actor);
}
