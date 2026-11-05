import { TerminalInventory } from './inventory.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { RequestKeys } from '../store/requestKeys.js';
import { TerminalIntents } from '../store/intentLifecycle.js';
import { CommandRows } from '../store/commandRows.js';
import { CommandWaiters } from '../contract/service/commands.js';
import { Executions } from '@runlith/executions/Executions';
import { ExecutionEvidence } from '@runlith/executions/ExecutionEvidence';
import type { InstallationId } from '@runlith/executions/protocol/execution';
import { makeTerminalRecord } from './reads.js';
import { Discharge } from '../contract/service/discharge.js';
import { Clock, Deferred, Effect, Exit, type Stream } from 'effect';
import type { CustodyRevision } from '@runlith/executions/protocol/custody';
import type { CancellationCause } from '@runlith/executions/protocol/call';
import { HostRequestKey, type ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InventoryFeedItem } from '@runlith/executions/protocol/inventory';
import type { InventoryMoves } from './inventory.js';
import type { StopAction, StopReceipt } from '@runlith/executions/protocol/stop';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { commandFence, terminalIntent, terminalRequestKey, terminalRequestKeyTally } from '../store/terminal.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import { TerminalRefused, TerminalUnavailable } from '../contract/wire/refusals.js';
import { principalOf } from './principals.js';
import { type TerminalRecord } from '../contract/wire/terminals.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import type { StopPreparation } from '../contract/service/access.js';
import { commandSignalId } from '../contract/wire/commands.js';
import type { CommandSubject } from '../contract/wire/commandSubject.js';
import type { TerminalFailure } from '../contract/service/terminals.js';
import type { CommandAuthority, CommandSweep } from '../contract/service/commands.js';
import { replacedReceipt } from '../host/generationEnded.js';
import { sameRef, retaken, type StopDispatches } from './refs.js';

const stopSettles = writes('stops.stop', [terminalRequestKey, terminalRequestKeyTally, terminalIntent]);

const sentSettles = writes('stops.sent', [terminalRequestKey, terminalRequestKeyTally, terminalIntent]);

export const makeTerminalStops = Effect.fnUntraced(function* ({
  installation,
  dispatches,
}: {
  readonly installation: InstallationId;
  readonly dispatches: StopDispatches;
}) {
  const cell = yield* TerminalInventory;
  const units = yield* MachineUnits;
  const requestKeys = yield* RequestKeys;
  const intents = yield* TerminalIntents;
  const commandRows = yield* CommandRows;
  const waiters = yield* CommandWaiters;
  const host = yield* Executions;
  const executionEvidence = yield* ExecutionEvidence;
  const ref = (operation: HostRequestKey) => ({ installation, operation });
  const readRecord = yield* makeTerminalRecord;
  const dischargeOwner = yield* Discharge;
  const sweeping = new Map<string, Deferred.Deferred<void>>();

  const inTurn =
    (named: string) =>
    <A, E, R>(sweep: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.uninterruptibleMask((restore) => {
        const turn: Effect.Effect<A, E, R> = Effect.suspend(() => {
          const going = sweeping.get(named);
          if (going !== undefined) return Effect.andThen(restore(Deferred.await(going)), turn);
          const done = Deferred.makeUnsafe<void>();
          sweeping.set(named, done);
          return Effect.ensuring(
            restore(sweep),
            Effect.sync(() => {
              sweeping.delete(named);
              Deferred.doneUnsafe(done, Exit.void);
            }),
          );
        });
        return turn;
      });

  const unresolved = (key: TerminalOperationKey) =>
    units.write(stopSettles, (unit) =>
      Effect.gen(function* () {
        const standing = yield* requestKeys.operation(unit, key.projectId, key.operationId);
        if (standing._tag !== 'Pending') return;
        yield* intents.settle(unit, key.projectId, key.operationId, {
          _tag: 'Uncertain',
          effect: { _tag: 'InFlight', operation: ref(key.operationId) },
        });
      }),
    );

  const dispatch = Effect.fnUntraced(function* <A, E, R>(key: TerminalOperationKey, work: Effect.Effect<A, E, R>) {
    return yield* dispatches.hold(
      key,
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          yield* units.write(writes('stops.stop', [terminalRequestKey, terminalRequestKeyTally]), (unit) =>
            Effect.gen(function* () {
              const taken = yield* requestKeys.operation(unit, key.projectId, key.operationId);
              if (taken._tag !== 'Unknown') return yield* retaken(key, taken);
              yield* requestKeys.register(unit, key);
            }),
          );
          return yield* restore(work).pipe(Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : unresolved(key))));
        }),
      ),
    );
  });

  const commandChanges = (): Stream.Stream<InventoryFeedItem> => cell.changes();

  const commandMoves = (): Effect.Effect<InventoryMoves, TerminalUnavailable> => cell.moves();

  const processes = Effect.fn('Terminals.processes')(function* (execution: ExecutionRef) {
    return yield* executionEvidence.processes(execution);
  });

  const ports = Effect.fn('Terminals.ports')(function* (execution: ExecutionRef) {
    return yield* executionEvidence.listeners(execution);
  });

  const signal = Effect.fn('Terminals.signal')(function* (execution: ExecutionRef, signal: string, expected: CustodyRevision) {
    yield* atRevision(execution, expected);
    return yield* host.signal(execution, signal);
  });

  const atRevision = Effect.fn('Terminals.atRevision')(function* (
    execution: ExecutionRef,
    expected: CustodyRevision,
  ): Effect.fn.Return<TerminalRecord, TerminalFailure> {
    const standing = yield* readRecord(execution.execution, execution.incarnation);
    if (standing === null) {
      return yield* new TerminalUnavailable({
        owner: 'store',
        message: `This installation holds no projection of ${execution.execution}; reconcile it before acting on it.`,
      });
    }
    if (standing.quarantine !== undefined) {
      return yield* new TerminalRefused({
        reason: 'stale',
        message: `The projection of ${execution.execution} is quarantined (${standing.quarantine}); its provenance must be resolved before it is acted on.`,
      });
    }
    if (standing.revision !== expected) {
      return yield* new TerminalRefused({
        reason: 'stale',
        message: `Custody moved: this act was decided over revision ${expected} and ${execution.execution} stands at ${standing.revision}.`,
      });
    }
    return standing;
  });

  const stop = Effect.fn('Terminals.stop')(function* (
    projectId: number,
    key: TerminalOperationKey,
    execution: ExecutionRef,
    expected: CustodyRevision,
    cause: CancellationCause,
    action: StopAction,
    trigger?: string,
  ): Effect.fn.Return<StopReceipt, TerminalFailure> {
    const replaced = yield* dischargeOwner.dischargeReplaced(projectId, execution);
    if (replaced._tag === 'Discharged') return replacedReceipt(execution, key, cause, action);
    yield* atRevision(execution, expected);
    return yield* dispatch(
      key,
      Effect.gen(function* () {
        const sent = yield* Effect.result(host.stop(ref(key.operationId), execution, cause, action, trigger));
        if (sent._tag === 'Failure') {
          const unsent = sent.failure._tag === 'WireUnavailable' && sent.failure.sent === false;
          yield* units.write(stopSettles, (unit) =>
            unsent
              ? intents.settle(unit, projectId, key.operationId, { _tag: 'Settled' })
              : intents.settle(unit, projectId, key.operationId, {
                  _tag: 'Uncertain',
                  effect: { _tag: 'InFlight', operation: ref(key.operationId) },
                }),
          );
          return yield* sent.failure;
        }
        yield* units.write(stopSettles, (unit) =>
          intents.settle(unit, projectId, key.operationId, {
            _tag: 'Settled',
            executionId: execution.execution,
            incarnation: execution.incarnation,
            stop: sent.success,
          }),
        );
        yield* dischargeOwner.discharge(projectId, execution, sent.success);
        return sent.success;
      }),
    );
  });

  const stopCommand = Effect.fn('Terminals.stopCommand')(function* (
    projectId: number,
    key: TerminalOperationKey,
    execution: ExecutionRef,
    authority: CommandAuthority<StopPreparation>,
    cause: CancellationCause,
    action: StopAction,
    trigger?: string,
  ): Effect.fn.Return<StopReceipt, TerminalFailure> {
    if (!sameRef(authority.prepared.request.execution, execution)) {
      return yield* new TerminalRefused({
        reason: 'stale-authority',
        message: 'This stop names an execution its prepared act was not bound to; prepare over the execution being stopped.',
      });
    }
    yield* units.read((unit) => authority.recheck(unit));
    const replaced = yield* dischargeOwner.dischargeReplaced(projectId, execution);
    if (replaced._tag === 'Discharged') return replacedReceipt(execution, key, cause, action);
    return yield* dispatch(
      key,
      Effect.gen(function* () {
        const stopper = authority.prepared.request.actor;
        const stopping = stopper._tag === 'Thread' ? stopper.threadId : undefined;
        const record = stopping === undefined ? null : yield* units.read((unit) => commandRows.recordCommand(unit, execution.execution));
        const notice =
          record !== null && record.origin._tag === 'Thread' && record.origin.thread === stopping
            ? { thread: record.origin.thread, signalId: commandSignalId(record.execution, record.origin.toolCall) }
            : undefined;
        const sent = yield* Effect.acquireUseRelease(
          takeNotice(execution, notice?.thread),
          () =>
            Effect.gen(function* () {
              const sent = yield* Effect.result(host.stop(ref(key.operationId), execution, cause, action, trigger));
              if (sent._tag === 'Failure') {
                const unsent = sent.failure._tag === 'WireUnavailable' && sent.failure.sent === false;
                yield* units.write(sentSettles, (unit) =>
                  unsent
                    ? intents.settle(unit, projectId, key.operationId, { _tag: 'Settled' })
                    : intents.settle(unit, projectId, key.operationId, {
                        _tag: 'Uncertain',
                        effect: { _tag: 'InFlight', operation: ref(key.operationId) },
                      }),
                );
                return sent;
              }
              const settled = (unit: WriteUnit<'machine'>) =>
                Effect.asVoid(
                  intents.settle(unit, projectId, key.operationId, {
                    _tag: 'Settled',
                    executionId: execution.execution,
                    incarnation: execution.incarnation,
                    stop: sent.success,
                  }),
                );
              yield* notice === undefined
                ? units.write(sentSettles, settled)
                : waiters.answered(execution, notice.thread, notice.signalId, settled);
              return sent;
            }),
          (taken, exit) => (taken && (Exit.isFailure(exit) || exit.value._tag === 'Failure') ? handNoticeBack(execution) : Effect.void),
        );
        if (sent._tag === 'Failure') return yield* sent.failure;
        yield* dischargeOwner.discharge(projectId, execution, sent.success);
        return sent.success;
      }),
    );
  });

  const takeNotice = Effect.fn('Terminals.takeNotice')(function* (
    execution: ExecutionRef,
    owner: ThreadId | undefined,
  ): Effect.fn.Return<boolean, never> {
    if (owner === undefined) return false;
    const taken = yield* Effect.result(waiters.take(execution, owner));
    if (taken._tag === 'Success') return taken.success;
    yield* Effect.logWarning('an ending its thread is stopping could not be taken from its notice; the notice stays owed', {
      execution: execution.execution,
      reason: taken.failure._tag,
    });
    return false;
  });

  const handNoticeBack = Effect.fn('Terminals.handNoticeBack')(function* (execution: ExecutionRef): Effect.fn.Return<void, never> {
    const released = yield* Effect.result(waiters.unread(execution));
    if (released._tag === 'Failure') {
      yield* Effect.logWarning('an ending whose stop failed could not be handed back to its notice; the next boot sends it', {
        execution: execution.execution,
        reason: released.failure._tag,
      });
    }
  });

  const stopCommands = Effect.fn('Terminals.stopCommands')(
    function* (
      projectId: number,
      owners: readonly CommandSubject[],
      key: TerminalOperationKey,
      authorize: (execution: ExecutionRef) => Effect.Effect<CommandAuthority<StopPreparation>, TerminalFailure>,
      cause: CancellationCause,
      action: StopAction,
      run?: string,
    ): Effect.fn.Return<CommandSweep, TerminalFailure> {
      const swept = yield* units.write(
        writes('stops.swept', [terminalRequestKey, terminalRequestKeyTally, commandFence]),
        (unit: WriteUnit<'machine'>) =>
          Effect.gen(function* () {
            const taken = yield* requestKeys.operation(unit, projectId, key.operationId);
            const repeat = taken._tag !== 'Unknown';
            yield* requestKeys.register(unit, key);
            const fences = repeat
              ? yield* commandRows.ownerFences(unit, projectId, owners)
              : yield* commandRows.fenceOwners(unit, projectId, owners);
            const standing = yield* commandRows.commandsOwnedBy(unit, projectId, owners, run);
            return { fences, standing };
          }),
      );
      const stopped: StopReceipt[] = [];
      const refused: { readonly execution: ExecutionRef; readonly refusal: TerminalRefused }[] = [];
      const endings = yield* Effect.result(
        Effect.gen(function* () {
          for (const record of swept.standing) {
            const execution = record.execution;
            const derived = HostRequestKey.make(`${key.operationId}:${execution.execution}`);
            const decided = yield* units.read((unit) => requestKeys.operation(unit, projectId, derived));
            if (decided._tag !== 'Unknown') continue;
            const ending = yield* Effect.result(
              Effect.gen(function* () {
                const authority = yield* authorize(execution);
                return yield* stopCommand(
                  projectId,
                  {
                    projectId,
                    operationId: derived,
                    requester: principalOf(authority.prepared.request.actor),
                    mutation: 'stop',
                    targetKey: authority.prepared.targetKey,
                    execution,
                  },
                  execution,
                  authority,
                  cause,
                  action,
                );
              }),
            );
            if (ending._tag === 'Success') {
              stopped.push(ending.success);
              continue;
            }
            if (ending.failure._tag !== 'TerminalRefused') return yield* Effect.fail(ending.failure);
            refused.push({ execution, refusal: ending.failure });
          }
        }),
      );
      if (endings._tag === 'Failure') {
        yield* units.write(writes('stops.stopCommands', [terminalRequestKey, terminalRequestKeyTally]), (unit) =>
          intents.settle(unit, projectId, key.operationId, {
            _tag: 'Uncertain',
            effect: { _tag: 'InFlight', operation: ref(key.operationId) },
          }),
        );
        return yield* Effect.fail(endings.failure);
      }
      yield* units.write(writes('stops.stopCommands', [terminalRequestKey, terminalRequestKeyTally, terminalIntent]), (unit) =>
        intents.settle(unit, projectId, key.operationId, { _tag: 'Settled' }),
      );
      const remaining = yield* units.read((unit) =>
        Effect.gen(function* () {
          const standing = yield* commandRows.commandsOwnedBy(unit, projectId, owners, run);
          const unresolved = yield* commandRows.commandIntentsOf(unit, projectId, owners, run);
          return { standing: standing.map((record) => record.execution), unresolved };
        }),
      );
      return { fences: swept.fences, stopped, refused, ...remaining };
    },
    (sweep, projectId, _owners, key) =>
      inTurn(`${projectId}:${key.operationId}`)(
        sweep.pipe(Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : unresolved(key)))),
      ),
  );

  return { processes, ports, signal, stop, stopCommand, stopCommands, commandChanges, commandMoves };
});
