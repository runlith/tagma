import { Data, Effect, Ref } from 'effect';
import type { Principal, CustodyRevision, CustodyState } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { CustodyTransfer } from '@runlith/executions/protocol/control';
import { ExecutionStore } from './store/ExecutionStore';
import {
  RevisionConflict,
  type IncarnationRefused,
  type StoredExecutionMissing,
  type StoreFailure,
  type StoreLost,
  type StoreUnreadable,
} from './store/errors';

export class NotHolder extends Data.TaggedError('NotHolder')<{ readonly execution: string; readonly presented: Principal }> {
  override get message(): string {
    return `${this.presented} does not hold ${this.execution}`;
  }
}

export const custodySentence = (failure: NotHolder): string =>
  `${failure.presented} does not hold ${failure.execution}, so it cannot hand it on. Nothing was applied.`;

export type CustodyMoveFailure =
  | NotHolder
  | RevisionConflict
  | IncarnationRefused
  | StoredExecutionMissing
  | StoreLost
  | StoreUnreadable
  | StoreFailure;

export type CustodyAccepted = {
  readonly custody: CustodyState;
};

export type ExecutionCustody = {
  readonly ref: ExecutionRef;
  readonly current: Effect.Effect<CustodyState>;
  readonly accept: (
    principal: Principal,
    expected: CustodyRevision,
    act: CustodyTransfer,
  ) => Effect.Effect<CustodyAccepted, CustodyMoveFailure>;
};

export type CustodyInput = { readonly ref: ExecutionRef };

export const makeExecutionCustody = Effect.fnUntraced(function* ({ ref }: CustodyInput) {
  const store = yield* ExecutionStore;
  const state = yield* Ref.make(yield* store.custodyOf(ref.execution));
  return {
    ref,
    current: Ref.get(state),
    accept: Effect.fnUntraced(function* (principal, expected, act) {
      const standing = yield* Ref.get(state);
      if (standing.revision !== expected) {
        return yield* new RevisionConflict({ execution: ref.execution, expected });
      }
      if (standing.holder !== principal) {
        return yield* new NotHolder({ execution: ref.execution, presented: principal });
      }
      const custody = yield* store.updateCustody(ref, expected, { holder: act.holder });
      yield* Ref.set(state, custody);
      return { custody };
    }),
  } satisfies ExecutionCustody;
});
