import { Effect } from 'effect';
import type { Refusal } from '@runlith/executions/protocol/host';
import type { Request } from '@runlith/executions/protocol/wire';
import type { Bindings } from './Bindings';
import type { Custodian } from './Custodian';
import type { ExecutionCapacity } from './ExecutionCapacity';
import type { InputLanes } from './registry/control';
import type { ExecutionRetirement } from './registry/retention';
import type { HostAdmission } from './HostAdmission';
import type { Admitted } from './HostConnections';
import { noteRefusal } from './hostTelemetry';
import { refusalOf } from './refusals';

export const authority = (
  lanes: InputLanes['Service'],
  retirement: ExecutionRetirement['Service'],
  bindings: Bindings['Service'],
  custodian: Custodian['Service'],
  capacity: ExecutionCapacity['Service'],
  admission: HostAdmission['Service'],
  admitted: Admitted,
  body: Extract<Request, { readonly _tag: 'Authority' }>,
  span: <A, E, R>(
    verb: string,
    execution: string | undefined,
    operation: string | undefined,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>,
): Effect.Effect<void> => {
  const act = body.act;
  if (admitted.role === 'recovery' && act._tag !== 'FenceHost') {
    const refusal: Refusal = { _tag: 'Unauthorized', reason: `recovery may not ${act._tag}` };
    return Effect.andThen(noteRefusal(refusal), admitted.refuse(refusal));
  }
  const custodianRefused = (refusal: Refusal) =>
    Effect.andThen(noteRefusal(refusal), admitted.reply({ _tag: 'Authority', outcome: { _tag: 'Refused', refusal } }));
  switch (act._tag) {
    case 'TakeHost':
      return span(
        'Authority.TakeHost',
        undefined,
        act.operation.operation,
        custodian.take(act.operation, act.expected, admitted.connection, admitted.role).pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              failure._tag === 'CustodyConflict'
                ? admitted.reply({
                    _tag: 'Authority',
                    outcome: { _tag: 'Stale', expected: act.expected, standing: failure.standing },
                  })
                : custodianRefused(refusalOf(failure)),
            onSuccess: (acceptance) => admitted.reply({ _tag: 'Authority', outcome: { _tag: 'Held', custody: acceptance.standing } }),
          }),
        ),
      );

    case 'FenceHost':
      return span(
        'Authority.FenceHost',
        undefined,
        act.operation.operation,
        custodian.fence(act.operation, act.expected, admitted.connection, admitted.role).pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              failure._tag === 'CustodyConflict'
                ? admitted.reply({
                    _tag: 'Authority',
                    outcome: { _tag: 'Stale', expected: act.expected, standing: failure.standing },
                  })
                : custodianRefused(refusalOf(failure)),
            onSuccess: (acceptance) => admitted.reply({ _tag: 'Authority', outcome: { _tag: 'Held', custody: acceptance.standing } }),
          }),
        ),
      );

    case 'Grant':
      return span(
        'Authority.Grant',
        undefined,
        act.operation.operation,
        custodian.check(admitted.epoch, admitted.connection).pipe(
          Effect.matchEffect({
            onFailure: (failure) => custodianRefused(refusalOf(failure)),
            onSuccess: Effect.fnUntraced(function* () {
              const standing = yield* capacity.regrant(act.share);
              yield* retirement.reclaim();
              const ledger = yield* capacity.ledger();
              return yield* admitted.reply({
                _tag: 'Authority',
                outcome: {
                  _tag: 'Granted',
                  granted: ledger.granted,
                  reserved: standing.reserved,
                  retained: standing.retained,
                  over: standing.over,
                },
              });
            }),
          }),
        ),
      );

    case 'ReleaseHost':
      return span(
        'Authority.ReleaseHost',
        undefined,
        act.operation.operation,
        custodian.release(act.operation, admitted.connection, act.custody).pipe(
          Effect.matchEffect({
            onFailure: (failure) => custodianRefused(refusalOf(failure)),
            onSuccess: (acceptance) => admitted.reply({ _tag: 'Authority', outcome: { _tag: 'Held', custody: acceptance.standing } }),
          }),
        ),
      );

    case 'OpenBinding':
      return span(
        'Authority.OpenBinding',
        undefined,
        undefined,
        bindings.open(act.principal, admitted.connection, admitted.epoch).pipe(
          Effect.matchEffect({
            onFailure: (failure) => custodianRefused(refusalOf(failure)),
            onSuccess: (binding) =>
              admitted.reply({
                _tag: 'Authority',
                outcome: {
                  _tag: 'Bound',
                  binding: binding.id,
                  principal: binding.principal,
                  epoch: binding.epoch,
                },
              }),
          }),
        ),
      );

    case 'CloseBinding':
      return span(
        'Authority.CloseBinding',
        undefined,
        undefined,
        bindings
          .authorize({
            binding: act.binding,
            principal: act.principal,
            connection: admitted.connection,
            epoch: admitted.epoch,
          })
          .pipe(
            Effect.asVoid,
            Effect.catchTags({ BindingMissing: () => Effect.void, BindingRefused: () => Effect.void }),
            Effect.matchEffect({
              onFailure: (failure) => custodianRefused(refusalOf(failure)),
              onSuccess: () =>
                Effect.andThen(
                  lanes.close(act.binding, act.principal),
                  admitted.reply({ _tag: 'Authority', outcome: { _tag: 'Unbound', binding: act.binding } }),
                ),
            }),
          ),
      );
  }
};
