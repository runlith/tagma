import { Context, Data, type Effect } from 'effect';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';
import type { FinishFailure } from '../../../worktrees/contract/wire/failures.js';
import type { RefusedEdits } from '../../land/reshaping.js';

export type MergePrepared = { readonly tree: string; readonly left: string; readonly message: string; readonly sign: boolean };
export class MergeHookRefused extends Data.TaggedError('MergeHookRefused')<{
  readonly failure: FinishFailure | HoldCut;
  readonly built: string;
  readonly left: string;
  readonly unread: string | null;
}> {}

export type MergeHead = { readonly ref: string | null; readonly commit: string | null };
export type MergeCheckout = { readonly checkout: string; readonly ref: string; readonly base: string; readonly commit: string };
export type MergeSettled = { readonly unsynced: readonly string[]; readonly reason: string | null };
export type MergeCommit = {
  readonly tree: string;
  readonly parents: readonly string[];
  readonly message: string;
  readonly sign: boolean;
};
export type MergeReplay =
  | { readonly head: string; readonly tree: string; readonly conflicts: readonly [] }
  | { readonly head: null; readonly tree: null; readonly conflicts: readonly string[] };
export type MergeInterruption = { readonly ref: string | null; readonly roots: readonly string[] };
export type MergeRemote = { readonly remote: string; readonly branch: string; readonly renamed: boolean };
export type MergeTaking = {
  readonly checkout: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly tip: string;
  readonly baseTip: string;
  readonly tree: string;
};

type Failed = FinishFailure;
type Held = HoldStalled | HoldCut;

export class MergeGit extends Context.Service<
  MergeGit,
  {
    readonly head: (checkout: string) => Effect.Effect<MergeHead, Failed>;
    readonly resolve: (checkout: string, ref: string) => Effect.Effect<string | null, Failed>;
    readonly tree: (checkout: string, commit: string) => Effect.Effect<string, Failed>;
    readonly ancestor: (checkout: string, older: string, newer: string) => Effect.Effect<boolean, Failed>;
    readonly changed: (checkout: string, from: string, to: string, sinceFork?: boolean) => Effect.Effect<readonly string[], Failed>;
    readonly operation: (checkout: string) => Effect.Effect<string | null, Failed>;
    readonly repository: (checkout: string) => Effect.Effect<string, Failed>;
    readonly advance: (at: MergeCheckout, message: string) => Effect.Effect<boolean, Failed>;
    readonly settle: (at: MergeCheckout) => Effect.Effect<MergeSettled>;
    readonly proved: (repository: string, checkout: string, ref: string, commit: string) => Effect.Effect<boolean, Failed>;
    readonly interrupted: (checkout: string) => Effect.Effect<MergeInterruption | null, Failed>;
    readonly abort: (checkout: string) => Effect.Effect<void, Failed>;
    readonly take: (at: MergeTaking) => Effect.Effect<string, Failed | Held>;
    readonly signing: (checkout: string) => Effect.Effect<boolean, Failed>;
    readonly hooks: (
      checkout: string,
      base: string,
      tree: string,
      message: string,
    ) => Effect.Effect<MergePrepared, Failed | MergeHookRefused | Held>;
    readonly create: (checkout: string, commit: MergeCommit) => Effect.Effect<string, Failed>;
    readonly replay: (checkout: string, onto: string, tip: string, sign: boolean) => Effect.Effect<MergeReplay, Failed>;
    readonly posted: (checkout: string, commit: string) => Effect.Effect<void>;
    readonly carry: (projectId: number, checkout: string, from: string, to: string) => Effect.Effect<RefusedEdits>;
    readonly remote: (checkout: string, branch: string) => Effect.Effect<MergeRemote | null, Failed>;
    readonly push: (checkout: string, branch: string, remote: MergeRemote) => Effect.Effect<void, Failed>;
  }
>()('landing/MergeGit') {}
