import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { Effect, Stream } from 'effect';
import type { Rpc } from 'effect/rpc';
import { refusing } from '../../platform/contract/service/body.js';
import { GateRefusal, type RefusalBody } from '../../platform/contract/wire/refusal.js';
import { actorOf } from '../terminals/principals.js';
import type { CommandBytesSubscription } from '../contract/wire/viewLeases.js';
import type { RecordDelivery, RecordParsed } from '../contract/wire/viewLeases.js';
import { gatedRecords } from '../terminals/viewLeases.js';
import { terminalRefusal } from '../terminals/refusal.js';
import type { ExecutionRecords } from '../contract/service/records.js';
import type { TerminalFailure } from '../contract/service/terminals.js';
import type { CommandAccess } from '../contract/service/access.js';
import type { CommandReader } from '../contract/service/commands.js';
import type { ViewLeases } from '../contract/service/views.js';

export const commandBytesChannel = (owners: {
  readonly reader: CommandReader['Service'];
  readonly access: CommandAccess['Service'];
  readonly records: ExecutionRecords['Service'];
  readonly viewers: ViewLeases['Service'];
}) => {
  const placed = (projectId: number, params: CommandBytesSubscription) =>
    Effect.mapError(owners.reader.one(projectId, params.execution, params.incarnation), (failure: TerminalFailure) =>
      terminalRefusal(failure),
    );

  const observing = Effect.fnUntraced(function* (projectId: number, execution: ExecutionRef) {
    const actor = yield* Effect.mapError(actorOf({ kind: 'operator' }, projectId), terminalRefusal);
    const prepared = yield* Effect.mapError(
      owners.access.prepare({ _tag: 'Observe', actor, scope: projectId, execution }),
      (failure: TerminalFailure) => terminalRefusal(failure),
    );
    if (prepared.request._tag !== 'Observe') {
      return yield* new GateRefusal('terminal-stale-authority', 'this reception was prepared as another act', [
        'read the command again and follow its record',
      ]);
    }
    return prepared.request.execution;
  });

  const seat = (connection: number, execution: ExecutionRef, stream: CommandBytesSubscription['stream']) =>
    Effect.acquireRelease(
      Effect.withSpan('ViewLeaseBook.open', { attributes: { stream } })(
        Effect.mapError(owners.viewers.open(connection, execution, stream), (failure) => terminalRefusal(failure)),
      ),
      (held) => owners.viewers.close(held),
    );

  return {
    'command.bytes.subscribe': (
      params: CommandBytesSubscription,
      call: { readonly client: Rpc.ServerClient },
    ): Stream.Stream<RecordDelivery, RefusalBody> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const reading = yield* placed(params.projectId, params);
          const execution = yield* observing(params.projectId, reading.command.execution);
          const viewer = yield* seat(call.client.id, execution, params.stream);
          return gatedRecords(
            owners.viewers,
            viewer,
            owners.records
              .records({ ref: execution, stream: params.stream, offset: params.offset })
              .pipe(Stream.mapError((failure: TerminalFailure) => terminalRefusal(failure))),
          ).pipe(Stream.map((chunk) => ({ viewer, chunk })));
        }),
      ).pipe(
        Stream.catchIf(
          (failure): failure is GateRefusal => failure instanceof GateRefusal,
          (gate) => Stream.fromEffect(refusing(Effect.fail(gate))),
        ),
      ),

    'command.bytes.parsed': (
      params: RecordParsed,
      call: { readonly client: Rpc.ServerClient },
    ): Effect.Effect<{ readonly acknowledged: true }, RefusalBody> =>
      refusing(
        owners.viewers
          .acknowledged(call.client.id, params.viewer, params.offset)
          .pipe(Effect.mapError(terminalRefusal), Effect.as({ acknowledged: true as const })),
      ),
  };
};
