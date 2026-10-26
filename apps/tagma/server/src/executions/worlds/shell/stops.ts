import { Deferred, Effect, Fiber } from 'effect';
import { CommandUnreadable, type CommandRequest, type CommandRevision } from '@runlith/agent-tools/CommandWork';
import type { CallCancellation, CallStopping, DeclaredCancellationCause } from '@runlith/executions/protocol/call';
import type { CommandRevisionAnswer, DeadlineChange } from '@runlith/executions/protocol/command';
import type { StopReceipt } from '@runlith/executions/protocol/stop';
import { HostRequestKey, type ExecutionRef, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { principalOf } from '../../terminals/principals.js';
import { type TerminalActor } from '../../contract/wire/terminals.js';
import type { TerminalOperationKey } from '../../contract/wire/requestKeys.js';
import type { RevisePreparation, StopPreparation } from '../../contract/service/access.js';
import type { CommandAuthority } from '../../contract/service/commands.js';
import type { WorldLease } from '../../contract/service/worlds.js';
import { refusalText, runDeadlineOf } from './results.js';
import type { ShellRoad } from './start.js';

export type Stopped =
  | { readonly receipt: StopReceipt }
  | { readonly receipt?: undefined; readonly attached: true; readonly unestablished?: undefined }
  | { readonly receipt?: undefined; readonly attached?: undefined; readonly unestablished: string };

export type Cancellation = {
  readonly cell: Deferred.Deferred<Stopped>;
  readonly stop: CallStopping;
  readonly settle: Effect.Effect<void>;
};

const stopKeyOf = (operation: HostRequestRef): HostRequestKey => HostRequestKey.make(`${operation.operation}:stop`);

export const declaredStop = (stop: CallStopping): DeclaredCancellationCause => stop.stopped()?.reason ?? 'run-abort';

const declaredTrigger = (said: CallCancellation): string =>
  said.message.trim() !== '' ? said.message : 'the call this command belonged to was stopped';

const revisionOf = (outcome: CommandRevisionAnswer): CommandRevision => {
  if (outcome._tag === 'Revised') return { state: 'revised', deadline: runDeadlineOf(outcome.deadline) };
  if (outcome._tag === 'Stale') return { state: 'stale', deadline: runDeadlineOf(outcome.deadline) };
  if (outcome._tag === 'Ended') return { state: 'ended' };
  return { state: 'refused', reason: outcome.detail === '' ? outcome.reason : outcome.detail };
};

const unreadableRevision = (failure: { readonly _tag: string }): CommandUnreadable =>
  new CommandUnreadable({ reason: refusalText(failure) });

const refusedRevision = (failure: { readonly _tag: string }): CommandRevision => ({
  state: 'refused',
  reason: refusalText(failure),
});

export const cancelling = Effect.fnUntraced(function* (
  road: ShellRoad,
  request: CommandRequest,
  operation: HostRequestRef,
  lease: WorldLease,
): Effect.fn.Return<Cancellation | undefined> {
  const stop = request.stop;
  if (stop === undefined) return undefined;
  const cell = yield* Deferred.make<Stopped>();
  const watch = yield* Effect.forkIn(
    Effect.gen(function* () {
      const said = yield* stop.stopping;
      if (request.waitMs === 0 && said.reason === 'run-abort') {
        return {
          unestablished: 'the run that started this command went away, and a command nobody waits for is not ended by that',
        } satisfies Stopped;
      }
      return yield* endingFor(road, operation, said);
    }).pipe(
      Effect.onExit((exit) =>
        exit._tag === 'Success'
          ? Deferred.succeed(cell, exit.value)
          : Deferred.succeed(cell, {
              unestablished: 'the world holding this command closed before its ending could be established',
            }),
      ),
    ),
    lease.scope,
  );
  const settle = Effect.suspend(() =>
    stop.stopped() !== null
      ? Effect.void
      : Deferred.succeed(cell, { unestablished: 'the command ended before its call was stopped' }).pipe(
          Effect.andThen(Fiber.interrupt(watch)),
        ),
  );
  return { cell, stop, settle };
});

const endingFor = Effect.fnUntraced(function* (
  road: ShellRoad,
  operation: HostRequestRef,
  said: CallCancellation,
): Effect.fn.Return<Stopped> {
  const cause = said.reason;
  const prevented = yield* Effect.result(road.executions.cancelStart(operation, cause, declaredTrigger(said), 'always'));
  if (prevented._tag === 'Success') {
    const outcome = prevented.success;
    if (outcome._tag === 'Joined') return yield* stopping(road, operation, outcome.execution, cause);
    if (outcome._tag === 'Attached') return { attached: true };
    if (outcome._tag === 'Prevented') return { unestablished: 'the send was cancelled before any child existed, so nothing ran' };
    if (outcome._tag === 'Refused') return { unestablished: `the cancellation of this command was refused: ${outcome.refusal.reason}` };
    return { unestablished: `whether this command was cancelled could not be established: ${outcome.effect._tag}` };
  }
  const named = yield* Effect.result(road.executions.operation(operation));
  if (named._tag === 'Failure') {
    return { unestablished: `the key this command was submitted under could not be read back: ${named.failure._tag}` };
  }
  const execution = named.success._tag === 'Accepted' ? named.success.execution : undefined;
  if (execution === undefined) {
    return {
      unestablished: `nothing stood under operation ${operation.operation} (${named.success._tag}) and the cancellation did not reach the host`,
    };
  }
  return yield* stopping(road, operation, execution, cause);
});

export const stopping = Effect.fnUntraced(function* (
  road: ShellRoad,
  operation: HostRequestRef,
  execution: ExecutionRef,
  cause: DeclaredCancellationCause,
): Effect.fn.Return<Stopped> {
  const actor = road.binding.actor;
  const prepared = yield* Effect.result(road.access.prepare({ _tag: 'Stop', actor, scope: road.binding.projectId, execution }));
  if (prepared._tag === 'Failure') return { unestablished: `this command was not ended: ${refusalText(prepared.failure)}` };
  if (prepared.success.request._tag !== 'Stop') return { unestablished: 'the policy prepared no stop for this command' };
  const act: StopPreparation = { ...prepared.success, request: prepared.success.request };
  const key: TerminalOperationKey = {
    projectId: road.binding.projectId,
    operationId: stopKeyOf(operation),
    requester: principalOf(actor),
    mutation: 'stop',
    targetKey: act.targetKey,
    execution,
  };
  const authority: CommandAuthority<StopPreparation> = {
    prepared: act,
    recheck: (unit) => road.access.recheck(unit, act),
  };
  const ended = yield* Effect.result(road.managed.stop(road.binding.projectId, key, execution, authority, cause, 'signal'));
  return ended._tag === 'Success'
    ? { receipt: ended.success }
    : { unestablished: `this command was not ended: ${refusalText(ended.failure)}` };
});

export const revising = Effect.fnUntraced(function* (
  road: ShellRoad,
  execution: ExecutionRef,
  request: { readonly remainingMs: number; readonly authority: 'operator' | 'agent' },
): Effect.fn.Return<CommandRevision, CommandUnreadable> {
  const actor: TerminalActor = request.authority === 'operator' ? { _tag: 'Operator' } : road.binding.actor;
  const standing = yield* Effect.result(road.executions.command(execution));
  if (standing._tag === 'Failure') {
    return yield* new CommandUnreadable({
      reason: `this command's deadline could not be read: ${refusalText(standing.failure)}`,
    });
  }
  if (standing.success === undefined) {
    return yield* new CommandUnreadable({ reason: 'the host holds no bounded command under this reference' });
  }
  const deadline = standing.success.deadline;
  let change: DeadlineChange;
  if (deadline.armed !== undefined && request.authority === 'operator') {
    change = { _tag: 'Remaining', remainingMs: request.remainingMs };
  } else if (deadline.elapsedMs !== undefined) {
    change = { _tag: 'Total', executionMs: deadline.elapsedMs + request.remainingMs };
  } else if (deadline.armed !== undefined) {
    return yield* new CommandUnreadable({
      reason: 'The host did not measure elapsed time for this armed command; its wall stamp cannot authorize a deadline change.',
    });
  } else {
    change = { _tag: 'Total', executionMs: request.remainingMs };
  }
  return yield* sending(
    road,
    execution,
    actor,
    change,
    deadline.revision,
    'the caller moved its own time allowance',
    HostRequestKey.make(`${execution.execution}:limit:${crypto.randomUUID()}`),
  );
});

const sending = Effect.fnUntraced(function* (
  road: ShellRoad,
  execution: ExecutionRef,
  actor: TerminalActor,
  change: DeadlineChange,
  expected: number,
  cause: string,
  operationId: HostRequestKey,
): Effect.fn.Return<CommandRevision, CommandUnreadable> {
  const prepared = yield* Effect.result(
    road.access.prepare({
      _tag: 'Revise',
      actor,
      scope: road.binding.projectId,
      execution,
      change,
    }),
  );
  if (prepared._tag === 'Failure') {
    return prepared.failure._tag === 'TerminalRefused' ? refusedRevision(prepared.failure) : yield* unreadableRevision(prepared.failure);
  }
  if (prepared.success.request._tag !== 'Revise' || prepared.success.revision === undefined) {
    return yield* new CommandUnreadable({ reason: 'the policy prepared no deadline change for this command' });
  }
  const act: RevisePreparation = { ...prepared.success, request: prepared.success.request, revision: prepared.success.revision };
  const key: TerminalOperationKey = {
    projectId: road.binding.projectId,
    operationId,
    requester: principalOf(actor),
    mutation: 'limit',
    targetKey: act.targetKey,
    execution,
  };
  const authority: CommandAuthority<RevisePreparation> = {
    prepared: act,
    recheck: (unit) => road.access.recheck(unit, act),
  };
  const decided = yield* Effect.result(road.managed.revise(key, execution, authority, cause, expected));
  if (decided._tag === 'Failure') {
    return decided.failure._tag === 'TerminalRefused' ? refusedRevision(decided.failure) : yield* unreadableRevision(decided.failure);
  }
  return revisionOf(decided.success);
});
