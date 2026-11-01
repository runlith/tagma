import type { PullMerge } from '@runlith/git/porcelain';
import type { GitAnswerInvalid, GitRefused, GitUnreadable } from '@runlith/git/repository';
import { Context, Data, type Effect, type PlatformError, type Scope, type Stream } from 'effect';
import type { PlaceRefusal } from '../wire/refusals.js';
import type { IdentityWitness, NamespaceId } from '@runlith/files/namespace';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GraphScoped } from '../../../platform/contract/service/body.js';
import type { CheckoutHolder, CheckoutState } from '../wire/checkout.js';
import type { CheckoutAborted, CheckoutActed, CheckoutDiscarded, CheckoutFetched, CheckoutPushed } from '../wire/checkoutActs.js';
import type { RootId } from '../wire/ids.js';
import type { RootResolutionFailure } from '../wire/roots.js';
import type { GateRefusal, GitRefusal } from '../../../platform/contract/wire/refusal.js';
import type { Actor, ActorRef } from '../../../platform/contract/wire/actor.js';
import type { CommitReading } from '../wire/history.js';
import type { PathHistory } from '../wire/history.js';
import type { ProjectRoot } from '../wire/coverage.js';

export type GitCheckout = {
  readonly key: string | null;
  readonly path: string;
  readonly toplevel: string;
  readonly gitDir: string;
  readonly mainWorktree: string;
};

export type CallerCheckoutState = {
  readonly cwd: string;
  readonly repo: Effect.Effect<GitCheckout | null, GitUnreadable | GitRefused | GitAnswerInvalid>;
};

export const CallerCheckout = Context.Reference<CallerCheckoutState | undefined>('tagma/workspace/CallerCheckout', {
  defaultValue: () => undefined,
});

export type CheckoutRoot = {
  readonly rootId: RootId;
  readonly path: string;
  readonly namespaceId: NamespaceId;
  readonly witness: IdentityWitness;
};

export class CheckoutWriteRefused extends Data.TaggedError('CheckoutWriteRefused')<{
  readonly reason:
    | 'graph-path'
    | 'no-operation'
    | 'no-paths'
    | 'no-remote'
    | 'root-moved'
    | 'row-stale'
    | 'record-unread'
    | 'git-refused'
    | 'git-unreadable'
    | 'git-incomplete';
  readonly message: string;
  readonly unblock: readonly [string, ...string[]];
}> {}

export type CheckoutAt = { readonly projectId: number; readonly rootId: RootId; readonly judged: string | null };

export type CheckoutWriteFailure = CheckoutWriteRefused | RootResolutionFailure;

export type CheckoutPulling = CheckoutActed & {
  readonly head: string | null;
  readonly moved: boolean;
  readonly merge: PullMerge | null;
  readonly conflicted: boolean;
};

export class PathUnreadable extends Data.TaggedError('PathUnreadable')<{
  readonly path: string;
  readonly cause: PlatformError.PlatformError;
  readonly asking: 'read' | 'probe';
}> {}

export type HeadMoved = { readonly checkout: string; readonly head: string | null };

export type HeadObservation =
  | ({ readonly kind: 'read' } & HeadMoved)
  | { readonly kind: 'unread'; readonly checkout: string; readonly reason: string }
  | { readonly kind: 'gone'; readonly checkout: string; readonly reason: string };

export type CheckoutsMoved = { readonly root: string; readonly watching: boolean };

export class CheckoutRows extends Context.Service<
  CheckoutRows,
  {
    read(rootId: RootId, base?: string): Effect.Effect<CheckoutState, RootResolutionFailure>;
    refresh(
      rootId: RootId,
      base?: string,
    ): Effect.Effect<CheckoutState, RootResolutionFailure | GitUnreadable | GitRefused | GitAnswerInvalid>;
    subscribe(rootId: RootId, base?: string): Stream.Stream<CheckoutState, RootResolutionFailure>;
    follow(rootId: RootId, base?: string): Effect.Effect<Stream.Stream<CheckoutState>, RootResolutionFailure, Scope.Scope>;
    mark(rootId: RootId, why?: string, paths?: readonly string[]): Effect.Effect<void>;
    onMark(listener: (rootId: RootId, paths: readonly string[] | undefined) => Effect.Effect<void>): () => void;
    headMoved(checkout: string): Stream.Stream<HeadMoved>;
    headObserved(checkout: string): Stream.Stream<HeadObservation>;
    checkoutsMoved(root: string): Stream.Stream<CheckoutsMoved>;
  }
>()('tagma/workspace/CheckoutRows') {}

export class CheckoutWrites extends Context.Service<
  CheckoutWrites,
  {
    stage(at: CheckoutAt, paths: readonly string[]): Effect.Effect<CheckoutActed, CheckoutWriteFailure>;
    unstage(at: CheckoutAt, paths: readonly string[]): Effect.Effect<CheckoutActed, CheckoutWriteFailure>;
    discard(at: CheckoutAt, paths: readonly string[]): Effect.Effect<CheckoutDiscarded, CheckoutWriteFailure>;
    push(
      at: CheckoutAt,
      options: { readonly remote?: string; readonly branch?: string; readonly setUpstream?: boolean },
    ): Effect.Effect<CheckoutPushed, CheckoutWriteFailure>;
    fetch(at: CheckoutAt): Effect.Effect<CheckoutFetched, CheckoutWriteFailure>;
    pull(at: CheckoutAt): Effect.Effect<CheckoutPulling, CheckoutWriteFailure>;
    abort(at: CheckoutAt): Effect.Effect<CheckoutAborted, CheckoutWriteFailure>;
    act<A, E, R>(
      at: CheckoutAt,
      work: (root: string) => Effect.Effect<A, E, R>,
      touched: (answer: A) => readonly string[],
    ): Effect.Effect<
      { readonly answer: A; readonly writing: readonly string[]; readonly ahead: number | null },
      E | CheckoutWriteFailure,
      R
    >;
  }
>()('tagma/workspace/CheckoutWrites') {}

export class CheckoutHoldings extends Context.Service<
  CheckoutHoldings,
  {
    holdersOf(
      rootId: RootId,
      paths: readonly string[],
    ): Effect.Effect<ReadonlyMap<string, readonly CheckoutHolder[]>, StoreFailure | RootResolutionFailure>;
  }
>()('tagma/workspace/CheckoutHoldings') {}

export class GraphDirectory extends Context.Service<GraphDirectory, string>()('tagma/workspace/GraphDirectory') {}

export type HolderLabel = {
  readonly name: string;
  readonly title: string;
};

export class HolderLabels
  extends Context.Service<
    HolderLabels,
    {
      forHolders(threadIds: readonly string[]): Effect.Effect<ReadonlyMap<string, readonly HolderLabel[]>, StoreFailure>;
    }
  >()('tagma/workspace/HolderLabels')
  implements GraphScoped
{
  declare readonly graphScoped: true;
}

export class CheckoutActor extends Context.Service<
  CheckoutActor,
  {
    resolve(actor: Actor, projectId: number): ActorRef | null;
  }
>()('tagma/workspace/CheckoutActor') {}

export class CommitOverlay extends Context.Service<
  CommitOverlay,
  {
    pathsOf(
      rootId: RootId,
      projectId: number,
      threadId: string,
      commit: string,
    ): Effect.Effect<ReadonlySet<string>, StoreFailure | RootResolutionFailure>;
  }
>()('tagma/workspace/CommitOverlay') {}

export type CheckoutCaller = {
  readonly projectId: number;
  readonly cwd: string | undefined;
};

export type CommitRefusal = PlaceRefusal | GitRefusal | 'bad-cursor' | 'cursor-stale' | 'record-unread';

export class CheckoutHistory extends Context.Service<
  CheckoutHistory,
  {
    history(
      caller: CheckoutCaller,
      asked: {
        readonly root?: string;
        readonly path?: string;
        readonly grep?: string;
        readonly limit?: number;
        readonly cursor?: string;
      },
      graphAuthors: ReadonlySet<string>,
    ): Effect.Effect<PathHistory, GateRefusal<PlaceRefusal | GitRefusal | 'bad-cursor' | 'cursor-stale'>>;
    commit(
      caller: CheckoutCaller,
      asked: {
        readonly root?: string;
        readonly commit: string;
        readonly thread?: string;
        readonly limit?: number;
        readonly cursor?: string;
      },
      overlay?: CommitOverlay['Service'],
    ): Effect.Effect<CommitReading, GateRefusal<CommitRefusal>>;
  }
>()('tagma/workspace/CheckoutHistory') {}

export class CheckoutPlaces extends Context.Service<
  CheckoutPlaces,
  {
    rootOf(caller: CheckoutCaller, root?: string): Effect.Effect<RootId, GateRefusal<PlaceRefusal>>;
    placeOf(caller: CheckoutCaller, root?: string): Effect.Effect<ProjectRoot, GateRefusal<PlaceRefusal>>;
  }
>()('tagma/workspace/CheckoutPlaces') {}
