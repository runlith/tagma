import { Context, Data, type Effect } from 'effect';
import type { BranchCommit } from '../wire/retirement.js';

export type BranchHead = { readonly ref: string | null; readonly commit: string | null };
export type BranchHistory = { readonly base: string; readonly tip: string; readonly limit: number; readonly excludeSubject?: string };

export class BranchRefRefused extends Data.TaggedError('BranchRefRefused')<{
  readonly message: string;
}> {}

export class BranchRefsUnavailable extends Data.TaggedError('BranchRefsUnavailable')<{
  readonly message: string;
}> {}

export type BranchRefFailure = BranchRefRefused | BranchRefsUnavailable;

export class BranchRefs extends Context.Service<
  BranchRefs,
  {
    head(path: string): Effect.Effect<BranchHead, BranchRefFailure>;
    commit(path: string, ref: string): Effect.Effect<string | null, BranchRefFailure>;
    published(path: string, branch: string): Effect.Effect<boolean, BranchRefFailure>;
    rename(path: string, from: string, to: string): Effect.Effect<void, BranchRefFailure>;
    changes(path: string, from: string, to: string): Effect.Effect<readonly string[], BranchRefFailure>;
    commits(path: string, history: BranchHistory): Effect.Effect<readonly BranchCommit[], BranchRefFailure>;
    remove(path: string, branch: string): Effect.Effect<void, BranchRefFailure>;
  }
>()('tagma/worktrees/BranchRefs') {}
