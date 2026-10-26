import type { Operation, OperationCallers } from '../../../platform/contract/wire/operation.js';
import type { Door } from '../wire/operations.js';

export type OperationRegistry<Id extends string> = {
  readonly ids: readonly Id[];
  readonly entry: (id: Id) => Operation;
  readonly named: (name: string) => Id | null;
  readonly doors: (id: Id) => readonly Door[];
  readonly callers: (id: Id) => OperationCallers;
};
