import { Context, type Effect, type Scope, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { RootResolutionFailure } from '../../../workspace/contract/wire/roots.js';
import type { Holding, HoldingsFrame, HoldingsView, ThreadTotals } from '../wire/holdings.js';
import type { Verdict } from '../../lines/projection.js';

export type Digests = { readonly head: string | null | undefined; readonly working: string | null | undefined };

export type Judged = {
  readonly holding: Holding;
  readonly verdict: Verdict;
  readonly print: string;
  readonly head: string | null;
  readonly digests: Digests | null;
};

export type HeadSide =
  | { readonly kind: 'blob'; readonly oid: string; readonly mode: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unread'; readonly cause: string };

export type IntroducedSides = { readonly before: HeadSide; readonly after: HeadSide };

export type IntroducedStep = {
  readonly commit: string;
  readonly tree: string | null;
  readonly paths: ReadonlyMap<string, IntroducedSides>;
};

export type IntroducedVerdicts<E> = (step: IntroducedStep, verdicts: ReadonlyMap<string, Verdict>) => Effect.Effect<ReadonlySet<string>, E>;

export type HoldingsChange = {
  readonly checkout: RootId;
  readonly revision: number;
  readonly changed: readonly Holding[];
  readonly gone: readonly string[];
  readonly holders: ReadonlySet<string>;
};

export type HoldingsFailure = StoreFailure | RootResolutionFailure;

export class Holdings extends Context.Service<
  Holdings,
  {
    read(checkout: RootId, wait?: 'settled'): Effect.Effect<HoldingsView, HoldingsFailure>;
    settled(checkout: RootId): Effect.Effect<void, HoldingsFailure>;
    judged(checkout: RootId, paths: readonly string[], scope?: 'required'): Effect.Effect<ReadonlyMap<string, Judged>, HoldingsFailure>;
    introduced<E>(
      checkout: RootId,
      steps: readonly IntroducedStep[],
      decide: IntroducedVerdicts<E>,
    ): Effect.Effect<void, HoldingsFailure | E>;
    lease<A, E, R>(checkout: RootId, paths: readonly string[], work: Effect.Effect<A, E, R>): Effect.Effect<A, E | HoldingsFailure, R>;
    moved(checkout: RootId, paths: readonly string[] | 'all'): Effect.Effect<void>;
    follow(checkout: RootId): Effect.Effect<void, HoldingsFailure, Scope.Scope>;
    threads(threadIds: readonly string[]): Effect.Effect<ReadonlyMap<string, ThreadTotals>, StoreFailure>;
    heldCheckouts(holders: readonly string[]): Effect.Effect<readonly string[], HoldingsFailure>;
    changed(listener: (change: HoldingsChange) => Effect.Effect<void>): () => void;
    subscribe(checkout: RootId): Stream.Stream<HoldingsFrame, HoldingsFailure>;
  }
>()('tagma/change-record/Holdings') {}
