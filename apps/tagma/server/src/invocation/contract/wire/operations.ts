import { Schema } from 'effect';
import type { ApprovalDescription } from '@runlith/agent/modes/ApprovalMode';
import { PAGE_CURSOR, family } from '@runlith/paging';
import { arms, operation, type OperationCallers } from '../../../platform/contract/wire/operation.js';
import { AGENT_NEEDS, type AgentTool } from '../../../platform/contract/wire/capability.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';

export type Door = 'http' | 'mcp' | 'socket';

export type RegistryEntry = {
  readonly id: string;
  readonly meaning: string;
  readonly grammar?: string;
  readonly refusals: readonly string[];
  readonly input: Readonly<Record<string, unknown>>;
  readonly mutates: boolean;
  readonly place?: true;
  readonly negative: boolean;
  readonly intent?: 'destructive';
  readonly confirmLabel: string;
  readonly doors: readonly Door[];
  readonly callers: OperationCallers;
  readonly approval: ApprovalDescription;
  readonly tool?: AgentTool;
};

export type OperationsAnswer = {
  readonly status: 'ok';
  readonly contract: string;
  readonly operations: {
    readonly rows: readonly RegistryEntry[];
    readonly shown: number;
    readonly total: number;
    readonly next: string | null;
    readonly complete: boolean;
  };
  readonly unknown: readonly string[];
};

const sampleEntry = (): RegistryEntry => ({
  id: 'x'.repeat(24),
  meaning: 'x'.repeat(240),
  grammar: 'x'.repeat(800),
  refusals: Array.from({ length: 12 }, () => 'x'.repeat(16)),
  input: {
    type: 'object',
    properties: Object.fromEntries(Array.from({ length: 5 }, (_, at) => [`field${at}`, { type: 'string', description: 'x'.repeat(120) }])),
    required: ['field0'],
    additionalProperties: false,
  },
  mutates: true,
  place: true,
  negative: false,
  intent: 'destructive',
  confirmLabel: 'x'.repeat(24),
  doors: ['http', 'mcp'],
  callers: 'any',
  approval: {
    asksFrom: 'review',
    timeoutMs: 600_000,
    why: 'x'.repeat(120),
    conditions: Array.from({ length: 3 }, () => ({ id: 'x'.repeat(20), label: 'x'.repeat(24), asksFrom: 'trust', timeoutMs: 600_000 })),
  },
  tool: { capability: 'worktrees', direct: true, runtime: true, needs: ['shared', 'history', 'forbids-comments'] },
});

export const REGISTRY_ENTRIES = {
  ...family('operations', 1, 'json', { text: 2400, json: 2400 }, 'ceiling', sampleEntry),
  reserveBytes: 2048,
};

const registryEntry = Schema.Struct({
  id: Schema.String,
  meaning: Schema.String,
  grammar: Schema.optional(Schema.String),
  refusals: Schema.Array(Schema.String),
  input: Schema.Record(Schema.String, Schema.Unknown),
  mutates: Schema.Boolean,
  place: Schema.optional(Schema.Literal(true)),
  negative: Schema.Boolean,
  intent: Schema.optional(Schema.Literal('destructive')),
  confirmLabel: Schema.String,
  doors: Schema.Array(Schema.Literals(['http', 'mcp', 'socket'])),
  callers: Schema.Literals(['any', 'operator', 'thread']),
  approval: Schema.Struct({
    asksFrom: Schema.String,
    timeoutMs: Schema.NullOr(Schema.Number),
    why: Schema.optional(Schema.String),
    conditions: Schema.Array(
      Schema.Struct({ id: Schema.String, label: Schema.String, asksFrom: Schema.String, timeoutMs: Schema.NullOr(Schema.Number) }),
    ),
  }),
  tool: Schema.optional(
    Schema.Struct({
      capability: Schema.String.check(Schema.isMinLength(1)),
      needs: Schema.optional(Schema.Array(Schema.Literals(AGENT_NEEDS))),
      direct: Schema.optional(Schema.Literal(true)),
      runtime: Schema.optional(Schema.Literal(true)),
      companions: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});

const operationsAnswer = arms({
  ok: {
    contract: Schema.String,
    operations: Schema.Struct({
      rows: Schema.Array(registryEntry),
      shown: Schema.Int,
      total: Schema.Int,
      next: Schema.NullOr(Schema.String),
      complete: Schema.Boolean,
    }),
    unknown: Schema.Array(Schema.String),
  },
});

export const INVOCATION_OPERATIONS = {
  read_operations: operation('read_operations', {
    approval: ASKS_NEVER,
    effect: 'read',
    identity: 'none',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    doors: { http: 'perform' },
    tool: undefined,
    callers: 'any',
    answer: operationsAnswer,
    meaning: "Read this server's operation registry: each operation with what it means, the input it takes and the doors it is offered at.",
    grammar:
      '`contract` digests the whole registry: the same value rides every HTTP answer as `Tagma-Contract`, so a client that cached this reading reads it again only when that header moves. Rows come in id order; `ids` narrows them to the operations named, and `unknown` lists the names that are no operation of this server.',
    input: Schema.Struct({
      ids: Schema.optional(
        Schema.Array(Schema.String.check(Schema.isMinLength(1))).annotate({
          description: 'Answer only these operations, each named by its id; absent, every operation.',
        }),
      ),
      limit: limitOf(REGISTRY_ENTRIES),
      cursor: PAGE_CURSOR,
    }),
    refusals: ['bad-cursor', 'cursor-stale'],
    subjects: () => [],
    confirmation: () => ({ summary: "Read this server's operations?" }),
    confirmLabel: 'Read operations',
    presentation: {
      running: 'Reading the operations',
      done: 'Read the operations',
      many: (count) => `Read the operations ${count} times`,
    },
  }),
};

export type InvocationOperationId = keyof typeof INVOCATION_OPERATIONS;

export const INVOCATION_OPERATION_IDS: readonly InvocationOperationId[] = ['read_operations'];
