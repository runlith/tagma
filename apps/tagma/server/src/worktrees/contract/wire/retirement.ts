import * as Schema from 'effect/Schema';
import { EndedExecution } from '../../../executions/contract/wire/rootExecutions.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';

export const ThreadKept = Schema.Struct({ threadId: Schema.NonEmptyString, reason: Schema.String });

export const WorktreeThreads = Schema.Struct({
  moved: Schema.Array(Schema.NonEmptyString),
  kept: Schema.Array(ThreadKept),
});
export type WorktreeThreads = typeof WorktreeThreads.Type;

export const BranchCommit = Schema.Struct({ sha: Schema.NonEmptyString, subject: Schema.String });
export type BranchCommit = typeof BranchCommit.Type;

export const WorktreeDeleted = Schema.Struct({
  rootId: RootId,
  name: Schema.NonEmptyString,
  committed: Schema.NullOr(
    Schema.Struct({
      commit: Schema.NonEmptyString,
      paths: Schema.Array(Schema.NonEmptyString),
      holders: Schema.Array(Schema.NonEmptyString),
    }),
  ),
  removed: Schema.Boolean,
  threads: WorktreeThreads,
  ended: Schema.Array(EndedExecution),
  branch: Schema.Union([
    Schema.Struct({ status: Schema.Literal('deleted'), name: Schema.NonEmptyString }),
    Schema.Struct({
      status: Schema.Literal('kept'),
      name: Schema.NullOr(Schema.NonEmptyString),
      reason: Schema.String,
      commits: Schema.Array(BranchCommit),
    }),
  ]),
});
export type WorktreeDeleted = typeof WorktreeDeleted.Type;

export const WorktreeUpdateHanded = Schema.Struct({
  rootId: RootId,
  threadId: Schema.NonEmptyString,
  base: Schema.NonEmptyString,
  envelopeId: Schema.NonEmptyString,
  delivery: Schema.Literals(['delivered', 'queued', 'woken', 'stored']),
});
export type WorktreeUpdateHanded = typeof WorktreeUpdateHanded.Type;
