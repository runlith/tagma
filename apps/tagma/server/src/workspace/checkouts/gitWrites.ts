import { relative, resolve, sep } from 'node:path';
import { Effect } from 'effect';
import { abortAt, fetchAt, pullAt, pushAt } from '@runlith/git/porcelain';
import { discardAt, stageAt, unstageAt, type ActedPaths } from '@runlith/git/stage';
import { troubleOf, type GitAnswerInvalid, type GitRefused, type GitUnreadable } from '@runlith/git/repository';
import { Git } from '@runlith/git/Git';
import type { RootId } from '../contract/wire/ids.js';
import { holderKey } from '../contract/wire/checkout.js';
import {
  CheckoutHoldings,
  CheckoutRows,
  CheckoutWriteRefused,
  CheckoutWrites,
  GraphDirectory,
  type CheckoutWriteFailure,
  type CheckoutAt,
} from '../contract/service/checkouts.js';
import { FileRoots } from '../contract/service/roots.js';
import type { RootResolutionFailure } from '../contract/wire/roots.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { keptUpstreamHere } from '../repositories/pushName.js';
import { indexPath, indexWrites } from '../../platform/git/index.js';
import type { OwnGitFailed } from '../../platform/git/ownGit.js';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';

const gitRefused = (failure: GitUnreadable | GitRefused | GitAnswerInvalid): CheckoutWriteRefused =>
  new CheckoutWriteRefused({
    reason: failure._tag === 'GitRefused' ? 'git-refused' : failure._tag === 'GitAnswerInvalid' ? 'git-incomplete' : 'git-unreadable',
    message: troubleOf(failure),
    unblock:
      failure._tag === 'GitRefused'
        ? ['read what git said above and clear it, then act again']
        : ['the reading could not be taken: read the command above and run it yourself to see why'],
  });

const indexRefused = (failure: OwnGitFailed | HoldStalled | HoldCut): CheckoutWriteRefused =>
  new CheckoutWriteRefused({
    reason: failure._tag === 'OwnGitFailed' && !failure.ran ? 'git-unreadable' : 'git-refused',
    message: failure.message,
    unblock: ['read the checkout state, then act again once the operation using its index has ended'],
  });

const graphPath = (root: string, graphDirectory: string, paths: readonly string[]): CheckoutWriteRefused | null => {
  const at = resolve(root);
  const named = paths.find((path) => {
    const inside = relative(at, resolve(at, path));
    return inside === graphDirectory || inside.startsWith(`${graphDirectory}${sep}`);
  });
  return named === undefined
    ? null
    : new CheckoutWriteRefused({
        reason: 'graph-path',
        message: `${named} is the graph's own tree, which this server commits as its own stream`,
        unblock: ['commit the block tree with sync_graph', 'name the paths of your own work instead'],
      });
};

const rowStale = (path: string): Effect.Effect<never, CheckoutWriteRefused> =>
  new CheckoutWriteRefused({
    reason: 'row-stale',
    message: `the reading of ${path} did not happen, so what stands is the row before it`,
    unblock: ['read the checkout again, then discard against a row that was actually taken'],
  });

const noOperation = (path: string): Effect.Effect<never, CheckoutWriteRefused> =>
  new CheckoutWriteRefused({
    reason: 'no-operation',
    message: `${path} holds no merge, rebase, am, cherry-pick or revert to end`,
    unblock: ['read the checkout first: an abort ends the operation the row names, and this row names none'],
  });

const noRemote = (branch: string): Effect.Effect<never, CheckoutWriteRefused> =>
  new CheckoutWriteRefused({
    reason: 'no-remote',
    message: `${branch} names a branch of a remote, and no remote was named`,
    unblock: ['name the remote this branch belongs to', "push with neither, and the branch's own upstream decides where it goes"],
  });

const noPaths = (verb: string): Effect.Effect<never, CheckoutWriteRefused> =>
  new CheckoutWriteRefused({
    reason: 'no-paths',
    message: `${verb} was given no path, and an empty list is how git spells the whole tree`,
    unblock: ['name the paths to act on; there is no repository-wide spelling of this act here'],
  });

const named = (paths: readonly string[], verb: string): Effect.Effect<ActedPaths, CheckoutWriteRefused> => {
  const [first, ...rest] = paths;
  return first === undefined ? noPaths(verb) : Effect.succeed([first, ...rest]);
};

const moved = (judged: string, now: string): Effect.Effect<never, CheckoutWriteRefused> =>
  new CheckoutWriteRefused({
    reason: 'root-moved',
    message: `this act was approved for ${judged} and the registry now answers ${now}`,
    unblock: ['ask again: the approval was over the place it named, and that place is no longer this one'],
  });

const recordUnread = (path: string, failure: StoreFailure | RootResolutionFailure): CheckoutWriteRefused =>
  new CheckoutWriteRefused({
    reason: 'record-unread',
    message: `the act landed, and the record of who is writing in ${path} could not be read (${failure._tag})`,
    unblock: ['read the checkout again: the row says who is writing there once the record answers'],
  });

export type GitCheckoutWrites = CheckoutWrites['Service'];

export const makeGitCheckoutWrites = Effect.gen(function* () {
  const git = yield* Git;
  const roots = yield* FileRoots;
  const checkouts = yield* CheckoutRows;
  const holdings = yield* CheckoutHoldings;
  const graphDirectory = yield* GraphDirectory;

  const act = Effect.fn('CheckoutWrites.act')(function* <A, E, R>(
    at: CheckoutAt,
    work: (root: string) => Effect.Effect<A, E, R>,
    touched: (answer: A) => readonly string[],
  ): Effect.fn.Return<
    { readonly answer: A; readonly writing: readonly string[]; readonly ahead: number | null },
    E | CheckoutWriteFailure,
    R
  > {
    const root = yield* roots.read(at.rootId);
    if (at.judged !== null && at.judged !== root.path) return yield* moved(at.judged, root.path);
    const answer = yield* work(root.path).pipe(Effect.ensuring(checkouts.mark(at.rootId)));
    const writing = yield* writersOf(at.rootId, root.path, touched(answer));
    const row = yield* checkouts.read(at.rootId);
    return { answer, writing, ahead: row.ahead };
  });

  const acting = Effect.fn('CheckoutWrites.acting')(function* <A, P extends readonly string[]>(
    at: CheckoutAt,
    paths: P,
    verb: (dir: string, named: P) => Effect.Effect<A, GitUnreadable | GitRefused | GitAnswerInvalid>,
    touched: readonly string[] | ((answer: A) => readonly string[]) = paths,
    indexWrite = true,
  ): Effect.fn.Return<{ readonly answer: A; readonly writing: readonly string[] }, CheckoutWriteFailure> {
    const root = yield* roots.read(at.rootId);
    if (at.judged !== null && at.judged !== root.path) return yield* moved(at.judged, root.path);
    const refused = graphPath(root.path, graphDirectory, paths);
    if (refused !== null) return yield* refused;
    const work = Effect.mapError(verb(root.path, paths), gitRefused).pipe(Effect.ensuring(checkouts.mark(at.rootId)));
    const index = indexWrite ? yield* Effect.mapError(indexPath(git, root.path), indexRefused) : null;
    const answer = yield* index === null
      ? work
      : indexWrites.hold(index, work).pipe(
          Effect.catchTags({
            HoldStalled: (failure) => indexRefused(failure),
            HoldCut: (failure) => indexRefused(failure),
          }),
        );
    return { answer, writing: yield* writersOf(at.rootId, root.path, typeof touched === 'function' ? touched(answer) : touched) };
  });

  function writersOf(rootId: RootId, dir: string, paths: readonly string[]): Effect.Effect<readonly string[], CheckoutWriteRefused> {
    if (paths.length === 0) return Effect.succeed([]);
    return holdings.holdersOf(rootId, paths).pipe(
      Effect.map((held) => [
        ...new Set(
          [...held.values()].flatMap((holders) => holders.filter((holder) => holder.writing).map((holder) => holderKey(holder.holder))),
        ),
      ]),
      Effect.mapError((failure) => recordUnread(dir, failure)),
    );
  }

  return CheckoutWrites.of({
    act,

    stage: (at, paths) =>
      Effect.flatMap(named(paths, 'stage'), (asked) =>
        Effect.map(
          acting(at, asked, (dir, listed) => stageAt(git, dir, listed)),
          (acted) => ({ paths: acted.answer, writing: acted.writing }),
        ),
      ),

    unstage: (at, paths) =>
      Effect.flatMap(named(paths, 'unstage'), (asked) =>
        Effect.map(
          acting(at, asked, (dir, listed) => unstageAt(git, dir, listed)),
          (acted) => ({ paths: acted.answer, writing: acted.writing }),
        ),
      ),

    discard: Effect.fn('CheckoutWrites.discard')(function* (at, paths) {
      if (paths.length === 0) return yield* noPaths('discard');
      const row = yield* checkouts.read(at.rootId);
      if (row.stale) return yield* rowStale(row.path);
      const untracked = new Set(row.entries.untracked.entries.map((entry) => entry.path));
      const deleted = paths.filter((path) => untracked.has(path));
      const restored = paths.filter((path) => !untracked.has(path));
      const acted = yield* acting(at, paths, (dir) => discardAt(git, dir, { tracked: restored, untracked: deleted }));
      return { paths: acted.answer, writing: acted.writing, restored, deleted };
    }),

    push: Effect.fn('CheckoutWrites.push')(function* (at, options) {
      if (options.remote === undefined && options.branch !== undefined) return yield* noRemote(options.branch);
      const target = options.remote === undefined ? undefined : { remote: options.remote, branch: options.branch };
      const acted = yield* acting(
        at,
        [],
        (dir) =>
          Effect.gen(function* () {
            const renamed = options.remote === undefined ? yield* keptUpstreamHere(git, dir) : null;
            return yield* pushAt(git, dir, {
              target: renamed === null ? target : { remote: renamed.remote, as: renamed.branch },
              setUpstream: options.setUpstream,
            });
          }),
        [],
        false,
      );
      return { paths: [], writing: acted.writing, moved: acted.answer };
    }),

    fetch: (at) =>
      Effect.map(
        acting(at, [], (dir) => fetchAt(git, dir), [], false),
        () => ({ paths: [], writing: [] }),
      ),

    pull: (at) =>
      Effect.map(
        acting(
          at,
          [],
          (dir) => pullAt(git, dir),
          (pulled) => pulled.conflicts,
        ),
        (acted) => ({
          paths: acted.answer.conflicts,
          writing: acted.writing,
          head: acted.answer.head,
          moved: acted.answer.moved,
          merge: acted.answer.merge,
          conflicted: acted.answer.conflicts.length > 0,
        }),
      ),

    abort: Effect.fn('CheckoutWrites.abort')(function* (at) {
      const row = yield* checkouts.read(at.rootId);
      if (row.operation === 'none') return yield* noOperation(row.path);
      const operation = row.operation;
      const conflicted = row.entries.unmerged.entries.map((entry) => entry.path);
      const acted = yield* acting(at, [], (dir) => abortAt(git, dir, operation), conflicted);
      return { paths: conflicted, writing: acted.writing, operation };
    }),
  });
});
