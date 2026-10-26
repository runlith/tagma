import { Schema } from 'effect';
import type { Approval, Condition, PermissionSubject, Raised } from '@runlith/agent/permissions';
import type { ClaimTarget } from '@runlith/agent/tool';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { family } from '@runlith/paging';
import type { AgentTool } from '../../../../platform/contract/wire/capability.js';
import type { OperationDoors, OperationLifetime, OperationWait } from '../../../../platform/contract/wire/operation.js';
import { projectField } from '../../../../platform/contract/wire/place.js';

export const BLOCKS = family('blocks', 1, 'text', { text: 250, json: 687 }, 100, () => ({
  name: '9ac665e5',
  tags: ['spec'],
  title: 'x'.repeat(160),
  parentTitle: 'x'.repeat(40),
}));
export const TASKS = family('tasks', 1, 'text', { text: 155, json: 358 }, 100, () => ({
  name: '3aed9172',
  tags: ['task'],
  status: 'open',
  title: 'x'.repeat(120),
}));
export const PROPOSALS = family('proposals', 1, 'text', { text: 667, json: 1018 }, 100, () => ({
  name: '59a39d70',
  tags: ['p'.repeat(8)],
  status: 'open',
  title: 'x'.repeat(50),
  ops: [
    { op: 'edit', id: '26981caa', old: 'x'.repeat(6), new: 'x'.repeat(50) },
    { op: 'create', parentId: '26981caa', tags: ['task'], title: 'x'.repeat(12), body: 'x'.repeat(23) },
  ],
}));
export const GAUGES = family('gauges', 2, 'text', { text: 257, json: 264 }, 100, () => ({
  blockName: '9ac665e5',
  title: 'x'.repeat(110),
  source: 'apps/tagma/server/src/graph/operations/sources.ts#read_gauges',
  area: 'x'.repeat(40),
}));
export const EVENTS = family('events', 1, 'text', { text: 89, json: 144 }, 100, () => ({
  id: 175866,
  op: 'update',
  blockName: '9fc4af80',
  session: '2033ae3f',
  at: '2026-09-22T20:24:16.059Z',
}));

export const AGENT_LIST_ROW_BYTES = 250;
export const AGENT_LIST_MAX_ROWS = 200;
export const AGENT_LIST_ROWS = 100;
export const EVENTS_PAGE_SIZE = 20;

export const graphInput = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.Struct({ project: projectField, ...fields });

export const agentLimit = Schema.optional(
  Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(AGENT_LIST_MAX_ROWS)).annotate({
    description: `How many rows to answer, ${AGENT_LIST_ROWS} by default and ${AGENT_LIST_MAX_ROWS} at most. The answer carries the total, so a cut is never silent.`,
  }),
);

export const BODY_FILE_FIELD =
  'Markdown file, absolute or relative to the caller’s directory (the agent’s scratch). Read at call time. Mutually exclusive with body.';

const GRAPH_AGENT = { capability: 'graph' } as const satisfies AgentTool;
const GRAPH_DIRECT = { capability: 'graph', direct: true } as const satisfies AgentTool;
const GRAPH_DOORS = { http: true } as const satisfies OperationDoors;
const SERVED: readonly OperationLifetime[] = ['workspace'];
const READ_WAITS: readonly OperationWait[] = ['ticket', 'reader', 'graph-open'];
const ACT_WAITS: readonly OperationWait[] = ['ticket', 'tree-permit', 'unit', 'graph-open'];

export const HELD_ELSEWHERE: Condition = { id: 'held-elsewhere', label: 'Held elsewhere', asksFrom: 'review', timeout: 'none' };

export const noSubjects = (): readonly PermissionSubject[] => [];

export type HeldWork = {
  readonly name: string;
  readonly title: string;
  readonly holder: string;
};

export const heldRaised = (held: HeldWork, act: string): Raised => ({
  condition: HELD_ELSEWHERE.id,
  fact: `${held.name} "${held.title}" is in work by ${held.holder}; ${act}`,
});

export const workRaises = (_input: unknown, prepared: { readonly facts: readonly Raised[] | null } | undefined): readonly Raised[] =>
  prepared?.facts ?? [];

export type ClaimFacts = { readonly raised: readonly Raised[]; readonly over: number | null };

export const claimRaises = (_input: unknown, prepared: { readonly facts: ClaimFacts | null } | undefined): readonly Raised[] =>
  prepared?.facts?.raised ?? [];

export const GRAPH_WORK_APPROVAL: Approval = { ...ASKS_IN_REVIEW, when: [HELD_ELSEWHERE] };

export const GRAPH_READ = {
  approval: ASKS_NEVER,
  effect: 'read',
  identity: 'none',
  subject: 'head',
  waits: READ_WAITS,
  lifetimes: SERVED,
  place: 'project',
  doors: GRAPH_DOORS,
  tool: GRAPH_AGENT,
  callers: 'any',
} as const;

const GRAPH: readonly ClaimTarget[] = [{ kind: 'key', key: 'graph' }];
const EVERYTHING: readonly ClaimTarget[] = [{ kind: 'all' }];

export const GRAPH_ACT = {
  approval: ASKS_IN_REVIEW,
  effect: 'write',
  identity: { key: 'call' },
  subject: 'none',
  waits: ACT_WAITS,
  lifetimes: SERVED,
  place: 'project',
  doors: GRAPH_DOORS,
  tool: GRAPH_AGENT,
  callers: 'any',
  claims: { reads: () => EVERYTHING, writes: () => GRAPH },
} as const;

export const GRAPH_DIRECT_READ = { ...GRAPH_READ, tool: GRAPH_DIRECT } as const;

export const GRAPH_DIRECT_ACT = { ...GRAPH_ACT, tool: GRAPH_DIRECT } as const;

export const GRAPH_OPERATOR_READ = { ...GRAPH_READ, tool: undefined } as const;

const SURFACE_DOORS = { http: 'perform' } as const satisfies OperationDoors;

export const SURFACE_READ = { ...GRAPH_READ, doors: SURFACE_DOORS } as const;

export const SURFACE_ACT = { ...GRAPH_ACT, doors: SURFACE_DOORS } as const;
