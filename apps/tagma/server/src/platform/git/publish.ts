import { readFile, rm } from 'node:fs/promises';
import { Data, Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';
import { gitIdentity, OwnGitFailed, quietGit, runGit } from './ownGit.js';
import { type GitPlaces, type OpenOperation, operationIn, placesOf, pointedAt } from './places.js';
import { type IndexBusy, type IndexWriteFailed, type SettleEntry, type Settlement, settleIndex } from './settle.js';

export type Publication = {
  readonly checkout: string;
  readonly ref: string;
  readonly base: string | null;
  readonly tree: string;
  readonly message: string;
  readonly job: string;
  readonly entries: readonly SettleEntry[];
  readonly author?: string;
};

type Unsettled = IndexBusy | IndexWriteFailed | OwnGitFailed | HoldStalled | HoldCut;

export type Published =
  | { readonly outcome: 'moved'; readonly ref: string; readonly sha: string | null }
  | { readonly outcome: 'published'; readonly commit: string; readonly settlement: Settlement | Unsettled };

export class MidOperation extends Data.TaggedError('MidOperation')<{ readonly checkout: string; readonly operation: string }> {
  override get message(): string {
    return `a ${this.operation} is in progress in ${this.checkout}, and any commit now would conclude it`;
  }
}

const gitPath = (git: Git['Service'], root: string, name: string): Effect.Effect<string, OwnGitFailed> =>
  runGit(git, 'operation-place', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-path', name]);

export const mergeParents = (git: Git['Service'], root: string): Effect.Effect<readonly string[], OwnGitFailed> =>
  Effect.flatMap(gitPath(git, root, 'MERGE_HEAD'), (path) =>
    Effect.tryPromise({
      try: () =>
        readFile(path, 'utf8').then((text) =>
          text
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== ''),
        ),
      catch: (cause) => new OwnGitFailed({ op: 'merge-parents', message: String(cause), ran: false }),
    }),
  );

export const endOperation = (
  git: Git['Service'],
  root: string,
  operation: 'merge' | 'cherry-pick' | 'revert',
): Effect.Effect<void, OwnGitFailed> => {
  if (operation === 'merge') return Effect.asVoid(runGit(git, 'commit-quit', ['-C', root, 'merge', '--quit']));
  const head = operation === 'cherry-pick' ? 'CHERRY_PICK_HEAD' : 'REVERT_HEAD';
  return Effect.forEach(
    [head, 'MERGE_MSG'],
    (name) =>
      Effect.flatMap(gitPath(git, root, name), (path) =>
        Effect.tryPromise({
          try: () => rm(path, { force: true }),
          catch: (cause) => new OwnGitFailed({ op: 'commit-conclude', message: String(cause), ran: false }),
        }),
      ),
    { discard: true },
  );
};

export const headRef = (git: Git['Service'], checkout: string): Effect.Effect<string, OwnGitFailed> =>
  Effect.map(quietGit(git, 'publish-head', ['-C', checkout, 'symbolic-ref', '-q', 'HEAD']), (ref) => ref || 'HEAD');

const shaOf = (git: Git['Service'], checkout: string, ref: string): Effect.Effect<string | null, OwnGitFailed> =>
  Effect.map(quietGit(git, 'publish-ref', ['-C', checkout, 'rev-parse', '--verify', '-q', `${ref}^{commit}`]), (sha) => sha || null);

export type Advance = {
  readonly writer: Git['Service'];
  readonly checkout: string;
  readonly places: GitPlaces;
  readonly ref: string | null;
  readonly base: string | null;
  readonly commit: string;
  readonly job: string;
  readonly concluding?: OpenOperation;
  readonly beside?: OpenOperation;
};

export type Advanced =
  | { readonly outcome: 'moved'; readonly ref: string; readonly sha: string | null }
  | { readonly outcome: 'advanced'; readonly ref: string };

export const advance = Effect.fn('platform.git.advance')(function* (
  git: Git['Service'],
  at: Advance,
): Effect.fn.Return<Advanced, MidOperation | OwnGitFailed> {
  const { checkout, base, commit } = at;
  const operation = yield* operationIn(at.places);
  if (operation !== null && operation !== at.concluding && operation !== at.beside) return yield* new MidOperation({ checkout, operation });
  const head = yield* pointedAt(git, checkout);
  const pointed = head.ref ?? 'HEAD';
  const sha = head.commit;
  if ((at.ref !== null && pointed !== at.ref) || sha !== base) return { outcome: 'moved', ref: pointed, sha };
  const sent = yield* Effect.result(
    runGit(at.writer, 'publish-update', [
      '-C',
      checkout,
      'update-ref',
      ...(pointed === 'HEAD' ? ['--no-deref'] : []),
      '-m',
      `tagma landing ${at.job}`,
      '--create-reflog',
      pointed,
      commit,
      base ?? '0'.repeat(commit.length),
    ]),
  );
  if (sent._tag === 'Failure') {
    yield* Effect.logDebug('git refused the ref update, so the ref is read to see where it stands', { reason: sent.failure.message });
    const now = yield* shaOf(git, checkout, pointed);
    if (now === commit || (now !== null && (yield* isAncestor(git, checkout, commit, now)))) {
      return { outcome: 'advanced', ref: pointed };
    }
    if (now !== base) return { outcome: 'moved', ref: pointed, sha: now };
    return yield* Effect.fail(sent.failure);
  }
  return { outcome: 'advanced', ref: pointed };
});

export const publish = Effect.fn('platform.git.publish')(function* <E>(
  git: Git['Service'],
  publication: Publication,
  witness: (commit: string, ref: string) => Effect.Effect<void, E>,
): Effect.fn.Return<Published, MidOperation | OwnGitFailed | E> {
  const { checkout, ref, base, tree, message, job, entries, author } = publication;
  const commit = yield* runGit(
    git,
    'publish-commit',
    ['-C', checkout, 'commit-tree', tree, ...(base === null ? [] : ['-p', base]), '-F', '-'],
    {
      stdin: message,
      env: author === undefined ? undefined : gitIdentity(author),
    },
  );
  yield* witness(commit, ref);
  const places = yield* placesOf(git, checkout);
  const advanced = yield* advance(git, { writer: git, checkout, places, ref, base, commit, job });
  if (advanced.outcome === 'moved') return advanced;
  const unsettled = (failure: Unsettled) => Effect.succeed<Unsettled>(failure);
  const settlement = yield* settleIndex(git, checkout, places, ref, entries).pipe(
    Effect.catchTags({
      IndexBusy: unsettled,
      IndexWriteFailed: unsettled,
      OwnGitFailed: unsettled,
      HoldStalled: unsettled,
      HoldCut: unsettled,
    }),
  );
  return { outcome: 'published', commit, settlement };
});

const isAncestor = (git: Git['Service'], checkout: string, commit: string, tip: string): Effect.Effect<boolean, OwnGitFailed> =>
  Effect.map(quietGit(git, 'receipt-reach', ['-C', checkout, 'merge-base', '--is-ancestor', commit, tip]), (answer) => answer !== null);

export type Receipt = 'committed' | 'rewritten' | 'uncertain';

export const receipt = Effect.fn('platform.git.receipt')(function* (
  git: Git['Service'],
  checkout: string,
  ref: string,
  commit: string,
  job: string,
): Effect.fn.Return<Receipt, OwnGitFailed> {
  if (yield* isAncestor(git, checkout, commit, ref)) return 'committed';
  const reflog = yield* runGit(git, 'receipt-reflog', ['-C', checkout, 'reflog', 'show', '--format=%H %gs', ref, '--']);
  const logged = reflog.split('\n').some((line) => line === `${commit} tagma landing ${job}`);
  return logged ? 'rewritten' : 'uncertain';
});
