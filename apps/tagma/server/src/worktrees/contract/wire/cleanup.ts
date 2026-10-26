import * as Schema from 'effect/Schema';
import { EndedExecution } from '../../../executions/contract/wire/rootExecutions.js';
import { FinishRefusalRow } from './failures.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { WorktreeHue } from './rows.js';

export const CLEANUP_IDLE_DAYS = 14;

export const CleanupReason = Schema.Literals(['merged', 'missing', 'idle']);
export type CleanupReason = typeof CleanupReason.Type;

export const CleanupBlocker = Schema.Struct({
  kind: Schema.Literals(['agent-running', 'uncommitted', 'unpushed', 'unread', 'merge-waiting']),
  count: Schema.Int,
});
export type CleanupBlocker = typeof CleanupBlocker.Type;

export const CleanupCandidate = Schema.Struct({
  rootId: RootId,
  name: Schema.NonEmptyString,
  folder: Schema.NonEmptyString,
  branch: Schema.NullOr(Schema.NonEmptyString),
  hue: Schema.NullOr(WorktreeHue),
  reason: CleanupReason,
  idleDays: Schema.Int,
  blockers: Schema.Array(CleanupBlocker),
});
export type CleanupCandidate = typeof CleanupCandidate.Type;

export const WorktreeCleanupAnswer = Schema.Struct({
  idleAfterDays: Schema.Int,
  candidates: Schema.Array(CleanupCandidate),
  shown: Schema.Int,
  total: Schema.Int,
  next: Schema.NullOr(Schema.String),
  complete: Schema.Boolean,
});
export type WorktreeCleanupAnswer = typeof WorktreeCleanupAnswer.Type;

export const CleanedWorktree = Schema.Struct({
  rootId: RootId,
  name: Schema.NullOr(Schema.NonEmptyString),
  outcome: Schema.Literals(['deleted', 'branch-kept', 'refused']),
  refusal: Schema.NullOr(FinishRefusalRow),
  ended: Schema.Array(EndedExecution),
});
export type CleanedWorktree = typeof CleanedWorktree.Type;

export const WorktreesCleaned = Schema.Struct({
  worktrees: Schema.Array(CleanedWorktree),
});
export type WorktreesCleaned = typeof WorktreesCleaned.Type;
