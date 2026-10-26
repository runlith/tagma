import { Data, Cause, Context, Effect, Layer, Option, Ref, Semaphore } from 'effect';
import { ConnectionId, CustodianEpoch, HostCustody, type HostCustodyRevision, Role } from '@runlith/executions/protocol/registration';
import { type Incarnation, HostRequestRef, HostRequestKey } from '@runlith/executions/protocol/execution';
import { HostAdmission, type AdmissionRefused } from './HostAdmission';
import { ExecutionStore } from './store/ExecutionStore';
import type { CustodyAcceptance } from './store/custody';
import {
  type CustodyConflict,
  CustodyLost,
  type CustodyRefused,
  type OperationConflict,
  type StoreFailure,
  type StoreLost,
  type StoreUnreadable,
} from './store/errors';
import type { CapacityRefused, ReceiptCountInvalid } from './ExecutionCapacity';

export type CustodianState =
  | { readonly _tag: 'Settled'; readonly custody: HostCustody }
  | { readonly _tag: 'Unresolved'; readonly operation: HostRequestRef; readonly last: HostCustody };

export type CustodyEnding =
  | { readonly _tag: 'Released'; readonly acceptance: CustodyAcceptance }
  | { readonly _tag: 'HeldNothing'; readonly custody: HostCustody };

export class CustodianRefused extends Data.TaggedError('CustodianRefused')<{
  readonly presented: CustodianEpoch;
  readonly current?: CustodianEpoch;
}> {
  override get message(): string {
    return `custodian epoch ${this.presented} is not held${this.current === undefined ? '' : `; ${this.current} is current`}`;
  }
}

export class RoleRefused extends Data.TaggedError('RoleRefused')<{ readonly role: Role; readonly act: 'take' | 'fence' }> {
  override get message(): string {
    return `${this.role} may not ${this.act} host custody`;
  }
}

export type CustodyFailure =
  | CustodyConflict
  | CustodyRefused
  | CustodyLost
  | OperationConflict
  | CapacityRefused
  | ReceiptCountInvalid
  | StoreLost
  | StoreUnreadable
  | StoreFailure;

export class Custodian extends Context.Service<
  Custodian,
  {
    readonly take: (
      operation: HostRequestRef,
      expected: HostCustodyRevision,
      connection: ConnectionId,
      role: Role,
    ) => Effect.Effect<CustodyAcceptance, RoleRefused | AdmissionRefused | CustodyFailure>;
    readonly fence: (
      operation: HostRequestRef,
      expected: HostCustodyRevision,
      connection: ConnectionId,
      role: Role,
    ) => Effect.Effect<CustodyAcceptance, RoleRefused | CustodyFailure>;
    readonly release: (
      operation: HostRequestRef,
      connection: ConnectionId,
      custody: HostCustody,
    ) => Effect.Effect<CustodyAcceptance, CustodianRefused | CustodyFailure>;
    readonly ended: (operation: HostRequestRef, connection: ConnectionId) => Effect.Effect<CustodyEnding, CustodyFailure>;
    readonly check: (epoch: CustodianEpoch, connection: ConnectionId) => Effect.Effect<HostCustody, CustodianRefused | CustodyLost>;
    readonly current: () => Effect.Effect<CustodianState>;
  }
>()('@runlith/execution-host/Custodian') {
  static layer(incarnation: Incarnation) {
    return Layer.effect(Custodian, make({ incarnation }));
  }
}

const held = (standing: CustodianState): HostCustody => (standing._tag === 'Settled' ? standing.custody : standing.last);

const leftBehind = Effect.fnUntraced(function* (store: ExecutionStore['Service'], incarnation: Incarnation, custody: HostCustody) {
  const holder = custody.holder;
  if (holder === undefined || holder.incarnation !== incarnation) return custody;
  const { installation } = yield* store.incarnation();
  const operation: HostRequestRef = {
    installation,
    operation: HostRequestKey.make(`custody-left:${holder.connection}:${custody.revision}`),
  };
  return yield* store.acceptCustody({ _tag: 'Release', operation, expected: custody.revision, epoch: custody.epoch, holder }).pipe(
    Effect.matchEffect({
      onSuccess: (ended) => Effect.succeed(ended.standing),
      onFailure: (failure) => {
        if (failure._tag === 'CustodyConflict') return Effect.succeed(failure.standing);
        if (
          failure._tag === 'StoreLost' ||
          failure._tag === 'StoreUnreadable' ||
          failure._tag === 'EffectDrizzleQueryError' ||
          failure._tag === 'SqlError'
        )
          return Effect.fail(failure);
        return Effect.as(Effect.logWarning(`the custody a departed logic's connection held stays recorded: ${failure._tag}`), custody);
      },
    }),
  );
});

type CustodianInput = { readonly incarnation: Incarnation };
const make = Effect.fn('Custodian.make')(function* ({ incarnation }: CustodianInput) {
  const store = yield* ExecutionStore;
  const admission = yield* HostAdmission;
  const seed = yield* leftBehind(store, incarnation, yield* store.hostCustody());
  const state = yield* Ref.make<CustodianState>({ _tag: 'Settled', custody: seed });
  const handover = yield* Semaphore.make(1);

  const settled = (custody: HostCustody): CustodianState => ({ _tag: 'Settled', custody });

  const unresolved = (claim: HostRequestRef) =>
    Ref.update(state, (standing): CustodianState => ({ _tag: 'Unresolved', operation: claim, last: held(standing) }));

  const settle = (claim: HostRequestRef, outcome: Effect.Effect<CustodyAcceptance, CustodyFailure>) =>
    outcome.pipe(
      Effect.tap((acceptance) => Ref.set(state, settled(acceptance.standing))),
      Effect.tapError((failure) =>
        failure._tag === 'CustodyConflict'
          ? Ref.set(state, settled(failure.standing))
          : failure._tag === 'CustodyLost'
            ? unresolved(claim)
            : Effect.void,
      ),
      Effect.onError((cause) => (Option.isSome(Cause.findErrorOption(cause)) ? Effect.void : unresolved(claim))),
    );

  const resolve = Effect.gen(function* () {
    const standing = yield* Ref.get(state);
    if (standing._tag === 'Settled') return standing.custody;
    const answer = yield* store.custodyAnswer(standing.operation);
    yield* Ref.set(state, settled(answer.standing));
    return answer.standing;
  });

  const transition = <A, E>(work: Effect.Effect<A, E>) => handover.withPermits(1)(Effect.uninterruptible(work));

  return Custodian.of({
    take: (operation, expected, connection, role) =>
      role !== 'custodian'
        ? Effect.fail(new RoleRefused({ role, act: 'take' }))
        : transition(
            Effect.gen(function* () {
              yield* admission.admit('durable');
              yield* resolve;
              return yield* settle(operation, store.acceptCustody({ _tag: 'Take', operation, expected, connection }));
            }),
          ),

    fence: (operation, expected, connection, role) =>
      role !== 'recovery'
        ? Effect.fail(new RoleRefused({ role, act: 'fence' }))
        : transition(
            Effect.gen(function* () {
              yield* resolve;
              return yield* settle(operation, store.acceptCustody({ _tag: 'Fence', operation, expected, connection }));
            }),
          ),

    release: (operation, connection, custody) =>
      Effect.suspend((): Effect.Effect<CustodyAcceptance, CustodianRefused | CustodyFailure> => {
        const holder = custody.holder;
        if (holder === undefined || holder.connection !== connection) {
          return Effect.fail(new CustodianRefused({ presented: custody.epoch }));
        }
        return transition(
          Effect.gen(function* () {
            yield* resolve;
            return yield* settle(
              operation,
              store.acceptCustody({
                _tag: 'Release',
                operation,
                expected: custody.revision,
                epoch: custody.epoch,
                holder,
              }),
            );
          }),
        );
      }),

    ended: (operation, connection) =>
      transition(
        Effect.gen(function* () {
          const custody = yield* resolve;
          const holder = custody.holder;
          if (holder === undefined || holder.connection !== connection || holder.incarnation !== incarnation) {
            return { _tag: 'HeldNothing', custody } satisfies CustodyEnding;
          }
          const acceptance = yield* settle(
            operation,
            store.acceptCustody({
              _tag: 'Release',
              operation,
              expected: custody.revision,
              epoch: custody.epoch,
              holder,
            }),
          );
          return { _tag: 'Released', acceptance } satisfies CustodyEnding;
        }),
      ),

    check: (epoch, connection) =>
      Effect.flatMap(Ref.get(state), (standing): Effect.Effect<HostCustody, CustodianRefused | CustodyLost> => {
        if (standing._tag === 'Unresolved') return Effect.fail(new CustodyLost({ operation: standing.operation, reason: 'unresolved' }));
        const custody = standing.custody;
        const holder = custody.holder;
        const holds = holder !== undefined && holder.incarnation === incarnation;
        return holds && custody.epoch === epoch && holder?.connection === connection
          ? Effect.succeed(custody)
          : Effect.fail(new CustodianRefused({ presented: epoch, current: holds ? custody.epoch : undefined }));
      }),

    current: () => Ref.get(state),
  });
});
