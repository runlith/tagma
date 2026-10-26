import { Schema } from 'effect';
import { THREAD_QUERY_OPS, THREAD_QUERY_SOURCES } from '@runlith/agent/protocol/threadQuery';
import { threadSelectionQuerySchema } from './selection.js';
import type { ThreadTitleAnswer } from './titles.js';
import type { ThreadListPage } from './list.js';
import type { ConversationWindow } from './conversation.js';
import type { EvidenceAnswer, ExpandedRecord, RolloutRepair, ThreadFacts, ThreadRolloutDisagreement, ThreadShape } from './evidence.js';

export const evidencePredicateSchema = Schema.Struct({
  field: Schema.String.check(Schema.isMinLength(1)),
  op: Schema.Literals(THREAD_QUERY_OPS),
  value: Schema.optional(Schema.Unknown),
});

const queryLiteral = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]);

export const threadQuerySchema = Schema.Struct({
  select: Schema.Literals(THREAD_QUERY_SOURCES),
  where: Schema.optional(
    Schema.Array(
      Schema.Struct({
        field: Schema.String.check(Schema.isMinLength(1)),
        op: Schema.Literals(THREAD_QUERY_OPS),
        value: Schema.optional(Schema.Union([queryLiteral, Schema.Array(queryLiteral)])),
      }),
    ),
  ),
  fields: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  group: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  count: Schema.optional(Schema.Boolean),
  sum: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  order: Schema.optional(Schema.Struct({ by: Schema.String.check(Schema.isMinLength(1)), dir: Schema.Literals(['asc', 'desc']) })),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});

export const evidenceInputSchema = Schema.Struct({
  select: Schema.Literals(THREAD_QUERY_SOURCES),
  threads: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  selection: Schema.optional(threadSelectionQuerySchema),
  where: Schema.optional(Schema.Array(evidencePredicateSchema)),
  fields: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  group: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  count: Schema.optional(Schema.Boolean),
  sum: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  order: Schema.optional(Schema.Struct({ by: Schema.String.check(Schema.isMinLength(1)), dir: Schema.Literals(['asc', 'desc']) })),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  cursor: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
});
export type EvidenceInput = typeof evidenceInputSchema.Type;

export type EvidenceQueryTerms = Omit<EvidenceInput, 'threads' | 'selection' | 'cursor'>;

export const expandRequestSchema = Schema.Struct({
  at: Schema.Array(
    Schema.Struct({
      threadId: Schema.String.check(Schema.isMinLength(1)),
      at: Schema.Union([Schema.Int.check(Schema.isGreaterThan(0)), Schema.String.check(Schema.isMinLength(1))]),
    }),
  ),
  fields: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  around: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type ExpandRequest = typeof expandRequestSchema.Type;

export type ThreadHeldUp = { readonly threadId: string; readonly runId: string };

export type ThreadToolAnswer =
  | (ThreadListPage & { readonly status: 'rows' })
  | {
      readonly status: 'ok';
      readonly threads: readonly ThreadFacts[];
      readonly total: number;
      readonly cursor: string | null;
      readonly set: 'live' | 'archived' | 'all';
    }
  | { readonly status: 'ok'; readonly shape: ThreadShape }
  | { readonly status: 'ok'; readonly evidence: EvidenceAnswer }
  | { readonly status: 'ok'; readonly expanded: readonly ExpandedRecord[] }
  | { readonly status: 'conversation'; readonly windows: readonly ConversationWindow[] }
  | { readonly status: 'ok'; readonly rollout: ThreadRolloutDisagreement }
  | { readonly status: 'ok'; readonly repaired: RolloutRepair }
  | { readonly status: 'started'; readonly runId: string }
  | { readonly status: 'already-running'; readonly runId: string }
  | { readonly status: 'archived'; readonly threadId: string }
  | { readonly status: 'unarchived'; readonly threadId: string }
  | { readonly status: 'deleted'; readonly threadId: string }
  | { readonly status: 'pinned'; readonly threadId: string }
  | { readonly status: 'unpinned'; readonly threadId: string }
  | (ThreadTitleAnswer & {
      readonly status: ThreadTitleAnswer['outcome'];
      readonly threadId: string;
    })
  | { readonly status: 'swept'; readonly moved: readonly string[]; readonly working: readonly ThreadHeldUp[] }
  | { readonly status: 'restored'; readonly moved: readonly string[]; readonly working: readonly ThreadHeldUp[] }
  | { readonly status: 'answered'; readonly threadId: string; readonly value: string; readonly runId: string }
  | { readonly status: 'cancelled'; readonly threadId: string; readonly runId: string }
  | {
      readonly status: 'switched';
      readonly delegation: 'on' | 'off';
      readonly threadId: string;
      readonly own: boolean;
      readonly decidedBy: string;
    }
  | { readonly status: 'refused'; readonly code: string; readonly reason: string; readonly unblock: readonly string[] };
