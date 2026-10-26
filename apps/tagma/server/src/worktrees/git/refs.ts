import { Effect } from 'effect';
import { Git } from '@runlith/git/Git';
import { commitOf, headAt, publishedAt, troubleOf } from '@runlith/git/repository';
import { deleteBranchAt, renameBranchAt } from '@runlith/git/worktree';
import { changedBetween } from '@runlith/git/entries';
import { logAt } from '@runlith/git/history';
import { actingGit } from '../../platform/git/ownGit.js';
import { BranchRefRefused, BranchRefs, BranchRefsUnavailable } from '../contract/service/refs.js';

const failed = (failure: Parameters<typeof troubleOf>[0]) =>
  failure._tag === 'GitRefused'
    ? new BranchRefRefused({ message: troubleOf(failure) })
    : new BranchRefsUnavailable({ message: troubleOf(failure) });

export type BranchRefOptions = { readonly purpose?: string };

export const makeGitBranchRefs = Effect.fnUntraced(function* (input: BranchRefOptions = {}) {
  const git = actingGit(yield* Git, input.purpose ?? 'worktree-branch-rename');
  return BranchRefs.of({
    head: (path) => Effect.mapError(headAt(git, path), failed),
    commit: (path, ref) => Effect.mapError(commitOf(git, path, ref), failed),
    published: (path, branch) => Effect.mapError(publishedAt(git, path, branch), failed),
    rename: (path, from, to) => Effect.mapError(renameBranchAt(git, path, from, to), failed),
    changes: (path, from, to) => Effect.mapError(changedBetween(git, path, from, to), failed),
    commits: (path, history) =>
      Effect.map(
        Effect.mapError(
          logAt(git, path, {
            range: `${history.base}..${history.tip}`,
            max: history.limit,
            excludeSubject: history.excludeSubject,
          }),
          failed,
        ),
        (commits) => commits.map(({ sha, subject }) => ({ sha, subject })),
      ),
    remove: (path, branch) => Effect.mapError(deleteBranchAt(git, path, branch, { force: true }), failed),
  });
});
