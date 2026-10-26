import type { ClaimTarget } from '@runlith/agent/tool';
import type { AgentTool } from '../../../../platform/contract/wire/capability.js';
import type { OperationClaims } from '../../../../platform/contract/wire/operation.js';

export const OPERATOR_DOORS = { http: true } as const;

type Addressed = { readonly execution: string };

const executionKey = (input: Addressed): readonly ClaimTarget[] => [{ kind: 'key', key: `execution:${input.execution}` }];

export const executionReads: OperationClaims<Addressed> = { reads: executionKey };

export const executionWrites: OperationClaims<Addressed> = { writes: executionKey };

export const executionShapes = <const Tool extends AgentTool>(tool: Tool) => {
  const doors = { http: true } as const;
  const declared = { doors, tool, callers: 'any', place: 'home', graph: 'none', waits: [], lifetimes: [] } as const;
  return {
    performed: { http: 'perform' } as const,
    read: { ...declared, subject: 'head', effect: 'read', identity: 'none' } as const,
    write: { ...declared, subject: 'none', effect: 'write', identity: { key: 'call' } } as const,
    requestWrite: { ...declared, subject: 'none', effect: 'write', identity: { key: 'request' } } as const,
  };
};
