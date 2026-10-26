import { Deferred, Effect, Ref } from 'effect';
import { CancellationCause } from '@runlith/executions/protocol/call';
import { ExecutionId, type ExecutionRef, type ExecutionState, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { type CancelAnswer } from '@runlith/executions/protocol/launch';
import { byteOffset } from '@runlith/executions/protocol/record';
import { type StopAction, type StopReceipt } from '@runlith/executions/protocol/stop';
import { childlessEnding } from '../ExecutionStop';
import { ExecutionUnreadable, ExecutionUnrecorded } from '../executionFailures';
import {
  type CommandLaunch,
  type AcceptedGate,
  type AcceptedAsk,
  type Accepted,
  type HostClaim,
  type RegistryState,
  inventoryMoved,
  commanding,
} from './state';
import { commandBudget } from './revisions';
import { endOrphan, takeCancellation, sweepAfter, stoppedWithoutChild } from './endings';

type GivenUp = { readonly unrecorded: ReadonlyArray<string> } | undefined;

export const endAccepted = Effect.fnUntraced(function* (
  registry: RegistryState,
  entry: Accepted,
  cause: CancellationCause,
  trigger: string,
  ask?: AcceptedAsk,
): Effect.fn.Return<GivenUp> {
  const won = yield* Ref.modify(entry.gate, (standing): readonly [boolean, AcceptedGate] =>
    standing === 'queued' ? [true, 'ended'] : [false, standing],
  );
  if (!won) return undefined;
  yield* Deferred.succeed(entry.ended, { cause, trigger });
  yield* registry.inventoryWoken;
  const unrecorded = yield* endQueued(registry, entry.operation, entry.launch, entry.ref, cause, trigger, ask);
  yield* leaveQueue(registry, entry);
  return { unrecorded };
}, Effect.uninterruptible);

export const endQueued = Effect.fn('Executions.endQueued')(function* (
  registry: RegistryState,
  operation: HostRequestRef,
  launch: CommandLaunch,
  ref: ExecutionRef,
  cause: CancellationCause,
  trigger: string,
  ask: AcceptedAsk | undefined,
) {
  const { store, calls } = registry;
  const settled = yield* Effect.result(store.endRevisionsOf(ref.execution));
  yield* Effect.scoped(
    Effect.andThen(
      calls.open(operation, ref, commandBudget(launch.admission.limits.executionMs)),
      calls.settle(operation, { _tag: 'Cancel', cause, trigger }).pipe(Effect.catchTag('CallMissing', () => Effect.void)),
    ),
  );
  const written = yield* Effect.result(
    store.recordStop({
      operation: ask?.operation ?? operation,
      execution: ref,
      cause,
      coverage: [],
      requested: ask === undefined ? undefined : ask.action,
      joined: false,
    }),
  );
  const refused = written._tag === 'Failure' ? [`the stop was not recorded: ${written.failure._tag}`] : [];
  const unsettled = settled._tag === 'Failure' ? [`the revisions this ending took were not recorded: ${settled.failure._tag}`] : [];
  return [...unsettled, ...refused, ...(yield* endedWithoutChild(registry, launch, ref, `${cause}: ${trigger}`))];
});

const endedWithoutChild = Effect.fn('Executions.endedWithoutChild')(function* (
  registry: RegistryState,
  launch: CommandLaunch,
  ref: ExecutionRef,
  unacquired: string | undefined,
) {
  const { store, capacity } = registry;
  const ended: ExecutionState = {
    ref,
    transport: launch.transport._tag,
    lifetime: 'command',
    purpose: launch.purpose,
    phase: 'ended',
    streams: { stdout: 'eof', stderr: 'eof', pty: 'eof' },
    cleanup: 'complete',
    record: 'unavailable',
    unacquired: unacquired,
  };
  const moved = yield* Effect.result(store.recordState(ended, {}));
  const facts = yield* Effect.result(
    store.recordFinal({
      execution: ref,
      sources: {
        stdout: { completed: true, offset: byteOffset(0n) },
        stderr: { completed: true, offset: byteOffset(0n) },
      },
      cleanup: 'complete',
      retention: 'retained',
      ...childlessEnding,
      streams: [],
      abandonedOutput: false,
      unacquired: unacquired,
    }),
  );
  yield* capacity.release(ref.execution);
  yield* inventoryMoved(registry);
  return [
    ...(moved._tag === 'Failure' ? [`the ended phase was not recorded: ${moved.failure._tag}`] : []),
    ...(facts._tag === 'Failure' ? [`the ending was not recorded: ${facts.failure._tag}`] : []),
  ];
});

export const endUnacquired = (registry: RegistryState, entry: Accepted, reason: string): Effect.Effect<void> => {
  return Effect.uninterruptible(Effect.andThen(endedWithoutChild(registry, entry.launch, entry.ref, reason), leaveQueue(registry, entry)));
};

export const stopQueued = Effect.fnUntraced(function* (
  registry: RegistryState,
  operation: HostRequestRef,
  execution: ExecutionId,
  cause: CancellationCause,
  action: StopAction,
) {
  const { held, queued, cancelling } = registry;
  const waiting = (yield* Ref.get(queued)).get(execution);
  const trigger = `stop:${operation.operation}`;
  const given = waiting === undefined ? undefined : yield* endAccepted(registry, waiting, cause, trigger, { operation, action });
  if (waiting !== undefined && given === undefined) {
    yield* Ref.update(cancelling, (kept) => new Map(kept).set(waiting.operation.operation, { cause, trigger, ask: { operation, action } }));
    if (held.has(execution)) {
      yield* takeCancellation(registry, waiting.operation);
      return undefined;
    }
    return {
      execution: waiting.ref,
      cost: { _tag: 'Unmeasured', reason: 'unknown', detail: 'the attempt that spawns this command has not been reaped' },
      coverage: [],
      relation: 'unknown',
      confirmed: [],
      residual: [],
      unverifiable: [],
      streams: [],
      cleanup: 'pending',
      retention: 'retained',
      abandonedOutput: false,
      operation,
      requested: action,
      cause,
      steps: [],
    } satisfies StopReceipt;
  }
  if (waiting !== undefined && given !== undefined) {
    if (given.unrecorded.length > 0) {
      return yield* new ExecutionUnrecorded({ execution, reason: given.unrecorded.join('; ') });
    }
    return {
      execution: waiting.ref,
      cost: { _tag: 'Unmeasured', reason: 'unknown', detail: 'no child was ever acquired for this command' },
      ...childlessEnding,
      streams: [],
      cleanup: 'complete',
      retention: 'retained',
      abandonedOutput: false,
      operation,
      requested: action,
      cause,
      steps: [],
    } satisfies StopReceipt;
  }
  return yield* stoppedWithoutChild(registry, operation, execution, cause, action);
});

export const leaveQueue = (registry: RegistryState, entry: Accepted): Effect.Effect<void> => {
  const { queued } = registry;
  return Effect.andThen(
    Ref.set(entry.gate, 'ended'),
    Effect.andThen(
      Ref.update(queued, (kept) => {
        const next = new Map(kept);
        next.delete(entry.ref.execution);
        return next;
      }),
      inventoryMoved(registry),
    ),
  );
};

export const cancelStart = Effect.fn('Executions.cancelStart')(function* (
  registry: RegistryState,
  claim: HostClaim,
  operation: HostRequestRef,
  cause: CancellationCause,
  trigger: string,
  when: 'always' | 'unadmitted' = 'always',
) {
  const { store, calls, held, orphans, queued, cancelling, entered } = registry;
  const allowed = yield* Effect.result(commanding(registry, claim, 'end'));
  if (allowed._tag === 'Failure') {
    return {
      _tag: 'Refused',
      operation,
      refusal: { _tag: 'Unauthorized', reason: `the presented custody is not the one that stands: ${allowed.failure._tag}` },
    } satisfies CancelAnswer;
  }
  const taken = yield* Effect.result(store.operationOf(operation));
  if (taken._tag === 'Failure') {
    return {
      _tag: 'Refused',
      operation,
      refusal: { _tag: 'HostUnavailable', reason: String(taken.failure._tag) },
    } satisfies CancelAnswer;
  }
  const entry = taken.success;
  if (when === 'unadmitted' && entry !== undefined && entry.kind !== 'tombstone') {
    return {
      _tag: 'Refused',
      operation,
      refusal: {
        _tag: 'OperationConflict',
        reason: 'This key has already been admitted; conditional prevention leaves its work untouched.',
      },
    } satisfies CancelAnswer;
  }
  if (entry !== undefined && entry.execution !== undefined) {
    const found = held.get(entry.execution);
    if (found !== undefined) {
      yield* calls.settle(found.operation, { _tag: 'Cancel', cause, trigger }).pipe(Effect.catchTag('CallMissing', () => Effect.void));
      const receipt = yield* found.execution.stop.stop(operation, cause, 'signal');
      yield* sweepAfter(registry, found.ref.execution, receipt);
      return { _tag: 'Joined', operation, execution: found.ref } satisfies CancelAnswer;
    }
    const ref: ExecutionRef = {
      installation: entered.installation,
      execution: entry.execution,
      incarnation: entered.incarnation,
    };
    const waiting = (yield* Ref.get(queued)).get(entry.execution);
    if (waiting !== undefined) {
      const given = yield* endAccepted(registry, waiting, cause, trigger, { operation, action: 'signal' });
      if (given !== undefined) return { _tag: 'Joined', operation, execution: waiting.ref } satisfies CancelAnswer;
    }
    yield* Ref.update(cancelling, (kept) => new Map(kept).set(operation.operation, { cause, trigger }));
    const live = held.get(entry.execution);
    if (live !== undefined) {
      const asked = yield* takeCancellation(registry, operation);
      if (asked !== undefined) {
        yield* calls.settle(live.operation, { _tag: 'Cancel', cause, trigger }).pipe(Effect.catchTag('CallMissing', () => Effect.void));
        yield* sweepAfter(registry, live.ref.execution, yield* live.execution.stop.stop(operation, cause, 'signal'));
      }
      return { _tag: 'Joined', operation, execution: live.ref } satisfies CancelAnswer;
    }
    const stranded = (yield* Ref.get(orphans)).get(entry.execution);
    if (stranded !== undefined) {
      const asked = yield* takeCancellation(registry, operation);
      if (asked !== undefined) yield* endOrphan(registry, entry.execution, cause);
    }
    return { _tag: 'Joined', operation, execution: ref } satisfies CancelAnswer;
  }
  if (entry !== undefined && entry.kind === 'tombstone') return { _tag: 'Prevented', operation } satisfies CancelAnswer;
  const written = yield* Effect.result(
    store.settle({
      operation,
      kind: 'tombstone',
      fingerprint: when === 'unadmitted' ? 'prevent-start' : `cancel:${cause}:${trigger}`,
      receipt: { _tag: 'Accepted' },
    }),
  );
  if (written._tag === 'Success') return { _tag: 'Prevented', operation } satisfies CancelAnswer;
  return written.failure._tag === 'OperationConflict'
    ? ({
        _tag: 'Refused',
        operation,
        refusal: { _tag: 'OperationConflict', reason: 'the key is taken by a different request' },
      } satisfies CancelAnswer)
    : ({ _tag: 'Uncertain', effect: { _tag: 'InFlight', operation } } satisfies CancelAnswer);
});
