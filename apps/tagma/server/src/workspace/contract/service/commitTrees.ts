import { Context, type Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';
import type { OwnGitFailed } from '../../../platform/git/ownGit.js';

export type TreePlace = { readonly dir: string; readonly env: Readonly<Record<string, string>> };

export type TreeReach =
  | { readonly _tag: 'all' }
  | { readonly _tag: 'along'; readonly paths: readonly string[] }
  | { readonly _tag: 'nearby'; readonly paths: readonly string[]; readonly uses: readonly string[] };

export const WHOLE_TREE: TreeReach = { _tag: 'all' };

export class CommitTrees extends Context.Service<
  CommitTrees,
  {
    within<A, E, R>(
      git: Git['Service'],
      root: string,
      gitDir: string,
      tree: string,
      reach: TreeReach,
      use: (place: TreePlace) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | OwnGitFailed | HoldStalled | HoldCut, R>;
    standing<A, E, R>(
      root: string,
      gitDir: string,
      use: (place: TreePlace) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | HoldStalled | HoldCut, R>;
    staged(git: Git['Service'], place: TreePlace): Effect.Effect<string, OwnGitFailed>;
    unstaged(git: Git['Service'], place: TreePlace): Effect.Effect<readonly string[], OwnGitFailed>;
    taken(git: Git['Service'], place: TreePlace, paths: readonly string[]): Effect.Effect<string, OwnGitFailed>;
    worked(git: Git['Service'], place: TreePlace, built: string): Effect.Effect<string, OwnGitFailed>;
    drop(root: string): Effect.Effect<void, OwnGitFailed | HoldStalled | HoldCut>;
  }
>()('tagma/workspace/CommitTrees') {}
