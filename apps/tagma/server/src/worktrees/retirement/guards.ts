import { Effect, FileSystem } from 'effect';
import { headAt, type GitAnswerInvalid, type GitRefused, type GitUnreadable } from '@runlith/git/repository';
import { Git } from '@runlith/git/Git';
import { actingGit } from '../../platform/git/ownGit.js';
import { RequestKey } from '../../platform/contract/wire/ids.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { ProjectRoot, ProjectRootFailure } from '../../workspace/contract/wire/coverage.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { Repositories } from '../../workspace/contract/service/repositories.js';
import { RootUses } from '../../workspace/contract/service/roots.js';
import { HEADS, UNCOMMITTED, type FinishingGuards, WorktreeThreads } from '../contract/service/finishingGate.js';
import { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { FOLDER_DIRTY } from '../contract/wire/operations/retirement.js';
import { WorktreeIntents } from '../contract/service/intents.js';
import { type WorktreeRecord, WorktreeRecords } from '../contract/service/worktrees.js';
import { WorktreeFinishRefused, WorktreeUnavailable, type FinishFailure } from '../contract/wire/failures.js';
import { gitFailed, ownWork, pathsOf, refused, runningWords, stored } from './finishing.js';

type GitFailure = GitUnreadable | GitRefused | GitAnswerInvalid;

export const makeFinishingGuards = Effect.fnUntraced(function* (input: {
  readonly covered: (projectId: number) => Effect.Effect<readonly ProjectRoot[], ProjectRootFailure>;
}) {
  const { covered } = input;
  const git = actingGit(yield* Git, 'worktree-finishing');
  const files = yield* FileSystem.FileSystem;
  const units = yield* MachineUnits;
  const records = yield* WorktreeRecords;
  const intents = yield* WorktreeIntents;
  const uses = yield* RootUses;
  const repositories = yield* Repositories;
  const threads = yield* WorktreeThreads;
  const checkouts = yield* CheckoutRows;

  const recorded = Effect.fnUntraced(function* (projectId: number, rootId: RootId): Effect.fn.Return<WorktreeRecord, FinishFailure> {
    const record = yield* stored(units.read((unit) => records.byRoot(rootId, unit)));
    if (record === null || record.projectId !== projectId) {
      return yield* refused(
        'not-found',
        `no worktree Tagma made stands at ${rootId} in this project; main and checkouts Tagma did not make are not finished here`,
        ["read this project's worktrees: list_worktrees"],
      );
    }
    return record;
  });

  const present = (path: string): Effect.Effect<boolean, WorktreeUnavailable> =>
    Effect.mapError(files.exists(path), (failure) => new WorktreeUnavailable({ reason: 'filesystem', message: failure.message }));

  const working: FinishingGuards['working'] = (projectId, rootId, asking) =>
    Effect.flatMap(threads.live(projectId), (live) => {
      const standing = live.filter((one) => one.rootId === rootId && !one.cleared);
      return asking !== null && standing.some((one) => one.threadId === asking)
        ? refused(
            'own-worktree',
            `the calling thread ${asking} stands in this worktree, and removing it would pull the folder from under the thread that asks`,
            ['move this thread out first (move_thread), then act again', 'the operator deletes it, or a thread standing elsewhere does'],
          )
        : Effect.succeed(standing.filter((one) => one.live));
    });

  const holders: FinishingGuards['holders'] = (rootId) => stored(units.read((unit) => uses.holding(unit, [rootId])));

  const leftovers = Effect.fn('FinishingGuards.leftovers')(function* (
    projectId: number,
    rootId: RootId,
  ): Effect.fn.Return<number, FinishFailure> {
    const record = yield* recorded(projectId, rootId);
    if (!(yield* present(record.path))) return 0;
    const tree = yield* checkouts.read(rootId);
    return new Set(pathsOf(tree, UNCOMMITTED).flatMap((entry) => (ownWork(entry.path) ? [entry.path] : []))).size;
  });

  const baseCheckout = Effect.fn('FinishingGuards.baseCheckout')(function* (
    projectId: number,
    baseBranch: string,
    except: RootId,
  ): Effect.fn.Return<{ readonly root: ProjectRoot }, FinishFailure> {
    const roots = (yield* covered(projectId)).filter((root) => root.rootId !== except);
    const ordered = [...roots.filter((root) => root.origin === 'canonical'), ...roots.filter((root) => root.origin !== 'canonical')];
    let unread: GitFailure | null = null;
    for (const root of ordered) {
      const head = yield* Effect.result(headAt(git, root.path));
      if (head._tag === 'Failure') {
        unread ??= head.failure;
        continue;
      }
      if (head.success.ref === `${HEADS}${baseBranch}`) return { root };
    }
    if (unread !== null) return yield* Effect.fail(gitFailed(unread));
    return yield* refused('base-not-checked-out', `no checkout this project covers stands on ${baseBranch}`, [
      `check out ${baseBranch} in the project's main checkout, then merge`,
      'open a pull request instead: open_worktree_pr',
    ]);
  });

  const operationOf = Effect.fnUntraced(function* (record: WorktreeRecord) {
    const operation = yield* stored(intents.byId(RequestKey.make(record.origin)));
    if (operation === null) {
      return yield* new WorktreeUnavailable({
        reason: 'storage',
        message: `the creation ${record.origin} that made ${record.name} is no longer recorded`,
      });
    }
    return operation;
  });

  const guards: FinishingGuards = {
    recorded,
    present,
    stands: (record) =>
      Effect.flatMap(present(record.path), (here) =>
        here
          ? Effect.void
          : refused('folder-missing', `the folder of ${record.name}, ${record.path}, no longer stands`, [
              'delete the worktree: delete_worktree',
            ]),
      ),
    branchOf: (record) =>
      record.branch === null
        ? refused('no-branch', `${record.name} stands on no branch`, ['check out a branch in the worktree, or finish it by hand'])
        : Effect.succeed(record.branch),
    baseOf: (record) =>
      record.baseBranch === null
        ? refused('no-base-branch', `${record.name} records no base branch, only the commit ${record.baseCommit} it was cut from`, [
            'open a pull request against a branch you name, or merge by hand',
          ])
        : Effect.succeed(record.baseBranch),
    working,
    retiring: Effect.fn('FinishingGuards.retiring')(function* (projectId, rootId, asking) {
      const busy = yield* working(projectId, rootId, asking);
      const held = yield* holders(rootId);
      const left = yield* leftovers(projectId, rootId);
      return [
        ...(left === 0
          ? []
          : [
              {
                condition: FOLDER_DIRTY.id,
                fact: `${left} uncommitted ${left === 1 ? 'path is' : 'paths are'} committed onto the branch, then the folder is removed`,
              },
            ]),
        ...(busy.length === 0 ? [] : [{ condition: 'agent-running', fact: `${runningWords(busy)}: stopped before the folder is removed` }]),
        ...(held.length === 0
          ? []
          : [
              {
                condition: 'root-in-use',
                fact: `${held.map((use) => `${use.consumer.kind} ${use.consumer.id}`).join(', ')} still ${held.length === 1 ? 'holds' : 'hold'} this worktree: ended before the folder is removed`,
              },
            ]),
      ];
    }),
    quiet: Effect.fn('FinishingGuards.quiet')(function* (projectId, rootId) {
      for (const one of yield* working(projectId, rootId, null)) {
        yield* Effect.mapError(
          threads.stop(projectId, one.threadId),
          (issue) =>
            new WorktreeFinishRefused({
              reason: 'finishing-busy',
              message: `${one.threadId} could not be stopped: ${issue.message}`,
              unblock: ['stop it (stop_agent), then act again'],
            }),
        );
      }
    }),
    holders,
    baseCheckout,
    placeOf: Effect.fnUntraced(function* (projectId: number, rootId: RootId, withBase: boolean) {
      const record = yield* recorded(projectId, rootId);
      if (!withBase || record.baseBranch === null) return { folder: record.path, base: null };
      const base = yield* baseCheckout(projectId, record.baseBranch, rootId);
      return { folder: record.path, base: base.root.path };
    }),
    operationOf,
    commonOf: Effect.fnUntraced(function* (record: WorktreeRecord) {
      const operation = yield* operationOf(record);
      const standing = yield* repositories.read(operation.repository.repositoryId);
      return standing.repository.commonDirectory;
    }),
  };
  return guards;
});
