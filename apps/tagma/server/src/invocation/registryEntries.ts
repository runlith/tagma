import { createHash } from 'node:crypto';
import { describeApproval } from '@runlith/agent/modes/ApprovalMode';
import { toolInputSchema } from '@runlith/llm/schema/messages';
import type { Operation } from '../platform/contract/wire/operation.js';
import type { OperationRegistry } from './contract/service/registry.js';
import type { RegistryEntry } from './contract/wire/operations.js';

export type RegistryEntries = {
  readonly rows: readonly RegistryEntry[];
  readonly bytes: ReadonlyMap<string, number>;
  readonly contract: string;
};

const CONTRACT_DIGITS = 24;

const entries = new WeakMap<object, RegistryEntries>();

const rowOf = <Id extends string>(registry: OperationRegistry<Id>, id: Id): RegistryEntry => {
  const entry: Operation = registry.entry(id);
  return {
    id,
    meaning: entry.meaning,
    grammar: entry.grammar,
    refusals: entry.refusals,
    input: toolInputSchema(entry.params),
    mutates: entry.mutates === true,
    negative: entry.negative !== undefined,
    intent: entry.intent,
    confirmLabel: entry.confirmLabel,
    doors: registry.doors(id),
    callers: registry.callers(id),
    approval: describeApproval(entry.approval),
    place: entry.place === 'project' ? true : undefined,
    tool: entry.tool,
  };
};

export const registryEntries = <Id extends string>(registry: OperationRegistry<Id>): RegistryEntries => {
  const standing = entries.get(registry);
  if (standing !== undefined) return standing;
  const rows = [...registry.ids].sort().map((id) => rowOf(registry, id));
  const contract = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, CONTRACT_DIGITS);
  const bytes = new Map(rows.map((row) => [row.id, Buffer.byteLength(JSON.stringify(row))] as const));
  const built = { rows, bytes, contract };
  entries.set(registry, built);
  return built;
};
