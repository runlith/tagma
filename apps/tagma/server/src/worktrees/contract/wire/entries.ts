import * as Schema from 'effect/Schema';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { MergeAfter, MergeMode } from './mergeTypes.js';
import { WorktreeSetupStatus, WorktreeSetupStep } from './rows.js';

export const WORKTREE_ENTRY = 'worktree';

export const MergedAfter = Schema.Struct({
  act: MergeAfter,
  outcome: Schema.Literals(['done', 'branch-kept', 'refused']),
  reason: Schema.NullOr(Schema.String),
});
export type MergedAfter = typeof MergedAfter.Type;

export const WorktreeEntry = Schema.Union([
  Schema.Struct({
    type: Schema.Literal(WORKTREE_ENTRY),
    id: Schema.NonEmptyString,
    event: Schema.Literal('created'),
    rootId: Schema.NonEmptyString,
    name: Schema.NonEmptyString,
    branch: Schema.NullOr(Schema.NonEmptyString),
    occurredAt: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal(WORKTREE_ENTRY),
    id: Schema.NonEmptyString,
    event: Schema.Literal('setup'),
    rootId: Schema.NonEmptyString,
    setup: WorktreeSetupStatus,
    step: Schema.NullOr(WorktreeSetupStep),
    execution: Schema.NullOr(ExecutionRef),
    reason: Schema.NullOr(Schema.String),
    occurredAt: Schema.String,
    updatedAt: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal(WORKTREE_ENTRY),
    id: Schema.NonEmptyString,
    event: Schema.Literal('moved'),
    rootId: Schema.NonEmptyString,
    occurredAt: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal(WORKTREE_ENTRY),
    id: Schema.NonEmptyString,
    event: Schema.Literal('merged'),
    rootId: Schema.NonEmptyString,
    name: Schema.NonEmptyString,
    branch: Schema.NonEmptyString,
    base: Schema.NonEmptyString,
    mode: MergeMode,
    commit: Schema.NonEmptyString,
    waitedSince: Schema.optional(Schema.String),
    after: Schema.optional(MergedAfter),
    occurredAt: Schema.String,
  }),
]).pipe(Schema.toTaggedUnion('event'));
export type WorktreeEntry = typeof WorktreeEntry.Type;

export const worktreeEntryIds = {
  created: (rootId: string): string => `worktree-created:${rootId}`,
  setup: (rootId: string): string => `worktree-setup:${rootId}`,
  moved: (operationKey: string): string => `worktree-moved:${operationKey}`,
  merged: (rootId: string, commit: string): string => `worktree-merged:${rootId}:${commit}`,
} as const;
