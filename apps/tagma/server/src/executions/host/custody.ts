import { randomUUID } from 'node:crypto';
import { Effect, Ref } from 'effect';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import type { SessionTake, SessionWelcome } from '@runlith/executions/ExecutionClient';
import type { CancellationCause } from '@runlith/executions/protocol/call';
import type { CancelAnswer, LaunchRequest, StartAnswer } from '@runlith/executions/protocol/launch';
import {
  type ExecutionRef,
  type Incarnation,
  type InstallationId,
  type HostRequestRef,
  HostRequestKey,
} from '@runlith/executions/protocol/execution';
import type { Refusal } from '@runlith/executions/protocol/host';
import type { HostCustody } from '@runlith/executions/protocol/registration';
import type { AuthorityAnswer } from '@runlith/executions/protocol/wire';
import type { ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import type { Digest } from '@runlith/executions/protocol/artifact';
import type { HostLifetime } from '@runlith/executions/protocol/boot';
import { makeHostActivation, type Deferral, type SchemaPosition } from './activation.js';
import type { HostPort } from './connection.js';
import type { StopPrevention } from '@runlith/executions/protocol/stop';

export type CustodyDeferral =
  | { readonly _tag: 'NoBundle' }
  | { readonly _tag: 'ActivationDeferred'; readonly reason: Deferral }
  | { readonly _tag: 'HeldElsewhere'; readonly custody: HostCustody; readonly incarnation: Incarnation }
  | { readonly _tag: 'TakeRefused'; readonly refusal: Refusal }
  | { readonly _tag: 'TakeUnresolved'; readonly operation: HostRequestRef }
  | { readonly _tag: 'TakeContended'; readonly standing: HostCustody }
  | { readonly _tag: 'HostUnreachable'; readonly failure: ExecutionsFailure };

export type CustodyAssurance =
  | { readonly _tag: 'Held'; readonly custody: HostCustody }
  | { readonly _tag: 'Declined'; readonly reason: CustodyDeferral };

export type CustodyOffer = {
  readonly executions: HostPort;
  readonly served?: HostPort;
  readonly welcome: Ref.Ref<SessionWelcome | undefined>;
  readonly installation: InstallationId;
  readonly state: string;
  readonly offered?: {
    readonly bundle: string;
    readonly digest: Digest;
    readonly database: SchemaPosition;
    readonly application: SchemaPosition;
    readonly policy: ExecutionPolicy;
    readonly lifetime?: HostLifetime;
  };
  readonly ready?: Effect.Effect<void>;
};

type CustodyDecision = { readonly _tag: 'Take' } | { readonly _tag: 'Decline'; readonly assurance: CustodyAssurance };

const held = (custody: HostCustody): CustodyAssurance => ({ _tag: 'Held', custody });

const declined = (reason: CustodyDeferral): CustodyAssurance => ({ _tag: 'Declined', reason });

export const detailOf = (reason: CustodyDeferral, state: string): string => {
  switch (reason._tag) {
    case 'NoBundle':
      return 'this installation offers no host bundle, so activation cannot decide custody; offer one and the floor takes the host';
    case 'ActivationDeferred':
      return `activation deferred adoption: ${activationDetail(reason.reason)}`;
    case 'HeldElsewhere': {
      const holder = reason.custody.holder;
      return `host custody is held by connection ${holder?.connection ?? 'none'} of generation ${holder?.incarnation ?? 'none'} at revision ${reason.custody.revision} epoch ${reason.custody.epoch}; this floor holds nothing — ask its holder to release it, or fence it through independent recovery when it no longer answers`;
    }
    case 'TakeRefused':
      return `the host refused the take: ${reason.refusal._tag} — ${reason.refusal.reason}`;
    case 'TakeUnresolved':
      return `the take under ${reason.operation.operation} was not acknowledged; read that key back before starting`;
    case 'TakeContended':
      return `host custody moved under two takes and stands at revision ${reason.standing.revision}; another taker is racing — try the start again`;
    case 'HostUnreachable':
      return `the execution host could not be read: ${unreachableDetail(reason.failure)}`;
  }
};

const activationDetail = (reason: Deferral): string => {
  switch (reason._tag) {
    case 'OfferUnproved':
      return `the offered bundle is not what it claims: ${reason.refusal._tag}`;
    case 'RegistrationUnusable':
      return `no registration can be acted on: ${reason.refusal._tag}`;
    case 'HostUnknown':
      return reason.reason;
    case 'BundleMismatch':
      return `the host recorded ${reason.standing} and this installation needs ${reason.offered}`;
    case 'BootUnusable':
      return `the host boot input could not be read: ${reason.detail}`;
    case 'BootMismatch':
      return 'the host boot input differs from the one this installation supplies';
    case 'SchemaAhead':
      return `the database stands at ${reason.database.applied} migrations and the offered application ships ${reason.application.applied}; adopting would demand a rollback`;
    case 'SchemaDiverged':
      return `the database and the offered application stand at ${reason.database.applied} migrations under different heads`;
  }
};

const flattened = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ');

const unreachableDetail = (failure: ExecutionsFailure): string => {
  switch (failure._tag) {
    case 'WireUnavailable':
      return `${failure.kind}: ${failure.reason}`;
    case 'WireUnreadable':
    case 'WireInvalid':
      return flattened(failure.detail);
    case 'WireFailed':
      return `the host refused the hello: ${failure.fault.kind} — ${flattened(failure.fault.detail)}`;
    case 'WireLost':
      return `the connection closed: ${failure.reason}`;
    case 'HostRefused':
      return `${failure.refusal._tag}: ${flattened(failure.refusal.reason)}`;
  }
};

type Taken = { readonly _tag: 'Done'; readonly assurance: CustodyAssurance } | { readonly _tag: 'Moved'; readonly standing: HostCustody };

const done = (assurance: CustodyAssurance): Taken => ({ _tag: 'Done', assurance });

const decide = (custody: HostCustody, incarnation: Incarnation, remembered: HostCustody | undefined): CustodyDecision => {
  const holder = custody.holder;
  if (holder === undefined) return { _tag: 'Take' };
  if (holder.incarnation !== incarnation) return { _tag: 'Take' };
  if (
    remembered?.holder !== undefined &&
    remembered.holder.connection === holder.connection &&
    remembered.holder.incarnation === holder.incarnation
  ) {
    return { _tag: 'Take' };
  }
  return { _tag: 'Decline', assurance: declined({ _tag: 'HeldElsewhere', custody, incarnation }) };
};

export type TerminalHostCustody = Effect.Success<ReturnType<typeof makeTerminalHostCustody>>;

export const makeTerminalHostCustody = Effect.fnUntraced(function* ({
  executions,
  served = executions,
  welcome,
  installation,
  state,
  offered,
  ready = Effect.void,
}: CustodyOffer) {
  const activation = yield* makeHostActivation;
  const custody = yield* Ref.make<HostCustody | undefined>(undefined);
  const adopted = yield* Ref.make(false);

  const remember = (taken: HostCustody): Effect.Effect<void> =>
    Ref.update(custody, (standing) =>
      standing !== undefined &&
      standing.holder?.connection === taken.holder?.connection &&
      standing.holder?.incarnation === taken.holder?.incarnation &&
      standing.revision > taken.revision
        ? standing
        : taken,
    );

  const ours = (standing: HostCustody, incarnation: Incarnation): Effect.Effect<boolean> =>
    Effect.map(
      Ref.get(welcome),
      (seen) => seen !== undefined && standing.holder?.connection === seen.connection && standing.holder.incarnation === incarnation,
    );

  const settled = Effect.fnUntraced(function* (key: HostRequestRef, expected: HostCustody): Effect.fn.Return<Taken> {
    const back = yield* Effect.result(executions.operation(key));
    if (back._tag === 'Failure') return done(declined({ _tag: 'HostUnreachable', failure: back.failure }));
    const answer = back.success;
    switch (answer._tag) {
      case 'Accepted': {
        const status = yield* Effect.result(executions.status());
        if (status._tag === 'Failure') return done(declined({ _tag: 'HostUnreachable', failure: status.failure }));
        const standing = status.success.custody;
        if (standing.revision === expected.revision + 1 && standing.epoch === expected.epoch + 1) {
          yield* remember(standing);
          return done(held(standing));
        }
        return done(declined({ _tag: 'HeldElsewhere', custody: standing, incarnation: status.success.incarnation }));
      }
      case 'Unanswered': {
        const status = yield* Effect.result(executions.status());
        if (status._tag === 'Failure') return done(declined({ _tag: 'HostUnreachable', failure: status.failure }));
        return { _tag: 'Moved', standing: status.success.custody };
      }
      case 'Refused':
        return done(declined({ _tag: 'TakeRefused', refusal: answer.refusal }));
      case 'Cancelled':
      case 'Uncertain':
        return done(declined({ _tag: 'TakeUnresolved', operation: key }));
    }
  });

  const takeOnce = Effect.fnUntraced(function* (standing: HostCustody): Effect.fn.Return<Taken> {
    const key: HostRequestRef = { installation, operation: HostRequestKey.make(`host-take-${randomUUID()}`) };
    const outcome = yield* Effect.result(executions.take(key, standing.revision));
    if (outcome._tag === 'Failure') return yield* settled(key, standing);
    const answered: AuthorityAnswer = outcome.success;
    switch (answered._tag) {
      case 'Held':
        yield* remember(answered.custody);
        return done(held(answered.custody));
      case 'Stale':
        return { _tag: 'Moved', standing: answered.standing };
      case 'Refused':
        return done(declined({ _tag: 'TakeRefused', refusal: answered.refusal }));
      case 'Unresolved':
        return yield* settled(key, standing);
      case 'Bound':
      case 'Unbound':
      case 'Granted':
        return done(
          declined({
            _tag: 'TakeRefused',
            refusal: {
              _tag: 'HostUnavailable',
              reason: `the host answered TakeHost with ${answered._tag}, which its contract never sends`,
            },
          }),
        );
    }
  });

  const contend = Effect.fnUntraced(function* (standing: HostCustody, takesLeft: number): Effect.fn.Return<CustodyAssurance> {
    const first = yield* takeOnce(standing);
    if (first._tag === 'Done') return first.assurance;
    if (takesLeft <= 1) return declined({ _tag: 'TakeContended', standing: first.standing });
    const status = yield* Effect.result(executions.status());
    if (status._tag === 'Failure') return declined({ _tag: 'HostUnreachable', failure: status.failure });
    const seen = status.success;
    if (yield* ours(seen.custody, seen.incarnation)) {
      yield* remember(seen.custody);
      return held(seen.custody);
    }
    const decision = decide(seen.custody, seen.incarnation, yield* Ref.get(custody));
    if (decision._tag === 'Decline') return decision.assurance;
    return yield* contend(seen.custody, takesLeft - 1);
  });

  const ensure = Effect.fnUntraced(function* (options?: {
    readonly fresh?: boolean;
    readonly seen?: boolean;
  }): Effect.fn.Return<CustodyAssurance> {
    if (offered === undefined) return declined({ _tag: 'NoBundle' });
    const fresh = options?.fresh ?? false;
    const remembered = yield* Ref.get(custody);
    const adopting = !(yield* Ref.get(adopted));
    if (
      !fresh &&
      options?.seen !== true &&
      remembered !== undefined &&
      !adopting &&
      remembered.holder?.connection === (yield* Ref.get(welcome))?.connection
    )
      return held(remembered);
    if (adopting) {
      const adoption = yield* activation.adoption(
        offered.bundle,
        state,
        { database: offered.database, application: offered.application },
        offered.policy,
        offered.digest,
        offered.lifetime,
      );
      if (adoption._tag === 'Defer') return declined({ _tag: 'ActivationDeferred', reason: adoption.reason });
      yield* Ref.set(adopted, true);
    }
    const status = yield* Effect.result(executions.status());
    if (status._tag === 'Failure') return declined({ _tag: 'HostUnreachable', failure: status.failure });
    const seen = status.success;
    const now = yield* Ref.get(custody);
    if ((!fresh || now !== remembered) && (yield* ours(seen.custody, seen.incarnation))) {
      yield* remember(seen.custody);
      return held(seen.custody);
    }
    const decision = decide(seen.custody, seen.incarnation, now);
    if (decision._tag === 'Decline') return decision.assurance;
    return yield* contend(seen.custody, 2);
  });

  const starting = Effect.fnUntraced(function* (
    operation: HostRequestRef,
    launch: LaunchRequest,
  ): Effect.fn.Return<StartAnswer, ExecutionsFailure> {
    yield* ready;
    const assurance = yield* ensure();
    if (assurance._tag === 'Declined') return refusedStart(operation, assurance.reason, state);
    const answered = yield* executions.start(operation, launch);
    if (answered._tag !== 'Refused' || answered.refusal._tag !== 'Unauthorized') return answered;
    const second = yield* ensure({ fresh: true });
    if (second._tag === 'Declined') return refusedStart(operation, second.reason, state);
    return yield* executions.start(operation, launch);
  });

  const cancelling = Effect.fnUntraced(function* (
    operation: HostRequestRef,
    cause: CancellationCause,
    trigger: string,
    when: 'always' | 'unadmitted',
  ): Effect.fn.Return<CancelAnswer, ExecutionsFailure> {
    yield* ready;
    const assurance = yield* ensure();
    if (assurance._tag === 'Declined') return refusedCancel(operation, assurance.reason, state);
    const answered = yield* executions.cancelStart(operation, cause, trigger, when);
    if (answered._tag !== 'Refused' || answered.refusal._tag !== 'Unauthorized') return answered;
    const second = yield* ensure({ fresh: true });
    if (second._tag === 'Declined') return refusedCancel(operation, second.reason, state);
    return yield* executions.cancelStart(operation, cause, trigger, when);
  });

  const preventing = Effect.fnUntraced(function* (
    operation: HostRequestRef,
    execution: ExecutionRef,
  ): Effect.fn.Return<StopPrevention, ExecutionsFailure> {
    yield* ready;
    const assurance = yield* ensure();
    if (assurance._tag === 'Declined')
      return { _tag: 'Refused', operation, refusal: refusalOf(assurance.reason, detailOf(assurance.reason, state)) };
    const answered = yield* executions.preventStop(operation, execution);
    if (answered._tag !== 'Refused' || answered.refusal._tag !== 'Unauthorized') return answered;
    const second = yield* ensure({ fresh: true });
    if (second._tag === 'Declined')
      return { _tag: 'Refused', operation, refusal: refusalOf(second.reason, detailOf(second.reason, state)) };
    return yield* executions.preventStop(operation, execution);
  });

  return {
    opened: Effect.fnUntraced(function* (session: SessionWelcome, take: SessionTake) {
      const remembered = yield* Ref.get(custody);
      if (remembered === undefined || remembered.holder?.connection === session.connection) return;
      let standing = session.custody;
      for (let takes = 0; takes < 3; takes += 1) {
        if (standing.holder?.connection === session.connection && standing.holder.incarnation === session.incarnation)
          return yield* remember(standing);
        if (decide(standing, session.incarnation, remembered)._tag === 'Decline') return;
        const key: HostRequestRef = { installation, operation: HostRequestKey.make(`host-take-${randomUUID()}`) };
        const answer = yield* Effect.result(take(key, standing.revision));
        if (answer._tag === 'Failure') {
          yield* Effect.logWarning('a new host session could not re-take custody; the next custody act takes it', {
            failure: answer.failure._tag,
          });
          return;
        }
        if (answer.success._tag === 'Held') return yield* remember(answer.success.custody);
        if (answer.success._tag !== 'Stale') {
          yield* Effect.logWarning('a new host session could not re-take custody; the next custody act takes it', {
            answer: answer.success._tag,
          });
          return;
        }
        standing = answer.success.standing;
      }
    }),
    ensure,
    ready: Effect.andThen(ready, Effect.asVoid(ensure())),
    guarded: (): HostPort => ({
      ...served,
      start: starting,
      cancelStart: (operation, cause, trigger, when = 'always') => cancelling(operation, cause, trigger, when),
      preventStop: preventing,
    }),
  };
});

const refusalOf = (reason: CustodyDeferral, detail: string): Refusal =>
  reason._tag === 'HostUnreachable'
    ? { _tag: 'HostUnavailable', reason: detail }
    : reason._tag === 'ActivationDeferred' && reason.reason._tag === 'BundleMismatch'
      ? { _tag: 'HostIncompatible', reason: detail }
      : { _tag: 'Unauthorized', reason: detail };

const refusedStart = (operation: HostRequestRef, reason: CustodyDeferral, state: string): StartAnswer => ({
  _tag: 'Refused',
  operation,
  refusal: refusalOf(reason, detailOf(reason, state)),
});

const refusedCancel = (operation: HostRequestRef, reason: CustodyDeferral, state: string): CancelAnswer => ({
  _tag: 'Refused',
  operation,
  refusal: refusalOf(reason, detailOf(reason, state)),
});
