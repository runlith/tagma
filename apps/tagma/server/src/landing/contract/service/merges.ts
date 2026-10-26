import { Context, type Effect } from 'effect';
import type { Principal } from '@runlith/executions/protocol/custody';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { FinishingPlace, MergeAfter, MergeMode, PendingMerge } from '../../../worktrees/contract/wire/mergeTypes.js';
import type { FinishFailure } from '../../../worktrees/contract/wire/failures.js';
import type { TerminalActor } from '../../../executions/contract/wire/terminals.js';
import type { MergedAfter } from '../../../worktrees/contract/wire/entries.js';
import type { MergeReading, WorktreeMergeAnswer, WorktreeMergeCancelled, WorktreeMerged, WorktreePullRequest } from '../wire/merge.js';

export type MergeOptions = {
  readonly mode?: MergeMode;
  readonly message?: string;
  readonly after?: MergeAfter;
  readonly waited?: { readonly queuedAt: Date; readonly attempts: number };
  readonly end?: TerminalActor;
  readonly caller?: TerminalActor;
};

export type MergeRequest = {
  readonly mode: MergeMode;
  readonly message: string | null;
  readonly after: MergeAfter;
  readonly end: Principal | null;
  readonly caller?: TerminalActor;
};

export type PullRequestDraft = { readonly title?: string; readonly body?: string; readonly draft?: boolean };

export type MergedNote = {
  readonly rootId: RootId;
  readonly name: string;
  readonly branch: string;
  readonly base: string;
  readonly mode: MergeMode;
  readonly commit: string;
  readonly waitedSince?: string;
  readonly after: MergedAfter;
};

export type MergeRecovery = {
  readonly aborted: readonly string[];
  readonly published: readonly {
    readonly path: string;
    readonly commit: string;
    readonly unsynced: readonly string[];
    readonly reason: string | null;
  }[];
  readonly uncertain: readonly { readonly path: string; readonly commit: string; readonly rootId: string | null }[];
  readonly unread: readonly { readonly projectId: number | null; readonly path: string | null; readonly reason: string }[];
};

export class Merges extends Context.Service<
  Merges,
  {
    readonly checkMerge: (projectId: number, rootId: RootId) => Effect.Effect<MergeReading, FinishFailure>;
    readonly merge: (projectId: number, rootId: RootId, options: MergeOptions) => Effect.Effect<WorktreeMerged, FinishFailure>;
    readonly openPullRequest: (
      projectId: number,
      rootId: RootId,
      draft: PullRequestDraft,
    ) => Effect.Effect<WorktreePullRequest, FinishFailure>;
    readonly recover: () => Effect.Effect<MergeRecovery, StoreFailure>;
    readonly placeOf: (projectId: number, rootId: RootId, withBase: boolean) => Effect.Effect<FinishingPlace, FinishFailure>;
    readonly termsOf: (
      projectId: number,
      rootId: RootId,
      after: MergeAfter,
      asking: string | null,
    ) => Effect.Effect<FinishingPlace, FinishFailure>;
    readonly baseRootOf: (projectId: number, rootId: RootId) => Effect.Effect<RootId | null, FinishFailure>;
  }
>()('tagma/landing/Merges') {}

export class PendingMerges extends Context.Service<
  PendingMerges,
  {
    readonly merge: (
      projectId: number,
      rootId: RootId,
      request: MergeRequest,
      whenBaseFree: boolean,
    ) => Effect.Effect<WorktreeMergeAnswer, FinishFailure>;
    readonly cancel: (projectId: number, rootId: RootId) => Effect.Effect<WorktreeMergeCancelled, FinishFailure>;
    readonly onMoved: (listener: (projectId: number) => void) => () => void;
    readonly ofProject: (projectId: number) => Effect.Effect<readonly PendingMerge[], FinishFailure>;
    readonly resume: () => Effect.Effect<number, FinishFailure>;
  }
>()('tagma/landing/PendingMerges') {}
