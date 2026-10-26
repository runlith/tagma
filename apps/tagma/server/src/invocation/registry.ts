import type { Operation } from '../platform/contract/wire/operation.js';
import type { Door } from './contract/wire/operations.js';
import type { OperationRegistry } from './contract/service/registry.js';

const doorsOf = (entry: Operation): readonly Door[] => {
  if (entry.doors?.socket === true && entry.doors.http === false) return ['socket'];
  return entry.tool === undefined ? ['http'] : ['http', 'mcp'];
};

export const operationRegistry = <Id extends string>(declarations: Readonly<Record<Id, Operation>>): OperationRegistry<Id> => {
  const ids = Object.keys(declarations) as Id[];
  const current = new Set<string>(ids);
  return {
    ids,
    entry: (id) => declarations[id],
    named: (name) => (current.has(name) ? (name as Id) : null),
    doors: (id) => doorsOf(declarations[id]),
    callers: (id) => declarations[id].callers,
  };
};
