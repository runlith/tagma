import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { PullMerge } from '@runlith/git/porcelain';
import { OwnGitFailed, runGit } from '../../platform/git/ownGit.js';
import { bringCheckout } from './bring.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { indexWrites } from '../../platform/git/index.js';
import { named } from '../../change-record/prepared/tree.js';
import type { CommitTrees } from '../../workspace/contract/service/commitTrees.js';
import { commitHooks, type Committing, HookRefused, landedHook, MERGING } from './hooks.js';
import type { CheckoutLanes } from './lanes.js';
import { laneFailed } from './commit.js';
import { advanced, makeCommit } from './publish.js';
import { type GitPlaces, standingOf } from '../../platform/git/places.js';
import type { IndexCommitRefusal } from './indexCommit.js';

export type PullAsk = { readonly root: string; readonly head: string; readonly merge: PullMerge; readonly job: string };

export type PullMerged = {
  readonly commit: string;
  readonly staged: string;
  readonly committing: Committing;
  readonly paths: readonly string[];
  readonly unsynced: readonly string[];
};

const changed = (git: Git['Service'], root: string, from: string, to: string): Effect.Effect<readonly string[], OwnGitFailed> =>
  Effect.map(runGit(git, 'pull-merge-paths', ['-C', root, 'diff-tree', '-r', '-z', '--name-only', '--no-renames', from, to]), named);

const fits = (git: Git['Service'], root: string, head: string, tree: string): Effect.Effect<void, OwnGitFailed> =>
  Effect.asVoid(runGit(git, 'pull-merge-fits', ['-C', root, 'read-tree', '-m', '-u', '-n', head, tree]));

const brought = (
  git: Git['Service'],
  root: string,
  places: GitPlaces,
  ref: string,
  head: string,
  commit: string,
  paths: readonly string[],
): Effect.Effect<readonly string[]> =>
  Effect.flatMap(Effect.result(indexWrites.hold(places.index, bringCheckout(git, root, places, ref, head, commit))), (done) => {
    if (done._tag === 'Failure')
      return Effect.as(
        Effect.logWarning('a pulled merge landed and the checkout was not brought to it', { root, reason: done.failure.message }),
        paths,
      );
    const reason = done.success.failure ?? done.success.stale;
    if (reason !== null)
      return Effect.as(
        Effect.logWarning('a pulled merge landed and the checkout was not wholly brought to it', { root, reason }),
        done.success.kept,
      );
    return Effect.succeed(done.success.kept);
  });

export const mergePulled = Effect.fn('landing.mergePulled')(function* (
  git: Git['Service'],
  trees: CommitTrees['Service'],
  lanes: CheckoutLanes,
  ask: PullAsk,
): Effect.fn.Return<PullMerged, OwnGitFailed | HookRefused | IndexCommitRefusal> {
  const { root, head, merge } = ask;
  const { places, head: pointed } = yield* standingOf(git, root);
  const ref = pointed.ref ?? 'HEAD';
  yield* fits(git, root, head, merge.tree);
  const committing = yield* commitHooks(git, git, trees, root, places, head, merge.tree, merge.message, MERGING).pipe(
    Effect.catchTags({ HoldStalled: (failure) => laneFailed(root, failure), HoldCut: (failure) => laneFailed(root, failure) }),
  );
  const hooked = <A, E extends OwnGitFailed | GateRefusal | StoreFailure>(work: Effect.Effect<A, E>): Effect.Effect<A, E | HookRefused> =>
    committing.left === merge.tree
      ? work
      : Effect.mapError(
          work,
          (failure) => new HookRefused({ failure, built: merge.tree, left: committing.left, unread: null, earlier: null, stepped: [] }),
        );
  if (committing.tree !== merge.tree) yield* hooked(fits(git, root, head, committing.tree));
  const paths = yield* hooked(changed(git, root, head, committing.tree));
  const commit = yield* hooked(
    makeCommit(git, root, { tree: committing.tree, parents: [head, merge.upstream], message: committing.message, sign: committing.sign }),
  );
  const landed = Effect.gen(function* () {
    const sent = yield* advanced(git, git, { root, places, ref, base: head, job: ask.job }, commit);
    if (sent._tag === 'moved') return null;
    return yield* brought(git, root, places, ref, head, commit, paths);
  });
  const unsynced = yield* hooked(
    lanes.commits.enter(root, landed).pipe(
      Effect.catchTags({
        HoldStalled: (failure) => laneFailed(root, failure),
        HoldCut: (failure) => laneFailed(root, failure),
        ReentrantCall: (failure) => laneFailed(root, failure),
      }),
    ),
  );
  if (unsynced === null) {
    return yield* hooked(
      Effect.fail(
        new GateRefusal('landing-busy', `HEAD of ${root} moved while the pulled merge was made, so nothing was committed`, ['pull again']),
      ),
    );
  }
  if (committing.after.has(MERGING.landed)) yield* landedHook(git, git, trees, root, places, commit, MERGING);
  return { commit, staged: merge.tree, committing, paths, unsynced };
});
