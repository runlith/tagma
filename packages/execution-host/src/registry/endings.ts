import { Effect, Exit, Ref, Scope } from 'effect';
import { CancellationCause } from '@runlith/executions/protocol/call';
import { type Cleanup, ExecutionId, type ExecutionRef, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { type LaunchRequest } from '@runlith/executions/protocol/launch';
import { byteOffset } from '@runlith/executions/protocol/record';
import {
  type EndingReceipt,
  type EndingReading,
  recordedEnding,
  type ResidualResource,
  type SignalAnswer,
  type StopAction,
  type StopReceipt,
  type UnverifiableResource,
} from '@runlith/executions/protocol/stop';
import { relationOf } from '../ExecutionStop';
import { ExecutionUnknown, ExecutionUnreadable, ExecutionUnrecorded } from '../executionFailures';
import { climb, type LadderAim } from '@runlith/executions/stopLadder';
import { killStray } from '../strayProcesses';
import { workAim, type NativeExecution } from '../nativeLaunch';
import { residualStanding, type ProvenSet } from '../ProvenSet';
import { type HostClaim, type RegistryState, live, moved, commanding } from './state';
import { releaseSoon } from './retention';

export const stopOf = (
  registry: RegistryState,
  execution: ExecutionId,
  operation: HostRequestRef,
  cause: CancellationCause,
  action: StopAction = 'signal',
) => {
  return Effect.flatMap(live(registry, execution), (found) =>
    Effect.tap(found.execution.stop.stop(operation, cause, action), (receipt) =>
      Effect.andThen(sweepAfter(registry, execution, receipt), Effect.andThen(moved(registry, found), releaseSoon(registry, found))),
    ),
  );
};

export const endOrphan = Effect.fn('ExecutionStop.endOrphan')(function* (
  registry: RegistryState,
  execution: ExecutionId,
  cause: CancellationCause,
  ask?: { readonly operation: HostRequestRef; readonly action: StopAction },
) {
  const { store, capacity, calls, orphans } = registry;
  const orphan = yield* Ref.modify(orphans, (kept) => {
    const held = kept.get(execution);
    if (held === undefined) return [undefined, kept] as const;
    const next = new Map(kept);
    next.delete(execution);
    return [held, next] as const;
  });
  if (orphan === undefined) return undefined;
  yield* calls
    .settle(orphan.operation, { _tag: 'Cancel', cause, trigger: `orphan:${orphan.ref.execution}` })
    .pipe(Effect.catchTag('CallMissing', () => Effect.void));
  const intent = yield* Effect.result(
    store.recordStop({
      operation: ask?.operation ?? orphan.operation,
      execution: orphan.ref,
      cause,
      coverage: orphan.native.target.relations,
      requested: ask?.action ?? 'destroy',
    }),
  );
  const ending = yield* orphan.native.target.end(ask?.action ?? 'destroy', undefined, 'stopping');
  yield* Scope.close(orphan.scope, Exit.succeed(undefined));
  yield* capacity.release(execution);
  const cleanup: Cleanup =
    ending.residual.length > 0
      ? 'residual'
      : ending.exit === undefined || ending.confirmed.length === 0 || ending.unverifiable.length > 0
        ? 'unverifiable'
        : 'complete';
  const record = yield* Effect.result(store.executionOf(execution));
  const moved =
    record._tag === 'Success'
      ? yield* Effect.result(
          store.recordState(
            {
              ...record.success.state,
              phase: 'ended',
              cleanup,
              nativeExit: ending.exit ?? record.success.state.nativeExit,
            },
            orphan.native.identity,
          ),
        )
      : undefined;
  const relation = relationOf(ending);
  const final = yield* Effect.result(
    store.recordFinal({
      execution: orphan.ref,
      nativeExit: ending.exit,
      sources: {
        stdout: { completed: false, offset: byteOffset(0n) },
        stderr: { completed: false, offset: byteOffset(0n) },
      },
      cleanup,
      retention: 'lost',
      confirmed: ending.confirmed,
      residual: ending.residual,
      unverifiable: ending.unverifiable,
      streams: [],
      relation,
      coverage: [...ending.measured],
      abandonedOutput: ending.abandonedOutput,
    }),
  );
  const unrecorded = [
    ...(intent._tag === 'Failure' ? [`the stop was not recorded: ${intent.failure._tag}`] : []),
    ...(record._tag === 'Failure' ? [`the ending could not be read: ${record.failure._tag}`] : []),
    ...(moved !== undefined && moved._tag === 'Failure' ? [`the ended phase was not recorded: ${moved.failure._tag}`] : []),
    ...(final._tag === 'Failure' ? [`the ending was not recorded: ${final.failure._tag}`] : []),
  ];
  return { orphan, ending, cleanup, relation, unrecorded };
});

export const takeCancellation = (registry: RegistryState, operation: HostRequestRef) => {
  const { cancelling } = registry;
  return Ref.modify(cancelling, (held) => {
    const asked = held.get(operation.operation);
    if (asked === undefined) return [undefined, held] as const;
    const next = new Map(held);
    next.delete(operation.operation);
    return [asked, next] as const;
  });
};

export const deliverCancellation = Effect.fnUntraced(function* (
  registry: RegistryState,
  operation: HostRequestRef,
  ref: ExecutionRef,
  launch: LaunchRequest,
) {
  const { calls } = registry;
  const asked = yield* takeCancellation(registry, operation);
  if (asked === undefined) return;
  yield* calls
    .settle(operation, { _tag: 'Cancel', cause: asked.cause, trigger: asked.trigger })
    .pipe(Effect.catchTag('CallMissing', () => Effect.void));
  yield* stopOf(registry, ref.execution, asked.ask?.operation ?? operation, asked.cause, asked.ask?.action ?? 'signal').pipe(
    Effect.catchTag('ExecutionUnknown', () => Effect.void),
  );
});

export const sweepAfter = Effect.fnUntraced(function* (
  registry: RegistryState,
  execution: ExecutionId,
  receipt: { readonly cleanup: Cleanup; readonly residual?: ReadonlyArray<ResidualResource> },
) {
  const { registryScope } = registry;
  const found = registry.held.get(execution);
  if (found !== undefined && receipt.cleanup === 'residual')
    yield* registry.residuals.capture(found.ref, found.native.proven, receipt.residual ?? [], found.native.held);
  if (receipt.cleanup === 'residual' && (receipt.residual?.length ?? 0) > 0)
    yield* Effect.forkIn(sweepResidual(registry, execution, receipt.residual ?? []), registryScope);
}, Effect.asVoid);

const residualAims = (
  residual: ReadonlyArray<ResidualResource>,
  native: NativeExecution | undefined,
): Effect.Effect<ReadonlyArray<LadderAim>> =>
  Effect.map(
    Effect.forEach(
      residual.flatMap((row) => (row.kind === 'process' && row.pid !== undefined ? [{ id: row.pid, group: row.relation === 'work' }] : [])),
      (target): Effect.Effect<LadderAim | undefined> =>
        target.group
          ? Effect.succeed(native === undefined || native.held.work !== target.id ? undefined : workAim(native.held, native.proven))
          : native?.proven === undefined
            ? Effect.succeed(undefined)
            : native.proven.residualAim(target.id, killStray(native.proven.control)),
    ),
    (aims) => aims.filter((aim): aim is LadderAim => aim !== undefined),
  );

const sweepResidual = Effect.fn('ExecutionStop.sweepResidual')(function* (
  registry: RegistryState,
  execution: ExecutionId,
  residual: ReadonlyArray<ResidualResource>,
) {
  const { held } = registry;
  const aims = yield* residualAims(residual, held.get(execution)?.native);
  if (aims.length === 0) return;
  yield* climb('terminate', aims);
});

export const stopOrphan = Effect.fnUntraced(function* (
  registry: RegistryState,
  operation: HostRequestRef,
  execution: ExecutionId,
  cause: CancellationCause,
  action: StopAction,
) {
  const { orphans } = registry;
  const orphan = (yield* Ref.get(orphans)).get(execution);
  if (orphan === undefined) return undefined;
  const ended = yield* endOrphan(registry, execution, cause, { operation, action });
  if (ended === undefined) return undefined;
  if (ended.unrecorded.length > 0) {
    return yield* new ExecutionUnrecorded({ execution, reason: ended.unrecorded.join('; ') });
  }
  return {
    execution: ended.orphan.ref,
    nativeExit: ended.ending.exit,
    cost: ended.ending.cost,
    coverage: [...ended.ending.measured],
    relation: ended.relation,
    confirmed: ended.ending.confirmed,
    residual: ended.ending.residual,
    unverifiable: ended.ending.unverifiable,
    streams: [],
    cleanup: ended.cleanup,
    retention: 'lost',
    abandonedOutput: ended.ending.abandonedOutput,
    operation,
    requested: action,
    cause,
    steps: ended.ending.steps,
  } satisfies StopReceipt;
});

export const stoppedWithoutChild = Effect.fn('ExecutionStop.withoutChild')(function* (
  registry: RegistryState,
  operation: HostRequestRef,
  execution: ExecutionId,
  cause: CancellationCause,
  action: StopAction,
) {
  const { store, shelf } = registry;
  const filed = shelf.get(execution)?.receipt ?? (yield* filedEnding(registry, execution));
  if (filed === undefined) return undefined;
  const shelved = shelf.has(execution);
  if (!shelved && (filed.nativeExit !== undefined || filed.cleanup !== 'complete')) return undefined;
  const record = yield* Effect.result(store.executionOf(execution));
  if (record._tag === 'Failure' && record.failure._tag !== 'StoredExecutionMissing') {
    return yield* new ExecutionUnreadable({ execution, reason: record.failure._tag });
  }
  const admitted = record._tag === 'Success' ? record.success.command : undefined;
  if (admitted === undefined && !shelved) return undefined;
  const read = yield* Effect.result(store.stopOf(execution));
  if (read._tag === 'Failure' && read.failure._tag !== 'StoredExecutionMissing') {
    return yield* new ExecutionUnreadable({ execution, reason: read.failure._tag });
  }
  const standing = read._tag === 'Success' ? read.success : undefined;
  const written = yield* Effect.result(
    store.recordStop({
      operation,
      execution: filed.execution,
      cause,
      coverage: [],
      requested: action,
      joined: true,
    }),
  );
  if (written._tag === 'Failure') {
    return yield* new ExecutionUnrecorded({ execution, reason: `the stop was not recorded: ${written.failure._tag}` });
  }
  return {
    ...filed,
    operation: standing?.operation ?? operation,
    requested: standing?.requested ?? action,
    cause: standing?.cause ?? cause,
    steps: [],
  } satisfies StopReceipt;
});

export const filedEnding = Effect.fnUntraced(function* (registry: RegistryState, execution: ExecutionId) {
  const { store } = registry;
  const filed = yield* Effect.result(store.finalOf(execution));
  if (filed._tag === 'Failure') {
    if (filed.failure._tag === 'StoredExecutionMissing') return undefined;
    return yield* new ExecutionUnreadable({ execution, reason: filed.failure._tag });
  }
  return filed.success === undefined ? undefined : recordedEnding(filed.success);
});

const remeasured = Effect.fn('ExecutionRegistry.remeasured')(function* (recorded: EndingReceipt, native: NativeExecution | undefined) {
  const residual: ResidualResource[] = [];
  const unverifiable: UnverifiableResource[] = [...recorded.unverifiable];
  for (const resource of recorded.residual) {
    if (resource.pid === undefined) {
      residual.push(resource);
      continue;
    }
    const pid = resource.pid;
    if (resource.relation === 'work') {
      if (native === undefined || native.held.work !== pid)
        unverifiable.push({
          kind: resource.kind,
          detail: resource.detail,
          reason: 'the ending holds no work authority to measure again',
        });
      else if (!(yield* workAim(native.held, native.proven).gone)) residual.push(resource);
      continue;
    }
    const standing = yield* residualStanding(native?.proven, pid);
    if (standing === 'standing') residual.push(resource);
    else if (standing === 'unwitnessed') {
      unverifiable.push({
        kind: resource.kind,
        detail: resource.detail,
        reason: `pid ${pid} still names a process, and no start witness this host holds proves it is the one the ending named`,
      });
    } else if (standing === 'unreadable') {
      unverifiable.push({ kind: resource.kind, detail: resource.detail, reason: `pid ${pid} could not be read at this measurement` });
    }
  }
  return { ...recorded, residual, unverifiable, measurement: 'remeasured' as const };
});

export const signal = (registry: RegistryState, claim: HostClaim, execution: ExecutionId, name: string) => {
  const { orphans } = registry;
  return Effect.flatMap(commanding(registry, claim, 'end'), () =>
    Effect.gen(function* () {
      const held = yield* Effect.result(live(registry, execution));
      if (held._tag === 'Success') {
        const found = held.success;
        if (yield* found.execution.stop.stopping) {
          return {
            _tag: 'SignalUnavailable',
            execution: found.ref,
            signal: name,
            reason: 'stopping',
            detail: 'a stop owns this execution and its decided cause',
          } satisfies SignalAnswer;
        }
        const sent = yield* found.native.target.signal(name);
        return sent.delivered && sent.pid !== undefined
          ? ({ _tag: 'Delivered', execution: found.ref, signal: name, pid: sent.pid } satisfies SignalAnswer)
          : ({
              _tag: 'SignalUnavailable',
              execution: found.ref,
              signal: name,
              reason: sent.reason ?? 'os',
              detail: sent.detail,
            } satisfies SignalAnswer);
      }
      const orphan = (yield* Ref.get(orphans)).get(execution);
      if (orphan === undefined) return yield* new ExecutionUnknown({ execution });
      const sent = yield* orphan.native.target.signal(name);
      return sent.delivered && sent.pid !== undefined
        ? ({ _tag: 'Delivered', execution: orphan.ref, signal: name, pid: sent.pid } satisfies SignalAnswer)
        : ({
            _tag: 'SignalUnavailable',
            execution: orphan.ref,
            signal: name,
            reason: sent.reason ?? 'os',
            detail: sent.detail,
          } satisfies SignalAnswer);
    }),
  );
};

export const ending = Effect.fnUntraced(function* (registry: RegistryState, execution: ExecutionId, remeasure?: boolean) {
  const { held, shelf } = registry;
  const found = held.get(execution);
  const recorded =
    found !== undefined
      ? yield* found.execution.stop.measured
      : (shelf.get(execution)?.receipt ?? (yield* filedEnding(registry, execution)));
  if (recorded === undefined) return undefined;
  return remeasure === true ? yield* remeasured(recorded, found?.native) : { ...recorded, measurement: 'recorded' as const };
});
