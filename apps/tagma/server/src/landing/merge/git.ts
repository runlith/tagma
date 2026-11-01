import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { Git } from '@runlith/git/Git';
import { ancestorAt } from '@runlith/git/history';
import { changedBetween } from '@runlith/git/entries';
import { commitMetaAt, replayAt } from '@runlith/git/merge';
import { abortAt, mergingAt, pushAt } from '@runlith/git/porcelain';
import { commitOf, headAt, locationsAt, publishRemoteAt } from '@runlith/git/repository';
import type { HoldCut, HoldStalled, ReentrantCall } from '@runlith/held/failures';
import { actingGit, configuredGit, gitAnswer, type OwnGitFailed, quietGit, runGit } from '../../platform/git/ownGit.js';
import { indexPath, indexWrites } from '../../platform/git/index.js';
import { headRef } from '../../platform/git/publish.js';
import { openOperation, placesOf, standingOf } from '../../platform/git/places.js';
import { ChangeRecord } from '../../change-record/contract/service/record.js';
import { LineWrites } from '../../change-record/contract/service/lineWrites.js';
import { CommitTrees } from '../../workspace/contract/service/commitTrees.js';
import { WorkingOrigins } from '../../workspace/contract/service/places.js';
import { keptUpstream } from '../../workspace/repositories/pushName.js';
import { WorktreeFinishRefused, WorktreeUnavailable } from '../../worktrees/contract/wire/failures.js';
import { asked, finishNotAdmitted, refused } from '../../worktrees/retirement/finishing.js';
import { MergeGit, MergeHookRefused, type MergeCheckout, type MergeSettled, type MergeTaking } from '../contract/service/mergeGit.js';
import { MERGE_TRAILER } from '../contract/wire/merge.js';
import { commitConfig, commitHooks, landedHook, MERGING } from '../land/hooks.js';
import { LandingLanes } from '../land/lanes.js';
import { advanced, makeCommit } from '../land/publish.js';
import { bringCheckout } from '../land/bring.js';
import { carriedSafely, NOTHING_CARRIED } from '../land/reshaping.js';

const failed = (failure: OwnGitFailed): WorktreeFinishRefused =>
  failure.admission !== undefined
    ? finishNotAdmitted(failure.admission)
    : new WorktreeFinishRefused({
        reason: failure.ran ? 'git-refused' : 'git-unreadable',
        message: `${failure.op}: ${failure.message}`,
        unblock: ['read what git said above and clear it, then merge again'],
      });

const laneFailed = (failure: HoldStalled | HoldCut | ReentrantCall): Effect.Effect<never, HoldStalled | HoldCut> =>
  failure._tag === 'ReentrantCall' ? Effect.die(failure) : Effect.fail(failure);

export const makeMergeGit = Effect.gen(function* () {
  const git = yield* Git;
  const reading = actingGit(git, 'merge-read');
  const files = yield* FileSystem.FileSystem;
  const trees = yield* CommitTrees;
  const changes = yield* ChangeRecord;
  const origins = yield* WorkingOrigins;
  const writes = yield* LineWrites;
  const shaOf = (checkout: string, ref: string) =>
    Effect.map(quietGit(git, 'merge-ref', ['-C', checkout, 'rev-parse', '--verify', '-q', `${ref}^{commit}`]), (sha) => sha || null);
  const changedBy = Effect.fnUntraced(function* (checkout: string, base: string, commit: string) {
    const listed = yield* Effect.result(
      runGit(git, 'merge-changed', ['-C', checkout, 'diff-tree', '-r', '-z', '--name-only', '--no-renames', base, commit]),
    );
    if (listed._tag === 'Failure') {
      yield* Effect.logWarning('the paths a merge changed could not be listed', { checkout, reason: listed.failure.message });
      return [];
    }
    return listed.success.split('\0').filter((path) => path !== '');
  });
  const settle = (at: MergeCheckout): Effect.Effect<MergeSettled> => {
    const { checkout, ref, base, commit } = at;
    const unsynced = (reason: string) => Effect.map(changedBy(checkout, base, commit), (paths) => ({ unsynced: paths, reason }));
    const standing = Effect.gen(function* () {
      if ((yield* headRef(git, checkout)) !== ref) return `${checkout} no longer stands on ${ref}`;
      if ((yield* shaOf(checkout, ref)) !== commit) return `${ref} moved past ${commit}`;
      return null;
    });
    const brought = Effect.fnUntraced(function* (index: string) {
      const before = yield* standing;
      if (before !== null)
        return yield* unsynced(`${before} before ${checkout} was brought to the merge, so its files were left as they were`);
      const read = yield* bringCheckout(git, checkout, index, base, commit);
      if (read.failure !== null) return { unsynced: read.kept, reason: `git left ${checkout} as it was: ${read.failure}` };
      const after = yield* standing;
      if (after !== null)
        return yield* unsynced(
          `${after} while ${checkout} was brought to the merge, so its index and files hold the merge and not what the branch holds now`,
        );
      if (read.kept.length > 0)
        return {
          unsynced: read.kept,
          reason: `${read.kept.join(', ')} held uncommitted work in ${checkout}, so their files kept it, and every other path the merge wrote was brought to it`,
        } satisfies MergeSettled;
      return { unsynced: [], reason: null } satisfies MergeSettled;
    });
    return Effect.flatMap(
      Effect.result(Effect.flatMap(indexPath(git, checkout), (index) => indexWrites.hold(index, brought(index)))),
      (done) =>
        done._tag === 'Success'
          ? Effect.succeed(done.success)
          : unsynced(`${checkout} could not be brought to the merge: ${done.failure.message}`),
    );
  };
  const create = Effect.fnUntraced(function* (checkout: string, commit: Parameters<MergeGit['Service']['create']>[1]) {
    return yield* Effect.mapError(makeCommit(git, checkout, commit), (failure) =>
      failure._tag === 'GateRefusal'
        ? new WorktreeFinishRefused({ reason: 'commit-unsigned', message: failure.reason, unblock: failure.unblock })
        : failed(failure),
    );
  });
  const take = Effect.fnUntraced(function* (at: MergeTaking) {
    const { checkout, branch, baseBranch, tip } = at;
    const config = yield* Effect.mapError(commitConfig(git, checkout), failed);
    const commit = yield* create(checkout, {
      tree: at.tree,
      parents: [tip, at.baseTip],
      message: at.message,
      sign: config.sign,
    });
    const ref = `refs/heads/${branch}`;
    const lanes = yield* LandingLanes;
    const readTree = (index: string, op: string, args: readonly string[]) =>
      indexWrites.hold(
        index,
        Effect.gen(function* () {
          yield* gitAnswer(git, 'merge-take-refresh', ['-C', checkout, 'update-index', '-q', '--refresh']);
          yield* runGit(git, op, ['-C', checkout, 'read-tree', '-m', '-u', ...args]);
        }),
      );
    const moved = yield* lanes.commits
      .enter(
        checkout,
        Effect.gen(function* () {
          const { places, head } = yield* Effect.mapError(standingOf(git, checkout), failed);
          if (head.ref !== ref || head.commit !== tip) return true;
          const fits = yield* Effect.result(readTree(places.index, 'merge-take-fits', ['-n', tip, commit]));
          if (fits._tag === 'Failure') {
            if (fits.failure._tag !== 'OwnGitFailed') return yield* Effect.fail(fits.failure);
            return yield* refused(
              'source-dirty',
              `the merge takes ${baseBranch} into ${branch} first, because both changed the graph, and git would not bring the worktree to it: ${fits.failure.message}`,
              ['commit or discard the changes git names in the worktree, then merge'],
            );
          }
          return yield* Effect.uninterruptible(
            Effect.gen(function* () {
              const sent = yield* advanced(
                git,
                git,
                { root: checkout, places, ref, base: tip, job: `tagma merge: take ${baseBranch}` },
                commit,
              ).pipe(
                Effect.catchTags({
                  OwnGitFailed: (failure) => Effect.fail(failed(failure)),
                  GateRefusal: (failure) => refused('operation-in-progress', failure.reason, failure.unblock),
                }),
              );
              if (sent._tag === 'moved') return true;
              const done = yield* Effect.result(readTree(places.index, 'merge-take-checkout', [tip, commit]));
              if (done._tag === 'Success') {
                const standing = yield* Effect.mapError(standingOf(git, checkout), failed);
                return standing.head.ref !== ref || standing.head.commit !== commit;
              }
              const back = yield* Effect.result(
                runGit(git, 'merge-take-undo', [
                  '-C',
                  checkout,
                  'update-ref',
                  '-m',
                  `tagma merge: undo taking ${baseBranch}`,
                  ref,
                  tip,
                  commit,
                ]),
              );
              return yield* refused(
                'git-refused',
                back._tag === 'Success'
                  ? `git did not bring the worktree to ${commit}, which takes ${baseBranch} into ${branch}, so ${branch} was put back at ${tip}: ${done.failure.message}`
                  : `git did not bring the worktree to ${commit}, which takes ${baseBranch} into ${branch}, and ${branch} could not be put back at ${tip}, so the branch stands on ${commit} while its files hold ${tip}: ${done.failure.message}; ${back.failure.message}`,
                ['read what git said above and clear it, then merge again'],
              );
            }),
          );
        }),
      )
      .pipe(Effect.catchTags({ HoldStalled: laneFailed, HoldCut: laneFailed, ReentrantCall: laneFailed }));
    if (moved)
      return yield* refused('finishing-busy', `${branch} moved while the merge took ${baseBranch} into it, so the merge was not judged`, [
        'merge again',
      ]);
    return commit;
  });
  return MergeGit.of({
    head: (checkout) => asked(headAt(reading, checkout)),
    resolve: (checkout, ref) => asked(commitOf(reading, checkout, ref)),
    tree: (checkout, commit) => Effect.map(asked(commitMetaAt(reading, checkout, commit)), (meta) => meta.tree),
    ancestor: (checkout, older, newer) => asked(ancestorAt(reading, checkout, older, newer)),
    changed: (checkout, from, to, sinceFork) => asked(changedBetween(reading, checkout, from, to, { sinceFork })),
    operation: (checkout) => Effect.mapError(openOperation(git, checkout), failed),
    repository: (checkout) =>
      Effect.mapError(runGit(git, 'merge-repository', ['-C', checkout, 'rev-parse', '--path-format=absolute', '--git-common-dir']), failed),
    advance: Effect.fnUntraced(function* (at, message) {
      const updated = yield* Effect.result(
        runGit(git, 'merge-publish', ['-C', at.checkout, 'update-ref', '-m', message, '--create-reflog', at.ref, at.commit, at.base]),
      );
      if (updated._tag === 'Success') return true;
      const standing = yield* Effect.mapError(shaOf(at.checkout, at.ref), failed);
      if (standing !== at.base) return false;
      return yield* failed(updated.failure);
    }),
    settle,
    proved: Effect.fnUntraced(function* (repository, checkout, ref, commit) {
      const tip = yield* Effect.mapError(shaOf(checkout, ref), failed);
      if (tip !== null) {
        const reached = yield* Effect.mapError(
          gitAnswer(git, 'merge-recovery', ['--git-dir', repository, 'merge-base', '--is-ancestor', commit, tip]),
          failed,
        );
        if (reached.status === 0) return true;
      }
      const logged = yield* Effect.mapError(
        gitAnswer(git, 'merge-recovery-log', ['--git-dir', repository, 'reflog', 'show', '--format=%H', ref, '--']),
        failed,
      );
      return logged.status === 0 && logged.stdout.split('\n').includes(commit);
    }),
    interrupted: Effect.fn('Merges.interrupted')(function* (checkout) {
      if (!(yield* asked(mergingAt(reading, checkout)))) return null;
      const { gitDir } = yield* asked(locationsAt(reading, checkout));
      const stored = <A>(work: Effect.Effect<A, import('effect').PlatformError.PlatformError>) =>
        Effect.mapError(work, (failure) => new WorktreeUnavailable({ reason: 'storage', message: failure.message }));
      for (const sequenced of ['rebase-merge', 'rebase-apply', 'sequencer']) {
        if (yield* stored(files.exists(join(gitDir, sequenced)))) return null;
      }
      const head = yield* asked(headAt(reading, checkout));
      const message = yield* stored(files.readFileString(join(gitDir, 'MERGE_MSG')));
      return {
        ref: head.ref,
        roots: message
          .split('\n')
          .flatMap((line) => (line.startsWith(`${MERGE_TRAILER}: `) ? [line.slice(MERGE_TRAILER.length + 2).trim()] : [])),
      };
    }),
    abort: (checkout) => asked(abortAt(git, checkout, 'merge')),
    take,
    signing: (checkout) => Effect.map(Effect.mapError(commitConfig(git, checkout), failed), (config) => config.sign),
    hooks: (checkout, base, tree, message) =>
      Effect.flatMap(placesOf(git, checkout), (places) =>
        commitHooks(git, git, trees, checkout, places, base, tree, message, MERGING),
      ).pipe(
        Effect.catchTag('OwnGitFailed', (failure) => Effect.fail(failed(failure))),
        Effect.catchTag('HookRefused', (stopped) =>
          Effect.fail(
            new MergeHookRefused({
              built: stopped.built,
              left: stopped.left,
              unread: stopped.unread,
              failure:
                stopped.failure._tag === 'HoldCut'
                  ? stopped.failure
                  : stopped.failure._tag === 'OwnGitFailed'
                    ? failed(stopped.failure)
                    : new WorktreeFinishRefused({ reason: 'git-refused', message: stopped.failure.message, unblock: ['merge again'] }),
            }),
          ),
        ),
      ),
    create,
    replay: Effect.fnUntraced(function* (checkout, onto, tip, sign) {
      const replayed = yield* asked(replayAt(configuredGit(git, 'merge-replay'), checkout, { onto, upstream: onto, tip }, { sign }));
      if (replayed.head === null) return { head: null, tree: null, conflicts: replayed.conflicts };
      return { head: replayed.head, tree: (yield* asked(commitMetaAt(git, checkout, replayed.head))).tree, conflicts: [] as const };
    }),
    posted: Effect.fnUntraced(function* (checkout, commit) {
      const places = yield* Effect.result(placesOf(git, checkout));
      if (places._tag === 'Success') yield* landedHook(git, git, trees, checkout, places.success, commit, MERGING);
      else
        yield* Effect.logWarning(`the ${MERGING.landed} hook could not be looked for after the commit landed`, {
          root: checkout,
          reason: places.failure.message,
        });
    }),
    carry: Effect.fnUntraced(function* (projectId, root, from, to) {
      if (from === to) return NOTHING_CARRIED;
      const origin = yield* origins.rootOf(root);
      return yield* carriedSafely(changes, { git, root, projectId, origin }, from, to, { _tag: 'unheld' }).pipe(
        Effect.provideService(LineWrites, writes),
        Effect.provideService(FileSystem.FileSystem, files),
      );
    }),
    remote: Effect.fnUntraced(function* (checkout, branch) {
      const renamed = yield* asked(keptUpstream(git, checkout, branch));
      const remote = renamed?.remote ?? (yield* asked(publishRemoteAt(git, checkout, branch)));
      return remote === null ? null : { remote, branch: renamed?.branch ?? branch, renamed: renamed !== null };
    }),
    push: (checkout, branch, remote) =>
      asked(
        pushAt(
          git,
          checkout,
          remote.renamed
            ? { target: { remote: remote.remote, branch, as: remote.branch } }
            : { target: { remote: remote.remote, branch }, setUpstream: true },
        ),
      ),
  });
});
