import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { Identity } from '@runlith/git/merge';
import { OwnGitFailed, runGit } from '../../platform/git/ownGit.js';
import { CEILINGS } from '../../platform/contract/service/deadlines.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { advance, endOperation, type MidOperation } from '../../platform/git/publish.js';
import type { GitPlaces, OpenOperation } from '../../platform/git/places.js';

export type CommitMade = {
  readonly tree: string;
  readonly parents: readonly string[];
  readonly message: string;
  readonly sign: boolean;
  readonly author?: Identity;
};

export type CommitAt = {
  readonly root: string;
  readonly places: GitPlaces;
  readonly ref: string;
  readonly base: string | null;
  readonly job: string;
  readonly concluding?: OpenOperation;
  readonly beside?: OpenOperation;
};

export type CommitPublished = { readonly _tag: 'moved' } | { readonly _tag: 'published'; readonly commit: string };

export type Unsigned = GateRefusal<'commit-unsigned'>;

const MOVED: CommitPublished = { _tag: 'moved' };

const SIGNER = [
  'answer the signer commit.gpgsign names (its pinentry, agent or hardware key), or set gpg.format and user.signingkey so git can sign, then commit again',
] as const;

const unsigned = (root: string, said: string): Unsigned =>
  new GateRefusal(
    'commit-unsigned',
    `the repository at ${root} signs its commits (commit.gpgsign), and git could not sign this one, so nothing was committed: ${said}`,
    SIGNER,
  );

export const midOperation = (root: string, operation: string): GateRefusal<'tree-mid-merge'> =>
  new GateRefusal(
    'tree-mid-merge',
    `a ${operation} is in progress in ${root}, and a commit now would land inside it, so nothing was committed`,
    [
      `wait until whoever started the ${operation} concludes it — commit_checkout concludes a merge, a cherry-pick or a revert — then commit again`,
    ],
  );

const authored = (author: Identity | undefined): Record<string, string> =>
  author === undefined ? {} : { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_AUTHOR_DATE: author.date };

export const makeCommit = (git: Git['Service'], root: string, made: CommitMade): Effect.Effect<string, OwnGitFailed | Unsigned> => {
  const writing = runGit(
    git,
    'commit-make',
    ['-C', root, 'commit-tree', made.tree, ...made.parents.flatMap((parent) => ['-p', parent]), ...(made.sign ? ['-S'] : []), '-F', '-'],
    { stdin: made.message, configured: true, env: authored(made.author) },
  );
  if (!made.sign) return writing;
  return writing.pipe(
    Effect.mapError((failure) => (failure.admission === undefined ? unsigned(root, failure.message) : failure)),
    Effect.timeoutOrElse({
      duration: CEILINGS.callCap,
      orElse: () => Effect.fail(unsigned(root, `the signer did not answer within ${CEILINGS.callCap / 60_000} minutes`)),
    }),
  );
};

export const concluded = (git: Git['Service'], root: string, operation: OpenOperation | null): Effect.Effect<string | null> =>
  operation !== 'merge' && operation !== 'cherry-pick' && operation !== 'revert'
    ? Effect.succeed(null)
    : Effect.flatMap(Effect.result(endOperation(git, root, operation)), (quit) => {
        if (quit._tag === 'Success') return Effect.succeed(null);
        const reason = `the ${operation} commit landed, but its state stayed: ${quit.failure.message}`;
        return Effect.as(Effect.logWarning(reason, { root }), reason);
      });

export const advanced = (
  git: Git['Service'],
  hosted: Git['Service'],
  at: CommitAt,
  commit: string,
): Effect.Effect<CommitPublished, OwnGitFailed | GateRefusal<'tree-mid-merge'>> =>
  advance(git, {
    writer: hosted,
    checkout: at.root,
    places: at.places,
    ref: at.ref,
    base: at.base,
    commit,
    job: at.job,
    concluding: at.concluding,
    beside: at.beside,
  }).pipe(
    Effect.map((moved) => (moved.outcome === 'moved' ? MOVED : ({ _tag: 'published', commit } as const))),
    Effect.catchTag('MidOperation', (failure: MidOperation) => Effect.fail(midOperation(at.root, failure.operation))),
  );
