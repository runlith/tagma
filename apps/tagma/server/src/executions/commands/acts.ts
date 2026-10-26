import { MachineUnits } from '../../platform/contract/service/units.js';
import { RequestKeys } from '../store/requestKeys.js';
import { TerminalIntents } from '../store/intentLifecycle.js';
import { CommandRows } from '../store/commandRows.js';
import { CommandDeliveries } from '../store/deliveries.js';
import { CommandWaiters } from '../contract/service/commands.js';
import { Commands } from '@runlith/executions/Commands';
import type { InstallationId } from '@runlith/executions/protocol/execution';
import type { HostRequestKey } from '@runlith/executions/protocol/execution';
import { Terminals } from '../contract/service/terminals.js';
import { ExecutionRecords } from '../contract/service/records.js';
import { Clock, Effect, Schema } from 'effect';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ByteCursor } from '@runlith/executions/protocol/record';
import {
  CommandRevisionRequest,
  type CommandDeadline,
  type CommandRevision,
  type CommandRevisionAnswer,
} from '@runlith/executions/protocol/command';
import { TerminalRefused, TerminalUnavailable } from '../contract/wire/refusals.js';
import { principalOf } from '../terminals/principals.js';
import { type TerminalWaitAnswer } from '../contract/wire/terminals.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import { writes } from '../../platform/contract/service/writes.js';
import { commandDeliveryOwed } from '../contract/wire/commands.js';
import {
  commandDelivery,
  commandWait as commandWaitTable,
  terminalIntent,
  terminalRequestKey,
  terminalRequestKeyTally,
} from '../store/terminal.js';
import type { AwaitPreparation, ObservePreparation, RevisePreparation } from '../contract/service/access.js';
import type { TerminalFailure } from '../contract/service/terminals.js';
import type { CommandAuthority } from '../contract/service/commands.js';
import type { BytesOptions } from '../contract/service/records.js';
import { sameRef, retaken } from '../terminals/refs.js';

const reviseSettles = writes('commandActs.reviseCommand', [terminalRequestKey, terminalRequestKeyTally, terminalIntent]);

export const makeCommandActs = Effect.fnUntraced(function* ({ installation }: { readonly installation: InstallationId }) {
  const units = yield* MachineUnits;
  const requestKeys = yield* RequestKeys;
  const intents = yield* TerminalIntents;
  const commandRows = yield* CommandRows;
  const deliveries = yield* CommandDeliveries;
  const waiters = yield* CommandWaiters;
  const commands = yield* Commands;
  const ref = (operation: HostRequestKey) => ({ installation, operation });
  const terminals = yield* Terminals;
  const records = yield* ExecutionRecords;

  const reviseCommand = Effect.fn('Terminals.reviseCommand')(function* (
    key: TerminalOperationKey,
    execution: ExecutionRef,
    authority: CommandAuthority<RevisePreparation>,
    cause: CommandRevisionRequest['cause'],
    expected: CommandRevision,
  ): Effect.fn.Return<CommandRevisionAnswer, TerminalFailure> {
    if (!sameRef(authority.prepared.request.execution, execution)) {
      return yield* new TerminalRefused({
        reason: 'stale-authority',
        message: 'This revision names an execution its prepared act was not bound to; prepare over the execution being revised.',
      });
    }
    yield* units.read((unit) => authority.recheck(unit));
    const taken = yield* units.read((unit) => requestKeys.operation(unit, key.projectId, key.operationId));
    if (taken._tag !== 'Unknown') return yield* retaken(key, taken);
    yield* units.write(writes('commandActs.reviseCommand', [terminalRequestKey, terminalRequestKeyTally]), (unit) =>
      requestKeys.register(unit, key),
    );
    const actor = principalOf(authority.prepared.request.actor);
    const request = yield* Effect.mapError(
      Schema.decodeUnknownEffect(CommandRevisionRequest)({
        operation: ref(key.operationId),
        execution,
        expected,
        change: authority.prepared.request.change,
        actor,
        cause,
        exception:
          authority.prepared.request.exceptionMs === undefined
            ? undefined
            : { ceilingMs: authority.prepared.request.exceptionMs, actor, cause },
      }),
      () =>
        new TerminalRefused({
          reason: 'ineligible',
          message: 'This revision names a deadline change the host cannot take; prepare over figures the policy bounds.',
        }),
    );
    const sent = yield* Effect.result(commands.revise(request));
    if (sent._tag === 'Failure') {
      const unsent = sent.failure._tag === 'WireUnavailable' && sent.failure.sent === false;
      yield* units.write(reviseSettles, (unit) =>
        unsent
          ? intents.settle(unit, key.projectId, key.operationId, { _tag: 'Settled' })
          : intents.settle(unit, key.projectId, key.operationId, {
              _tag: 'Uncertain',
              effect: { _tag: 'InFlight', operation: ref(key.operationId) },
            }),
      );
      return yield* sent.failure;
    }
    yield* units.write(reviseSettles, (unit) =>
      intents.settle(unit, key.projectId, key.operationId, {
        _tag: 'Settled',
        executionId: execution.execution,
        incarnation: execution.incarnation,
      }),
    );
    return sent.success;
  });

  const commandDeadline = (execution: ExecutionRef): Effect.Effect<CommandDeadline | null, TerminalFailure> =>
    commands.command(execution).pipe(
      Effect.map((snapshot) => snapshot?.deadline ?? null),
      Effect.mapError(
        (failure) =>
          new TerminalUnavailable({ owner: 'host', message: `The life of ${execution.execution} could not be read: ${failure._tag}.` }),
      ),
    );

  const backgroundCommand = Effect.fn('Terminals.backgroundCommand')(function* (
    execution: ExecutionRef,
  ): Effect.fn.Return<'moved' | 'already' | 'ended', TerminalFailure> {
    const stored = yield* units.read((unit) => commandRows.recordCommand(unit, execution.execution));
    const record = stored === null || stored.execution.incarnation !== execution.incarnation ? null : stored;
    const origin = record?.origin;
    const call =
      origin?._tag === 'Thread' && origin.run !== undefined && origin.toolCall !== undefined
        ? { thread: origin.thread, run: origin.run, toolCall: origin.toolCall }
        : null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const standing = yield* units.read((unit) => deliveries.commandWait(unit, execution));
      if (standing === null) return 'ended';
      if (standing.mode === 'background') return 'already';
      const owed = record === null ? null : commandDeliveryOwed(record, 'background', yield* Clock.currentTimeMillis);
      const moved = yield* waiters.background(execution, standing.revision, owed, call);
      if (moved._tag === 'Ended') return 'ended';
      if (moved._tag === 'Moved') {
        const now = yield* Effect.result(commands.command(execution));
        if (now._tag === 'Failure') {
          yield* Effect.logDebug('a command sent to the background is unread on the host; its ending is checked now', {
            execution: execution.execution,
            reason: now.failure._tag,
          });
          yield* waiters.due(execution);
          return 'moved';
        }
        if (now.success === undefined || now.success.state.phase === 'ended') yield* waiters.due(execution);
        return 'moved';
      }
    }
    return yield* new TerminalRefused({
      reason: 'ineligible',
      message: `The wait of ${execution.execution} moved under every attempt to send it to the background; read the command and try again.`,
    });
  });

  const measuredCommand = (execution: ExecutionRef, words: string): Effect.Effect<void, TerminalFailure> =>
    waiters.measured(execution, words);

  const foregroundMoves = writes('commandActs.foregroundCommand', [commandWaitTable, commandDelivery]);

  const foregroundCommand = Effect.fn('Terminals.foregroundCommand')(function* (
    execution: ExecutionRef,
  ): Effect.fn.Return<'withdrawn' | 'delivered', TerminalFailure> {
    return yield* units.write(foregroundMoves, (unit) =>
      Effect.gen(function* () {
        const standing = yield* deliveries.commandWait(unit, execution);
        if (standing !== null && standing.mode === 'background') {
          yield* deliveries.moveCommandWait(unit, execution, standing.revision, 'foreground');
        }
        return (yield* deliveries.acceptDelivery(unit, execution)) ? ('withdrawn' as const) : ('delivered' as const);
      }),
    );
  });

  const commandWait = Effect.fn('Terminals.commandWait')(function* (
    execution: ExecutionRef,
    authority: CommandAuthority<AwaitPreparation>,
    waitMs: number,
  ): Effect.fn.Return<TerminalWaitAnswer, TerminalFailure> {
    if (!sameRef(authority.prepared.request.execution, execution)) {
      return yield* new TerminalRefused({
        reason: 'stale-authority',
        message: 'This wait names an execution its prepared act was not bound to; prepare over the execution being awaited.',
      });
    }
    yield* units.read((unit) => authority.recheck(unit));
    return yield* terminals.wait(execution, waitMs);
  });

  const commandBytes = Effect.fn('Terminals.commandBytes')(function* (
    cursor: ByteCursor,
    limit: number,
    authority: CommandAuthority<ObservePreparation>,
    options?: BytesOptions,
  ) {
    if (!sameRef(authority.prepared.request.execution, cursor.ref)) {
      return yield* new TerminalRefused({
        reason: 'stale-authority',
        message: 'This read names an execution its prepared act was not bound to; prepare over the execution being read.',
      });
    }
    yield* units.read((unit) => authority.recheck(unit));
    return yield* records.bytes(cursor, limit, options);
  });

  return {
    revise: reviseCommand,
    deadline: commandDeadline,
    background: backgroundCommand,
    measured: measuredCommand,
    foreground: foregroundCommand,
    wait: commandWait,
    bytes: commandBytes,
  };
});
