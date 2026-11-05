import { Deferred, Effect, Ref } from 'effect';
import { type CallBudget, type CallDecision } from '@runlith/executions/protocol/call';
import {
  type CommandAdmission,
  type CommandDeadline,
  type CommandRevisionAnswer,
  type CommandRevisionRequest,
  type RevisionRefusal,
  originOf,
} from '@runlith/executions/protocol/command';
import { type ExecutionRef, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { type CommandRevisionRecord } from '../db/persisted';
import { revisedTotal, revisionIdentity, type DeadlineState, type Revision } from '../CallLifetimes';
import { ExecutionUnknown, ExecutionUnreadable, ExecutionUnrecorded } from '../executionFailures';
import { type Accepted, type Allowance, type HostClaim, type RegistryState, inventoryMoved, commanding } from './state';

export const commandBudget = (executionMs: number | undefined): CallBudget => (executionMs === undefined ? {} : { timeoutMs: executionMs });

const deadlineOfAllowance = (execution: ExecutionRef, standing: Allowance): CommandDeadline => ({
  execution,
  revision: standing.revision,
  executionMs: standing.executionMs,
  ceilingMs: standing.ceilingMs,
  origin: standing.origin,
  foregroundMs: standing.foregroundMs,
});

export const standingDeadline = Effect.fnUntraced(function* (
  registry: RegistryState,
  ref: ExecutionRef,
  admission: CommandAdmission,
  operation: HostRequestRef | undefined,
) {
  const { store, calls, queued } = registry;
  const waiting = (yield* Ref.get(queued)).get(ref.execution);
  if (waiting !== undefined && (yield* Ref.get(waiting.gate)) === 'queued') {
    return deadlineOfAllowance(ref, yield* Ref.get(waiting.allowance));
  }
  if (operation !== undefined) {
    const open = yield* calls.deadline(operation).pipe(Effect.catchTag('CallMissing', () => Effect.succeed(undefined)));
    if (open !== undefined) return liveDeadline(ref, open);
  }
  const filed = yield* Effect.result(store.appliedRevisionOf(ref.execution));
  if (filed._tag === 'Failure') {
    if (filed.failure._tag === 'StoredExecutionMissing') return admittedDeadline(ref, admission);
    return yield* new ExecutionUnreadable({ execution: ref.execution, reason: filed.failure._tag });
  }
  const row = filed.success;
  return row === undefined ? admittedDeadline(ref, admission) : filedDeadline(row);
});

const reviseStanding = Effect.fnUntraced(function* (registry: RegistryState, request: CommandRevisionRequest) {
  const { calls, held, queued } = registry;
  const execution = request.execution.execution;
  const waiting = (yield* Ref.get(queued)).get(execution);
  if (waiting !== undefined) {
    const answered = yield* reviseQueued(registry, waiting, request);
    if (answered !== undefined) return answered;
    const moved = yield* calls.revise(waiting.operation, request).pipe(Effect.catchTag('CallMissing', () => Effect.succeed(undefined)));
    if (moved !== undefined) return yield* revisionOutcome(registry, request, waiting.ref, moved);
  }
  const found = held.get(execution);
  if (found !== undefined) {
    const moved = yield* calls.revise(found.operation, request).pipe(Effect.catchTag('CallMissing', () => Effect.succeed(undefined)));
    if (moved !== undefined) return yield* revisionOutcome(registry, request, found.ref, moved);
  }
  return yield* endedRevision(registry, request, undefined);
});

const reviseQueued = (
  registry: RegistryState,
  waiting: Accepted,
  request: CommandRevisionRequest,
): Effect.Effect<CommandRevisionAnswer | undefined, ExecutionUnknown | ExecutionUnreadable | ExecutionUnrecorded> => {
  const { store } = registry;
  return waiting.revising.withPermits(1)(
    Effect.gen(function* () {
      if ((yield* Ref.get(waiting.gate)) !== 'queued') return undefined;
      if (yield* Deferred.isDone(waiting.ended)) return undefined;
      const standing = yield* Ref.get(waiting.allowance);
      if (standing.revision !== request.expected) {
        return {
          _tag: 'Stale',
          operation: request.operation,
          deadline: deadlineOfAllowance(waiting.ref, standing),
        } satisfies CommandRevisionAnswer;
      }
      const ceilingMs = request.exception?.ceilingMs ?? standing.ceilingMs;
      const asked = revisedTotal(request.change, {
        ceilingMs,
        elapsedMs: undefined,
        foregroundMs: request.wait === 'background' ? undefined : standing.foregroundMs,
      });
      if (asked._tag === 'Refused') return refusedRevision(request, asked.reason, asked.detail);
      const revision = standing.revision + 1;
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const written = yield* Effect.result(
            store.recordRevision({
              execution: waiting.ref,
              operation: request.operation,
              fingerprint: revisionIdentity(request),
              revision,
              executionMs: asked.executionMs,
              ceilingMs: ceilingMs,
              actor: request.actor,
              cause: request.cause,
              exception: request.exception === undefined ? undefined : { actor: request.exception.actor, cause: request.exception.cause },
            }),
          );
          if (written._tag === 'Failure') {
            if (written.failure._tag === 'OperationConflict') {
              return refusedRevision(request, 'conflict', 'this key is taken by a different act');
            }
            return yield* new ExecutionUnrecorded({
              execution: waiting.ref.execution,
              reason: `the revision was not recorded: ${written.failure._tag}`,
            });
          }
          if (written.success._tag === 'Taken') return yield* keyedRevision(registry, request, written.success.standing);
          const lost = (yield* Ref.get(waiting.gate)) !== 'queued' || (yield* Deferred.isDone(waiting.ended));
          const resolved = yield* Effect.result(store.resolveRevision(request.operation, lost ? 'ended' : 'applied'));
          if (resolved._tag === 'Failure') {
            return yield* new ExecutionUnrecorded({
              execution: waiting.ref.execution,
              reason: `what the revision did was not recorded: ${resolved.failure._tag}`,
            });
          }
          if (resolved.success.outcome !== 'applied') return undefined;
          const released = request.wait === 'background';
          const revised: Allowance = {
            executionMs: asked.executionMs,
            ceilingMs,
            origin: released ? standing.origin : 'caller',
            foregroundMs: released ? undefined : standing.foregroundMs,
            revision,
          };
          yield* Ref.set(waiting.allowance, revised);
          return {
            _tag: 'Revised',
            operation: request.operation,
            deadline: deadlineOfAllowance(waiting.ref, revised),
          } satisfies CommandRevisionAnswer;
        }),
      );
    }),
  );
};

const revisionOutcome = (
  registry: RegistryState,
  request: CommandRevisionRequest,
  ref: ExecutionRef,
  revision: Revision,
): Effect.Effect<CommandRevisionAnswer, ExecutionUnknown | ExecutionUnreadable | ExecutionUnrecorded> => {
  if (revision._tag === 'Refused') return Effect.succeed(refusedRevision(request, revision.reason, revision.detail));
  if (revision._tag === 'Standing') return keyedRevision(registry, request, revision.standing);
  if (revision._tag === 'Unrecorded') {
    return Effect.fail(new ExecutionUnrecorded({ execution: ref.execution, reason: `the revision was not recorded: ${revision.reason}` }));
  }
  if (revision._tag === 'Decided') return endedRevision(registry, request, revision.decision);
  return Effect.succeed({
    _tag: revision._tag,
    operation: request.operation,
    deadline: liveDeadline(ref, revision.deadline),
  } satisfies CommandRevisionAnswer);
};

const liveDeadline = (ref: ExecutionRef, live: DeadlineState): CommandDeadline => ({
  execution: ref,
  revision: live.revision,
  executionMs: live.executionMs,
  ceilingMs: live.ceilingMs,
  origin: live.origin,
  foregroundMs: live.foregroundMs,
  armed: live.armed ? ('native-acquired' as const) : undefined,
  elapsedMs: live.elapsedMs,
  expiresAt: live.wallExpiresAt,
});

const filedDeadline = (row: CommandRevisionRecord): CommandDeadline => ({
  execution: row.execution,
  revision: row.revision,
  executionMs: row.executionMs,
  ceilingMs: row.ceilingMs,
  origin: 'caller',
});

const endedRevision = Effect.fnUntraced(function* (
  registry: RegistryState,
  request: CommandRevisionRequest,
  decided: CallDecision | undefined,
) {
  const { store, calls, held } = registry;
  const execution = request.execution.execution;
  const found = held.get(execution);
  if (found !== undefined) {
    const state = yield* Ref.get(found.state);
    const decision =
      decided ?? (yield* calls.decision(found.operation).pipe(Effect.catchTag('CallMissing', () => Effect.succeed(undefined))));
    if (state.phase !== 'ended' && decision === undefined) {
      return yield* new ExecutionUnreadable({
        execution,
        reason: `this command stands at ${state.phase} and this host holds no deadline for it`,
      });
    }
    return {
      _tag: 'Ended',
      operation: request.operation,
      state,
      decision: decision,
    } satisfies CommandRevisionAnswer;
  }
  const read = yield* Effect.result(store.executionOf(execution));
  if (read._tag === 'Failure') {
    if (read.failure._tag === 'StoredExecutionMissing') return yield* new ExecutionUnknown({ execution });
    return yield* new ExecutionUnreadable({ execution, reason: read.failure._tag });
  }
  const record = read.success;
  if (record.command === undefined) {
    return refusedRevision(request, 'not-a-command', 'this execution was admitted with no bounded intent');
  }
  if (record.state.phase !== 'ended') {
    return yield* new ExecutionUnreadable({
      execution,
      reason: `this command stands at ${record.state.phase} and no owner on this host holds its deadline`,
    });
  }
  return {
    _tag: 'Ended',
    operation: request.operation,
    state: record.state,
    decision: decided,
  } satisfies CommandRevisionAnswer;
});

const refusedRevision = (request: CommandRevisionRequest, reason: RevisionRefusal, detail: string): CommandRevisionAnswer => ({
  _tag: 'Refused',
  operation: request.operation,
  reason,
  detail,
});

const keyedRevision = Effect.fnUntraced(function* (
  registry: RegistryState,
  request: CommandRevisionRequest,
  standing: CommandRevisionRecord,
) {
  if (standing.fingerprint !== revisionIdentity(request)) {
    return refusedRevision(request, 'conflict', 'this key has already accepted a different change');
  }
  if (standing.outcome === 'ended') return yield* endedRevision(registry, request, undefined);
  if (standing.outcome === 'pending') {
    return yield* new ExecutionUnreadable({
      execution: request.execution.execution,
      reason: `the acceptance under key ${request.operation.operation} never recorded what it did`,
    });
  }
  return {
    _tag: 'Revised',
    operation: request.operation,
    deadline: filedDeadline(standing),
  } satisfies CommandRevisionAnswer;
});

const admittedDeadline = (ref: ExecutionRef, admission: CommandAdmission): CommandDeadline => ({
  execution: ref,
  revision: 0,
  executionMs: admission.limits.executionMs,
  ceilingMs: admission.limits.executionCeilingMs,
  origin: originOf(admission.limits),
  foregroundMs: admission.limits.foregroundMs,
});

export const reviseCommand = (registry: RegistryState, claim: HostClaim, request: CommandRevisionRequest) => {
  const { store, entered } = registry;
  return Effect.flatMap(commanding(registry, claim, 'end'), () =>
    Effect.gen(function* () {
      const execution = request.execution.execution;
      const filed = yield* Effect.result(store.revisionAt(request.operation));
      if (filed._tag === 'Failure') {
        return yield* new ExecutionUnreadable({ execution, reason: filed.failure._tag });
      }
      if (filed.success !== undefined) return yield* keyedRevision(registry, request, filed.success);
      if (request.execution.installation !== entered.installation || request.execution.incarnation !== entered.incarnation) {
        return refusedRevision(request, 'identity', `this host is ${entered.installation} at generation ${entered.incarnation}`);
      }
      const answered = yield* reviseStanding(registry, request);
      if (answered._tag === 'Revised') yield* inventoryMoved(registry, execution);
      if (answered._tag === 'Stale') {
        const again = yield* Effect.result(store.revisionAt(request.operation));
        if (again._tag === 'Failure') {
          yield* Effect.logWarning(
            `the key of ${request.operation.operation} could not be read again; the revision stays stale`,
            again.failure,
          );
        } else if (again.success !== undefined) {
          return yield* keyedRevision(registry, request, again.success);
        }
      }
      return answered;
    }),
  );
};
