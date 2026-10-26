import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { RENAMED_OPERATIONS, type Renames } from './renamedOperations.js';

const object = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const renaming = (renames: Renames): NonNullable<ThreadFormStep['payload']> => {
  const names: ReadonlyMap<string, string> = new Map(renames);
  return (payload) => {
    const context = payload.contextChange;
    if (!object(context) || !object(context.evidence) || !Array.isArray(context.evidence.tools)) return null;
    const before = context.evidence.tools;
    const tools = before.map((tool: unknown) => (typeof tool === 'string' ? (names.get(tool) ?? tool) : tool));
    if (tools.every((tool, at) => tool === before[at])) return null;
    return { ...payload, contextChange: { ...context, evidence: { ...context.evidence, tools } } };
  };
};

export const operationContextForm: ThreadFormStep = {
  name: '20261013021000_graph_operation_names',
  samples: { payload: { contextChange: { evidence: { tools: ['claim_task', 'ready_tasks'] } } } },
  payload: renaming(RENAMED_OPERATIONS.contract),
};

export const ruleOperationContextForm: ThreadFormStep = {
  name: '20261020030000_rule_operation_names',
  samples: { payload: { contextChange: { evidence: { tools: ['enforce_law', 'check_law'] } } } },
  payload: renaming(RENAMED_OPERATIONS.rules),
};
