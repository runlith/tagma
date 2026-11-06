import * as Schema from 'effect/Schema';
import { LandingUnjudged, RuleBodies, Watched } from '../../../enforcement/contract/wire/enforcement.js';
import { FinishRefusalRow } from '../../../worktrees/contract/wire/failures.js';
import { MergeAfter, MergeMode, PendingMerge } from '../../../worktrees/contract/wire/mergeTypes.js';
import { MergeCheck } from '../../../worktrees/contract/wire/rows.js';
import { MergedAfter } from '../../../worktrees/contract/wire/entries.js';
import { WorktreeDeleted } from '../../../worktrees/contract/wire/retirement.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { GraphChanges } from '../../../graph/contract/wire/branchChanges.js';
import { GraphSync, HOOK_FIELDS } from './receipt.js';

export const MERGE_TRAILER = 'Tagma-Worktree';

export const MergeReading = Schema.Struct({
  rootId: RootId,
  check: MergeCheck,
  base: Schema.NullOr(Schema.Struct({ branch: Schema.NonEmptyString, tip: Schema.NonEmptyString })),
  tip: Schema.NullOr(Schema.NonEmptyString),
  conflicts: Schema.Array(Schema.NonEmptyString),
  yielded: Schema.Array(Schema.NonEmptyString),
  reason: Schema.NullOr(Schema.String),
  graph: GraphChanges,
});
export type MergeReading = typeof MergeReading.Type;

export const WorktreePullRequest = Schema.Struct({
  rootId: RootId,
  remote: Schema.NonEmptyString,
  branch: Schema.NonEmptyString,
  base: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  opened: Schema.Boolean,
  uncommitted: Schema.Int,
});
export type WorktreePullRequest = typeof WorktreePullRequest.Type;

export const AfterMerged = Schema.Struct({
  act: MergeAfter,
  deleted: Schema.NullOr(WorktreeDeleted),
  refusal: Schema.NullOr(FinishRefusalRow),
});
export type AfterMerged = typeof AfterMerged.Type;

export const MergeReceipt = Schema.Struct({
  rootId: RootId,
  commit: Schema.NonEmptyString,
  name: Schema.String,
  branch: Schema.NonEmptyString,
  base: Schema.NonEmptyString,
  mode: MergeMode,
  waitedSince: Schema.NullOr(Schema.String),
  after: MergedAfter,
  addressees: Schema.Array(Schema.String),
  at: Schema.String,
});
export type MergeReceipt = typeof MergeReceipt.Type;

export const WorktreeMerged = Schema.Struct({
  rootId: RootId,
  mode: MergeMode,
  base: Schema.Struct({ rootId: RootId, branch: Schema.NonEmptyString, head: Schema.NonEmptyString }),
  branch: Schema.Struct({ name: Schema.NonEmptyString, head: Schema.NonEmptyString }),
  graph: GraphSync,
  after: AfterMerged,
  waited: Schema.NullOr(Schema.Struct({ queuedAt: Schema.String, attempts: Schema.Int })),
  watched: Schema.optional(Schema.Array(Watched)),
  bodies: Schema.optional(RuleBodies),
  unjudged: Schema.optional(Schema.Array(LandingUnjudged)),
  unsynced: Schema.optional(Schema.Struct({ paths: Schema.Array(Schema.String), reason: Schema.String })),
  unrecorded: Schema.optional(Schema.String),
  yielded: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  ...HOOK_FIELDS,
});
export type WorktreeMerged = typeof WorktreeMerged.Type;

export const WorktreeMergeQueued = Schema.Struct({ rootId: RootId, queued: PendingMerge });
export type WorktreeMergeQueued = typeof WorktreeMergeQueued.Type;

export const WorktreeMergeAnswer = Schema.Union([WorktreeMerged, WorktreeMergeQueued]);
export type WorktreeMergeAnswer = typeof WorktreeMergeAnswer.Type;

export const WorktreeMergeCancelled = Schema.Struct({ rootId: RootId, cancelled: PendingMerge });
export type WorktreeMergeCancelled = typeof WorktreeMergeCancelled.Type;
