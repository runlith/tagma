import type { Effect, Scope } from 'effect';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { WorktreeActivity, WorktreeActKind, WorktreeActPhase } from '../wire/rows.js';

export type Turns = { readonly take: <A, E, R>(rootId: RootId, work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> };

export const UNQUEUED: Turns = { take: (_rootId, work) => work };

export type ActProgress = {
  readonly of: (projectId: number) => readonly WorktreeActivity[];
  readonly leaving: (rootId: string) => boolean;
  readonly departs: <A, E, R>(rootId: RootId, work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly onMoved: (listener: (projectId: number) => void) => () => void;
  readonly during: <A, E, R>(
    projectId: number,
    rootId: RootId,
    act: WorktreeActKind,
    work: Effect.Effect<A, E, R>,
    options?: { readonly deferred?: boolean },
  ) => Effect.Effect<A, E, R>;
  readonly detached: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly shown: (rootId: RootId) => Effect.Effect<void>;
  readonly phase: (rootId: RootId, phase: WorktreeActPhase) => Effect.Effect<void>;
  readonly queue: (projectId: number, rootIds: readonly RootId[], act: WorktreeActKind) => Effect.Effect<Turns, never, Scope.Scope>;
};
