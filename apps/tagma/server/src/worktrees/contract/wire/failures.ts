import type { RequestKey } from '../../../platform/contract/wire/ids.js';
import { Data } from 'effect';
import * as Schema from 'effect/Schema';
import type { Unblock } from '../../../platform/contract/wire/refusal.js';
import type { ProjectRootFailure } from '../../../workspace/contract/wire/coverage.js';
import type { RepositoryFailure } from '../../../workspace/contract/wire/repositories.js';
import type { RootResolutionFailure } from '../../../workspace/contract/wire/roots.js';

export const WORKTREE_REFUSALS = [
  'changed-payload',
  'relative-path',
  'parent-missing',
  'destination-occupied',
  'destination-reserved',
  'ref-reserved',
  'ref-occupied',
  'ref-missing',
  'base-absent',
  'foreign-namespace',
  'foreign-environment',
  'foreign-project',
  'settled',
  'abandoned',
  'unreconciled',
  'observed-changed',
  'unreserved',
  'stale-revision',
  'observed-mismatch',
] as const;

export class WorktreeRefused extends Data.TaggedError('WorktreeRefused')<{
  readonly operationId: RequestKey;
  readonly reason: (typeof WORKTREE_REFUSALS)[number];
  readonly message: string;
}> {}

export class WorktreeMissing extends Data.TaggedError('WorktreeMissing')<{
  readonly operationId: RequestKey;
  readonly message: string;
}> {}

export class WorktreeUnavailable extends Data.TaggedError('WorktreeUnavailable')<{
  readonly operationId?: RequestKey | undefined;
  readonly reason: 'storage' | 'filesystem' | 'git';
  readonly message: string;
}> {}

export type WorktreeFailure = WorktreeRefused | WorktreeMissing | WorktreeUnavailable | RepositoryFailure | RootResolutionFailure;

export const FINISH_REASONS = [
  'not-found',
  'folder-missing',
  'agent-running',
  'own-worktree',
  'root-in-use',
  'uncommitted',
  'operation-in-progress',
  'no-branch',
  'no-base-branch',
  'base-not-checked-out',
  'base-mid-operation',
  'base-staged',
  'base-held',
  'base-dirty',
  'source-held',
  'source-dirty',
  'merge-conflicts',
  'already-merged',
  'rebase-merges',
  'rule-violated',
  'inspection-failed',
  'module-map-invalid',
  'no-remote',
  'no-gh',
  'gh-refused',
  'no-lead-thread',
  'not-pending',
  'name-invalid',
  'name-taken',
  'name-unchanged',
  'off-branch',
  'git-refused',
  'git-unreadable',
  'git-incomplete',
  'git-not-admitted',
  'finishing-busy',
  'finishing-cut',
  'commit-unsigned',
] as const;
export type FinishReason = (typeof FINISH_REASONS)[number];

export const FinishRefusalRow = Schema.Struct({
  code: Schema.NonEmptyString,
  message: Schema.String,
  unblock: Schema.Array(Schema.String),
});
export type FinishRefusalRow = typeof FinishRefusalRow.Type;

export class WorktreeFinishRefused extends Data.TaggedError('WorktreeFinishRefused')<{
  readonly reason: FinishReason;
  readonly message: string;
  readonly unblock: Unblock;
}> {}

export type FinishFailure = WorktreeFinishRefused | WorktreeUnavailable | RootResolutionFailure | ProjectRootFailure | RepositoryFailure;
