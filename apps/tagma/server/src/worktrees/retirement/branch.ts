import { Effect } from 'effect';
import { troubleOf } from '@runlith/git/repository';
import { BranchRefs, BranchRefsUnavailable } from '../contract/service/refs.js';
import { GRAPH_COMMIT_PATTERN } from '../../graph/contract/wire/storage.js';
import type { WorktreeDeleted } from '../contract/wire/retirement.js';
import type { ActProgress } from '../contract/service/progress.js';
import type { MergeChecks } from '../contract/service/mergeChecks.js';
import type { WorktreeRecord } from '../contract/service/worktrees.js';
import { type FinishingGuards, HEADS } from '../contract/service/finishingGate.js';
import { ownWork } from './finishing.js';

type Branch = WorktreeDeleted['branch'];

const COMMITS_SHOWN = 50;

export type BranchDeletion = { readonly remove: (record: WorktreeRecord) => Effect.Effect<Branch> };

export const makeBranchDeletion = Effect.fnUntraced(function* (input: {
  readonly guards: FinishingGuards;
  readonly checks: MergeChecks;
  readonly progress: ActProgress;
}) {
  const { guards, checks, progress } = input;
  const refs = yield* BranchRefs;

  const judged = Effect.fnUntraced(function* (common: string, record: WorktreeRecord, name: string) {
    const tip = yield* refs.commit(common, `${HEADS}${name}`);
    if (tip === null) return { status: 'deleted', name } satisfies Branch;
    const baseName = record.baseBranch ?? record.baseCommit;
    const base = yield* refs.commit(common, record.baseBranch === null ? record.baseCommit : `${HEADS}${record.baseBranch}`);
    if (base === null) return { status: 'kept', name, reason: `its base ${baseName} no longer stands`, commits: [] } satisfies Branch;
    const merged = yield* checks
      .fresh(common, base, tip)
      .pipe(Effect.mapError((failure) => new BranchRefsUnavailable({ message: troubleOf(failure) })));
    const conflicts = merged.conflicts.filter(ownWork);
    const work = conflicts.length > 0 ? conflicts : (yield* refs.changes(common, base, merged.tree)).filter(ownWork);
    if (work.length === 0) {
      yield* refs.remove(common, name);
      return { status: 'deleted', name } satisfies Branch;
    }
    const commits = yield* refs.commits(common, {
      base,
      tip,
      limit: COMMITS_SHOWN,
      excludeSubject: GRAPH_COMMIT_PATTERN,
    });
    const paths = `${work.length} ${work.length === 1 ? 'path' : 'paths'}`;
    return {
      status: 'kept',
      name,
      reason:
        conflicts.length > 0
          ? `merging ${name} into ${baseName} would conflict on ${paths}`
          : `merging ${name} would change ${paths} in ${baseName}`,
      commits: commits.map(({ sha, subject }) => ({ sha, subject })),
    } satisfies Branch;
  });

  const judging = Effect.fnUntraced(function* (record: WorktreeRecord, name: string) {
    const operation = yield* guards.operationOf(record);
    if (operation.mode.kind !== 'new-branch') {
      return { status: 'kept', name, reason: 'Tagma did not create this branch', commits: [] } satisfies Branch;
    }
    const common = yield* guards.commonOf(record);
    yield* progress.phase(record.rootId, 'deleting-branch');
    return yield* Effect.mapError(judged(common, record, name), (failure) => ({ message: failure.message }));
  });

  const deletion: BranchDeletion = {
    remove: Effect.fn('BranchDeletion.remove')(function* (record: WorktreeRecord): Effect.fn.Return<Branch> {
      const name = record.branch;
      if (name === null) return { status: 'kept', name, reason: 'this worktree stood on no branch', commits: [] };
      const outcome = yield* Effect.result(judging(record, name));
      if (outcome._tag === 'Success') return outcome.success;
      yield* Effect.logWarning('the branch of a deleted worktree could not be judged, so it stays', {
        rootId: record.rootId,
        reason: outcome.failure.message,
      });
      return { status: 'kept', name, reason: `whether it holds work could not be read: ${outcome.failure.message}`, commits: [] };
    }),
  };
  return deletion;
});
