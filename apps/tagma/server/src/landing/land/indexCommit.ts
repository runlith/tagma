import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { commitMetaAt, type Identity } from '@runlith/git/merge';
import { OwnGitFailed, readingFailed, runGit } from '../../platform/git/ownGit.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { indexWrites } from '../../platform/git/index.js';
import { mergeParents } from '../../platform/git/publish.js';
import { type GitPlaces, type OpenOperation, operationIn, standingOf } from '../../platform/git/places.js';
import { emptyTree } from '../../change-record/prepared/subject.js';
import { named, nul } from '../../change-record/prepared/tree.js';
import { type Checked, passed } from '../../enforcement/contract/wire/checks.js';
import type { JudgeRefusalCode } from '../../enforcement/contract/wire/enforcement.js';
import type { CommitShape, ShapeAct } from '../../change-record/contract/service/shape.js';
import type { ShapeRefusal } from '../../change-record/contract/wire/shape.js';
import type { CommitTrees } from '../../workspace/contract/service/commitTrees.js';
import { commitHooks, type Committing, formedRefusal, type HookKind, HookRefused, landedHook, type Posted, withSteps } from './hooks.js';
import type { CheckoutLanes } from './lanes.js';
import { laneFailed } from './commit.js';
import { type Forming, judgedInForm } from './formed.js';
import { advanced, concluded, makeCommit, midOperation, type Unsigned } from './publish.js';
import { type Carried, deltaOf, type Delta, unreadIn } from './reshaping.js';

export type IndexJudge = (built: string, base: string, paths: readonly string[], merged: readonly string[]) => Effect.Effect<Checked>;

export type CommitRequest = {
  readonly message: string;
  readonly amend: boolean;
  readonly kind: HookKind;
  readonly withoutFormat: boolean;
};

export type IndexCommitAsk = CommitRequest & {
  readonly projectId: number;
  readonly root: string;
  readonly judge: IndexJudge | null;
  readonly job: string;
  readonly act: ShapeAct;
  readonly landing: (commit: string, tree: string) => Effect.Effect<void, GateRefusal<'record-unread'>>;
  readonly read: (delta: Delta) => Effect.Effect<Carried, GateRefusal<'reshape-unreadable'>>;
  readonly form: Forming;
};

export type IndexCommitted = {
  readonly staging: Carried;
  readonly leaving: Carried;
  readonly commit: string;
  readonly staged: string;
  readonly committing: Committing;
  readonly posted: Posted | null;
  readonly paths: readonly string[];
  readonly unsynced: readonly string[];
  readonly formatSkipped: boolean;
  readonly judgement: Checked | null;
};

export type IndexCommitRefusal =
  | GateRefusal<
      'tree-mid-merge' | 'landing-busy' | 'landing-cut' | 'record-unread' | 'reshape-unreadable' | ShapeRefusal | JudgeRefusalCode
    >
  | Unsigned;

type Read = {
  readonly places: GitPlaces;
  readonly tree: string;
  readonly ref: string;
  readonly head: string | null;
  readonly parents: readonly string[];
  readonly base: string;
  readonly paths: readonly string[];
  readonly operation: OpenOperation | null;
  readonly author: Identity | undefined;
};

const CONCLUDED: ReadonlySet<OpenOperation> = new Set(['merge', 'rebase', 'cherry-pick', 'revert']);

const PATHS_AT_ONCE = 512;

const nothing = (root: string): OwnGitFailed =>
  new OwnGitFailed({ op: 'checkout-commit', message: `nothing to commit: the index of ${root} holds what HEAD holds`, ran: true });

const applying = (root: string): GateRefusal<'tree-mid-merge'> =>
  new GateRefusal('tree-mid-merge', `an am is in progress in ${root}; its patches commit themselves, so this commit was not made`, [
    'the am goes on in the checkout: `git am --continue` once its patch applies, or `git am --skip` to drop that patch',
  ]);

const unamendable = (root: string, operation: OpenOperation): GateRefusal<'tree-mid-merge'> =>
  new GateRefusal('tree-mid-merge', `a ${operation} is in progress in ${root}, and amending would rewrite the commit it stands on`, [
    `commit without amend to conclude the ${operation}, then amend`,
  ]);

const judged = (judging: Effect.Effect<Checked>): Effect.Effect<Checked, IndexCommitRefusal> => Effect.flatMap(judging, passed);

const authorOf = (git: Git['Service'], root: string, revision: string): Effect.Effect<Identity, OwnGitFailed> =>
  Effect.map(
    Effect.mapError(commitMetaAt(git, root, revision), (failure) => readingFailed('checkout-commit-author', failure)),
    (meta) => meta.author,
  );

const readIndex = Effect.fnUntraced(function* (
  git: Git['Service'],
  root: string,
  amend: boolean,
): Effect.fn.Return<Read, OwnGitFailed | IndexCommitRefusal> {
  const { places, head: pointed } = yield* standingOf(git, root);
  const operation = yield* operationIn(places);
  if (operation === 'am') return yield* applying(root);
  if (operation !== null && !CONCLUDED.has(operation)) return yield* midOperation(root, operation);
  if (amend && operation !== null && operation !== 'rebase') return yield* unamendable(root, operation);
  const ref = pointed.ref ?? 'HEAD';
  const head = pointed.commit;
  if (amend && head === null) return yield* new OwnGitFailed({ op: 'checkout-commit', message: 'You have nothing to amend.', ran: true });
  const tree = yield* indexWrites
    .hold(places.index, runGit(git, 'checkout-commit-tree', ['-C', root, 'write-tree']))
    .pipe(Effect.catchTags({ HoldStalled: (failure) => laneFailed(root, failure), HoldCut: (failure) => laneFailed(root, failure) }));
  const parents =
    head === null
      ? []
      : amend
        ? (yield* runGit(git, 'checkout-commit-parents', ['-C', root, 'rev-parse', `${head}^@`])).split('\n').filter((line) => line !== '')
        : operation === 'merge'
          ? [head, ...(yield* mergeParents(git, root))]
          : [head];
  const author = amend
    ? yield* authorOf(git, root, 'HEAD')
    : operation === 'cherry-pick'
      ? yield* authorOf(git, root, 'CHERRY_PICK_HEAD')
      : undefined;
  const base = parents[0] ?? (yield* emptyTree(git, root));
  const paths = named(
    yield* runGit(git, 'checkout-commit-paths', ['-C', root, 'diff-tree', '-r', '-z', '--name-only', '--no-renames', base, tree]),
  );
  if (!amend && operation !== 'merge' && paths.length === 0) return yield* nothing(root);
  return { places, tree, ref, head, parents, base, paths, operation, author };
});

const entries = (listed: string, mode: number, sha: number): ReadonlyMap<string, string> =>
  new Map(
    named(listed).map((record) => {
      const tab = record.indexOf('\t');
      const fields = record.slice(0, tab).split(' ');
      return [record.slice(tab + 1), `${fields[mode] ?? ''} ${fields[sha] ?? ''}`] as const;
    }),
  );

const chunks = (paths: readonly string[]): readonly (readonly string[])[] =>
  Array.from({ length: Math.ceil(paths.length / PATHS_AT_ONCE) }, (_, at) => paths.slice(at * PATHS_AT_ONCE, (at + 1) * PATHS_AT_ONCE));

const settled = (
  git: Git['Service'],
  root: string,
  index: string,
  staged: string,
  commit: string,
  paths: readonly string[],
): Effect.Effect<readonly string[]> => {
  if (paths.length === 0) return Effect.succeed([]);
  const literal = { GIT_LITERAL_PATHSPECS: '1' };
  const unsynced = () => Effect.succeed(paths);
  return indexWrites
    .hold(
      index,
      Effect.gen(function* () {
        const due: string[] = [];
        for (const chunk of chunks(paths)) {
          const standing = entries(
            yield* runGit(git, 'checkout-commit-settle', ['-C', root, 'ls-files', '-s', '-z', '--', ...chunk], { env: literal }),
            0,
            1,
          );
          const read = entries(
            yield* runGit(git, 'checkout-commit-settle', ['-C', root, 'ls-tree', '-r', '-z', staged, '--', ...chunk], { env: literal }),
            0,
            2,
          );
          due.push(...chunk.filter((path) => (standing.get(path) ?? null) === (read.get(path) ?? null)));
        }
        if (due.length > 0) {
          yield* runGit(
            git,
            'checkout-commit-settle',
            ['-C', root, 'reset', '-q', '--pathspec-from-file=-', '--pathspec-file-nul', commit],
            { stdin: nul(due), env: literal },
          );
        }
        const done = new Set(due);
        return paths.filter((path) => !done.has(path));
      }),
    )
    .pipe(Effect.catchTags({ OwnGitFailed: unsynced, HoldStalled: unsynced, HoldCut: unsynced }));
};

export const commitIndex = Effect.fn('landing.commitIndex')(function* (
  git: Git['Service'],
  trees: CommitTrees['Service'],
  lanes: CheckoutLanes,
  shape: CommitShape['Service'],
  ask: IndexCommitAsk,
): Effect.fn.Return<IndexCommitted, OwnGitFailed | HookRefused | IndexCommitRefusal> {
  const { root } = ask;
  const read = yield* readIndex(git, root, ask.amend);
  const shaped =
    read.parents.length > 1
      ? { tree: read.tree, reshaped: [], skipped: false }
      : yield* shape.shape({
          projectId: ask.projectId,
          git,
          root,
          gitDir: read.places.gitDir,
          commonDir: read.places.commonDir,
          act: ask.act,
          base: read.base,
          tree: read.tree,
          job: ask.job,
          skipping: ask.withoutFormat,
        });
  const built = shaped.tree;
  let shapedPaths = read.paths;
  if (built !== read.tree) {
    shapedPaths = named(
      yield* runGit(git, 'checkout-commit-shaped', ['-C', root, 'diff-tree', '-r', '-z', '--name-only', '--no-renames', read.base, built]),
    );
    if (shapedPaths.length === 0 && !ask.amend && read.operation !== 'merge') {
      return yield* new HookRefused({
        failure: new OwnGitFailed({
          op: 'checkout-commit',
          message: `nothing to commit: the commit steps turned what the index holds into what HEAD holds`,
          ran: true,
        }),
        built,
        left: built,
        unread: null,
        earlier: null,
        stepped: shaped.reshaped,
      });
    }
  }
  let judgement =
    ask.judge === null
      ? null
      : yield* Effect.mapError(
          judged(judgedInForm(ask.form, shaped.reshaped, ask.judge(built, read.base, shapedPaths, read.parents.slice(1)))),
          formedRefusal(built, shaped.reshaped),
        );
  const committing = yield* commitHooks(git, git, trees, root, read.places, read.parents[0] ?? null, built, ask.message, ask.kind).pipe(
    Effect.mapError(withSteps(shaped.reshaped)),
    Effect.catchTags({ HoldStalled: (failure) => laneFailed(root, failure), HoldCut: (failure) => laneFailed(root, failure) }),
  );
  const hooked = <A, E extends OwnGitFailed | GateRefusal | StoreFailure>(work: Effect.Effect<A, E>): Effect.Effect<A, E | HookRefused> =>
    committing.left === built && shaped.reshaped.length === 0
      ? work
      : Effect.mapError(
          work,
          (failure) => new HookRefused({ failure, built, left: committing.left, unread: null, earlier: null, stepped: shaped.reshaped }),
        );
  let paths = shapedPaths;
  if (committing.tree !== built) {
    paths = named(
      yield* hooked(
        runGit(git, 'checkout-commit-paths', [
          '-C',
          root,
          'diff-tree',
          '-r',
          '-z',
          '--name-only',
          '--no-renames',
          read.base,
          committing.tree,
        ]),
      ),
    );
    if (ask.judge !== null)
      judgement = yield* hooked(
        judged(judgedInForm(ask.form, shaped.reshaped, ask.judge(committing.tree, read.base, paths, read.parents.slice(1)))),
      );
  }
  const stepped = yield* hooked(deltaOf(git, root, read.tree, committing.tree));
  const staging = yield* hooked(ask.read(stepped));
  const leaving = yield* hooked(Effect.flatMap(deltaOf(git, root, committing.tree, committing.left), ask.read));
  const unread = unreadIn([staging, leaving]);
  if (unread !== null) return yield* hooked(Effect.fail(unread));
  const commit = yield* hooked(
    makeCommit(git, root, {
      tree: committing.tree,
      parents: read.parents,
      message: committing.message,
      sign: committing.sign,
      author: read.author,
    }),
  );
  yield* hooked(ask.landing(commit, read.tree));
  const at = { root, places: read.places, ref: read.ref, base: read.head, job: ask.job, concluding: read.operation ?? undefined };
  const published = yield* hooked(
    lanes.commits.enter(root, advanced(git, git, at, commit)).pipe(
      Effect.catchTags({
        HoldStalled: (failure) => laneFailed(root, failure),
        HoldCut: (failure) => laneFailed(root, failure),
        ReentrantCall: (failure) => laneFailed(root, failure),
      }),
    ),
  );
  if (published._tag === 'moved') {
    return yield* hooked(
      Effect.fail(
        new GateRefusal('landing-busy', `HEAD of ${root} moved while this commit was made, so nothing was committed`, [
          'read the checkout and commit again',
        ]),
      ),
    );
  }
  yield* concluded(git, root, read.operation);
  const unsynced = yield* settled(git, root, read.places.index, read.tree, commit, stepped.paths);
  const posted = committing.after.has(ask.kind.landed) ? yield* landedHook(git, git, trees, root, read.places, commit, ask.kind) : null;
  return { staging, leaving, commit, staged: read.tree, committing, posted, paths, unsynced, formatSkipped: shaped.skipped, judgement };
});
