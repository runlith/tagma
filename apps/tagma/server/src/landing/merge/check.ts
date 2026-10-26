import { Effect } from 'effect';
import type { MergeGit } from '../contract/service/mergeGit.js';
import type { GraphChanges } from '../../graph/contract/wire/branchChanges.js';
import type { BranchGraphChanges } from '../contract/service/graphChanges.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { FinishFailure } from '../../worktrees/contract/wire/failures.js';
import type { MergeChecks } from '../../worktrees/contract/service/mergeChecks.js';
import { asked } from '../../worktrees/retirement/finishing.js';
import { type FinishingGuards, HEADS } from '../../worktrees/contract/service/finishingGate.js';
import type { MergeReading } from '../contract/wire/merge.js';

export const checkMerge = (
  git: MergeGit['Service'],
  guards: FinishingGuards,
  checks: MergeChecks,
  graphChanges: BranchGraphChanges | undefined,
) =>
  Effect.fn('Merges.checkMerge')(function* (projectId: number, rootId: RootId): Effect.fn.Return<MergeReading, FinishFailure> {
    const record = yield* guards.recorded(projectId, rootId);
    const unknown = (reason: string): MergeReading => ({
      rootId,
      check: 'unknown',
      base: null,
      tip: null,
      conflicts: [],
      yielded: [],
      reason,
      graph: { status: 'unread', reason },
    });
    if (record.baseBranch === null) return unknown('this worktree records no base branch to merge into');
    if (!(yield* guards.present(record.path))) return unknown('the folder of this worktree no longer stands');
    const tip = (yield* git.head(record.path)).commit;
    const base = yield* git.resolve(record.path, `${HEADS}${record.baseBranch}`);
    if (tip === null || base === null) return unknown('the branch or its base names no commit');
    const checked = yield* asked(checks.check(record.path, base, tip));
    const graph: GraphChanges =
      record.branch === null
        ? { status: 'unread', reason: 'this worktree stands on no branch' }
        : graphChanges === undefined
          ? { status: 'unread', reason: 'this server reads no graph changes' }
          : yield* graphChanges(projectId, { checkout: record.path, branch: record.branch, base: record.baseBranch });
    return {
      rootId,
      check: checked.conflicts.length > 0 ? 'conflicts' : 'clean',
      base: { branch: record.baseBranch, tip: base },
      tip,
      conflicts: checked.conflicts,
      yielded: checked.yielded,
      reason: null,
      graph,
    };
  });
