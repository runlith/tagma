import { Deferred, Effect, Exit, Fiber, Ref, Schema, Scope, Semaphore, Context } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { originOf } from '@runlith/executions/protocol/command';
import { type Refusal } from '@runlith/executions/protocol/host';
import { ExecutionId, type ExecutionRef, type ExecutionState, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { type LaunchRequest, type StartAnswer, type CancelAnswer } from '@runlith/executions/protocol/launch';
import { StoreLost } from '../store/errors';
import type { OperationEntry } from '../store/records';
import { RecordWriteFailed } from '../RecordWriter';
import { nativeFailureReason, NativeSpawnUncertain, SpawnCapacityExceeded, type NativeExecution } from '../nativeLaunch';
import {
  type CommandLaunch,
  type Live,
  type AcceptedEnding,
  type AcceptedGate,
  type Accepted,
  type Allowance,
  type RegistryState,
  inventoryMoved,
  type HostClaim,
  commanding,
  live,
} from './state';
import { releaseSoon } from './retention';
import { stopOf, endOrphan, takeCancellation, deliverCancellation } from './endings';
import { endQueued, endUnacquired, leaveQueue, cancelStart } from './commands';
import { LaunchAbandoned, assemble } from './assembly';
import { type Relief, kernelCount, relieve, countDetail } from './relief';
import { fingerprintOf } from './fingerprint';
import { CancellationCause } from '@runlith/executions/protocol/call';
import { type ExecutionPage, type ExecutionSummary } from '@runlith/executions/protocol/runtime';
import { ExecutionUnknown } from '../executionFailures';
import { type InventoryChanges, type InventoryRevision } from '@runlith/executions/protocol/inventory';
import { changes, list, summary } from './inventory';

const executionId = Schema.decodeUnknownEffect(ExecutionId);

export const refused = (operation: HostRequestRef, tag: Refusal['_tag'], reason: string): StartAnswer => ({
  _tag: 'Refused',
  operation,
  refusal: { _tag: tag, reason } as Refusal,
});

const start = Effect.fnUntraced(function* (registry: RegistryState, operation: HostRequestRef, launch: LaunchRequest) {
  const { admission, quiescence } = registry;
  const open = yield* Effect.result(admission.admitStart());
  if (open._tag === 'Failure') return refused(operation, 'AdmissionClosed', `the host admits no durable work: ${open.failure.phase}`);
  const fenced = yield* Ref.get(quiescence);
  if (fenced !== undefined) return refused(operation, 'AdmissionClosed', 'a controlled restart holds a quiescence ticket');
  const loss = yield* Ref.get(registry.lost);
  if (loss !== undefined) {
    return refused(
      operation,
      'HolderLost',
      `the holder of this host was lost (${loss.detail}); the executions it already runs are served to their end, and none starts before the host is raised again`,
    );
  }
  return launch.lifetime === 'command'
    ? yield* Effect.uninterruptible(admitted(registry, operation, launch))
    : yield* admitted(registry, operation, launch);
}, Effect.scoped);

const admitted = Effect.fn('Executions.admitted')(function* (registry: RegistryState, operation: HostRequestRef, launch: LaunchRequest) {
  const { store, capacity, entered, limits } = registry;
  const fingerprint = fingerprintOf(launch);
  const taken = yield* Effect.result(store.operationOf(operation));
  if (taken._tag === 'Failure') return refused(operation, 'HostUnavailable', String(taken.failure._tag));
  if (taken.success !== undefined) return yield* answeredStart(registry, operation, taken.success, fingerprint);

  const execution = yield* executionId(crypto.randomUUID()).pipe(Effect.orDie);
  const ref: ExecutionRef = { installation: entered.installation, execution, incarnation: entered.incarnation };
  const transport = launch.transport._tag;

  if (launch.transport._tag === 'pty') {
    const wanted = launch.transport.geometry;
    if (wanted.rows > limits.geometry.rows || wanted.columns > limits.geometry.columns) {
      return refused(
        operation,
        'CapacityExceeded',
        `a ${wanted.columns}x${wanted.rows} terminal exceeds the reserved ${limits.geometry.columns}x${limits.geometry.rows}`,
      );
    }
  }
  let slot = yield* Effect.result(capacity.reserve(execution, transport));
  let relieved: Relief | undefined = undefined;
  if (slot._tag === 'Failure' && slot.failure._tag === 'CapacityRefused' && kernelCount(slot.failure.budget)) {
    relieved = yield* relieve(registry);
    slot = yield* Effect.result(capacity.reserve(execution, transport));
  }
  if (slot._tag === 'Failure') {
    const failure = slot.failure;
    if (failure._tag === 'MemoryUnavailable') {
      return refused(
        operation,
        'MemoryExhausted',
        `a reserve of ${failure.reserve} bytes does not fit: ${failure.reserved} reserved and ${failure.retained} retained under a grant of ${failure.grant}`,
      );
    }
    return refused(
      operation,
      failure._tag === 'TransportRefused'
        ? 'UnsupportedCapability'
        : failure._tag === 'ReservationConflict'
          ? 'OperationConflict'
          : 'CapacityExceeded',
      failure._tag !== 'CapacityRefused'
        ? `the ${transport} transport: ${failure._tag}`
        : relieved === undefined
          ? `${failure.budget} at ${failure.limit}`
          : countDetail(failure, relieved),
    );
  }

  const identity = {
    operation,
    fingerprint,
    ref,
    transport,
    purpose: launch.purpose,
    target: launch.target,
    holder: launch.holder,
    origin: launch.origin,
    receipt: { _tag: 'Accepted', execution: ref } as const,
  };
  const reserved = yield* Effect.result(
    store.reserve(
      launch.lifetime === 'command'
        ? { ...identity, lifetime: 'command', command: launch.admission }
        : { ...identity, lifetime: launch.lifetime },
    ),
  );
  if (reserved._tag === 'Failure') {
    yield* capacity.release(execution);
    return reserved.failure._tag === 'OperationConflict'
      ? refused(operation, 'OperationConflict', 'the key is taken by a different request')
      : refused(operation, 'HostUnavailable', String(reserved.failure._tag));
  }
  if (reserved.success._tag === 'Taken') {
    yield* capacity.release(execution);
    const entry = reserved.success.entry;
    return yield* answeredStart(registry, operation, entry, fingerprint);
  }

  return launch.lifetime === 'command'
    ? yield* acceptCommand(registry, operation, launch, ref)
    : yield* spawn(registry, operation, launch, ref);
});

const acceptCommand = Effect.fnUntraced(function* (
  registry: RegistryState,
  operation: HostRequestRef,
  launch: CommandLaunch,
  ref: ExecutionRef,
) {
  const { admission, registryScope, queued } = registry;
  const state: ExecutionState = {
    ref,
    transport: launch.transport._tag,
    lifetime: 'command',
    purpose: launch.purpose,
    phase: 'queued',
    streams: { stdout: 'open', stderr: 'open', pty: 'open' },
    cleanup: 'pending',
    record: 'available',
  };
  const holding = yield* Scope.make();
  const open = yield* Effect.result(Scope.provide(admission.admitAttempt(), holding));
  if (open._tag === 'Failure') {
    yield* Scope.close(holding, Exit.succeed(undefined));
    yield* endQueued(registry, operation, launch, ref, 'not-started', `admission:${open.failure.phase}`, undefined);
    return refused(operation, 'AdmissionClosed', `the host admits no durable work: ${open.failure.phase}`);
  }
  const entry: Accepted = {
    ref,
    operation,
    launch,
    gate: yield* Ref.make<AcceptedGate>('queued'),
    ended: Deferred.makeUnsafe<AcceptedEnding>(),
    allowance: yield* Ref.make<Allowance>({
      executionMs: launch.admission.limits.executionMs,
      ceilingMs: launch.admission.limits.executionCeilingMs,
      origin: originOf(launch.admission.limits),
      foregroundMs: launch.admission.limits.foregroundMs,
      revision: 0,
    }),
    revising: yield* Semaphore.make(1),
  };
  yield* Ref.update(queued, (kept) => new Map(kept).set(ref.execution, entry));
  yield* inventoryMoved(registry);
  yield* Effect.forkIn(acquire(registry, entry).pipe(Effect.ensuring(Scope.close(holding, Exit.succeed(undefined)))), registryScope);
  return { _tag: 'Accepted', operation, execution: ref, state } satisfies StartAnswer;
});

const acquire = (registry: RegistryState, entry: Accepted) => {
  return Effect.asVoid(spawn(registry, entry.operation, entry.launch, entry.ref, entry));
};

const answeredStart = Effect.fnUntraced(function* (
  registry: RegistryState,
  operation: HostRequestRef,
  standing: OperationEntry,
  offered: string,
) {
  const { store, held, entered } = registry;
  if (standing.kind === 'tombstone') return { _tag: 'Cancelled', operation } satisfies StartAnswer;
  if (standing.fingerprint !== offered) return refused(operation, 'OperationConflict', 'the key is taken by a different request');
  if (standing.receipt._tag === 'Refused') return { _tag: 'Refused', operation, refusal: standing.receipt.refusal } satisfies StartAnswer;
  if (standing.receipt._tag === 'Uncertain') return { _tag: 'Uncertain', effect: standing.receipt.effect } satisfies StartAnswer;
  const execution = standing.execution;
  if (execution === undefined) return refused(operation, 'OperationConflict', 'the key names no execution');
  const found = held.get(execution);
  const stored = yield* Effect.result(store.executionOf(execution));
  if (stored._tag === 'Success' && stored.success.state.lifetime === 'command') {
    const state = found === undefined ? stored.success.state : yield* Ref.get(found.state);
    return { _tag: 'Accepted', operation, execution: state.ref, state } satisfies StartAnswer;
  }
  if (found === undefined) {
    const ref =
      stored._tag === 'Success'
        ? stored.success.state.ref
        : { installation: entered.installation, execution, incarnation: entered.incarnation };
    return {
      _tag: 'Uncertain',
      effect: {
        _tag: 'StartUncertain',
        operation,
        execution: ref,
      },
    } satisfies StartAnswer;
  }
  const state = yield* Ref.get(found.state);
  const native = yield* Ref.get(found.process);
  return { _tag: 'Started', operation, execution: found.ref, state, native } satisfies StartAnswer;
});

const spawn = Effect.fn('Executions.spawn')(function* (
  registry: RegistryState,
  operation: HostRequestRef,
  launch: LaunchRequest,
  ref: ExecutionRef,
  accepted?: Accepted,
) {
  const { store, capacity, spawner, calls, held, orphans, queued } = registry;
  const scope = yield* Scope.make();
  const closing = yield* Effect.cached(Effect.forkIn(Scope.close(scope, Exit.void), registry.registryScope));
  const close = Effect.flatMap(Effect.uninterruptible(closing), Fiber.join);
  const spawned = yield* Ref.make<NativeExecution | undefined>(undefined);
  const built = yield* Effect.result(
    Scope.provide(assemble(registry, operation, launch, ref, spawned, accepted), scope).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    ),
  );
  if (built._tag === 'Failure') {
    if (built.failure instanceof LaunchAbandoned) {
      yield* Scope.close(scope, Exit.succeed(undefined));
      return { _tag: 'Cancelled', operation } satisfies StartAnswer;
    }
    if (built.failure instanceof NativeSpawnUncertain) {
      yield* Scope.close(scope, Exit.succeed(undefined));
      if (accepted !== undefined) yield* leaveQueue(registry, accepted);
      const effect = {
        _tag: 'NativeFailed' as const,
        operation,
        execution: ref,
        phase: 'starting' as const,
        cleanup: 'unknown' as const,
        reason: nativeFailureReason(built.failure),
      };
      const recorded = yield* Effect.result(store.uncertainStart(operation, ref, effect));
      return recorded._tag === 'Success'
        ? ({ _tag: 'Uncertain', effect } satisfies StartAnswer)
        : ({
            _tag: 'Uncertain',
            effect: {
              _tag: 'StoreFailed',
              operation,
              execution: ref,
              phase: 'starting',
              cleanup: 'unknown',
              reason: `the unresolved launch could not be recorded: ${recorded.failure._tag}`,
            },
          } satisfies StartAnswer);
    }
    const child = yield* Ref.get(spawned);
    if (child === undefined) {
      yield* Scope.close(scope, Exit.succeed(undefined));
      const failed = {
        _tag: 'NativeFailed' as const,
        operation,
        execution: ref,
        phase: 'starting' as const,
        cleanup: 'none' as const,
        reason: nativeFailureReason(built.failure),
      };
      if (accepted !== undefined) {
        yield* endUnacquired(registry, accepted, failed.reason);
        return { _tag: 'Uncertain', effect: failed } satisfies StartAnswer;
      }
      yield* capacity.release(ref.execution);
      const exhausted =
        built.failure instanceof SpawnCapacityExceeded || (built.failure instanceof RecordWriteFailed && built.failure.exhausted === true);
      if (exhausted) yield* relieve(registry);
      const refusal: Refusal = {
        _tag: exhausted ? 'CapacityExceeded' : 'SpawnFailed',
        reason: failed.reason,
      };
      const recorded = yield* Effect.result(store.refuseStart(operation, ref, refusal));
      if (recorded._tag === 'Failure') {
        return {
          _tag: 'Uncertain',
          effect: {
            _tag: 'StoreFailed',
            operation,
            execution: ref,
            phase: 'starting',
            cleanup: 'none',
            reason: `the refused launch could not be recorded: ${recorded.failure._tag}`,
          },
        } satisfies StartAnswer;
      }
      return { _tag: 'Refused', operation, refusal } satisfies StartAnswer;
    }
    if (accepted !== undefined) yield* leaveQueue(registry, accepted);
    yield* Ref.update(orphans, (kept) =>
      new Map(kept).set(ref.execution, {
        ref,
        scope,
        native: child,
        operation,
        reason: nativeFailureReason(built.failure),
      }),
    );
    const asked = yield* takeCancellation(registry, operation);
    if (asked !== undefined) {
      yield* endOrphan(registry, ref.execution, asked.cause, asked.trigger, asked.ask);
    }
    yield* Effect.ignore(
      store.settle({
        operation,
        kind: 'receipt',
        fingerprint: fingerprintOf(launch),
        execution: ref.execution,
        receipt: { _tag: 'Uncertain', effect: { _tag: 'StartUncertain', operation, execution: ref } },
      }),
    );
    return {
      _tag: 'Uncertain',
      effect: { _tag: 'StartUncertain', operation, execution: ref },
    } satisfies StartAnswer;
  }
  const entry: Live = { ...built.success, scope, close };
  held.hold(ref.execution, entry);
  if (accepted !== undefined) {
    yield* Ref.update(queued, (kept) => {
      const next = new Map(kept);
      next.delete(ref.execution);
      return next;
    });
  }
  const assembled = { entry };

  const state = yield* Ref.updateAndGet(assembled.entry.state, (held): ExecutionState =>
    held.phase === 'starting'
      ? {
          ...held,
          transport: launch.transport._tag,
          lifetime: launch.lifetime,
          purpose: launch.purpose,
          phase: 'running',
        }
      : held,
  );
  yield* Ref.set(assembled.entry.process, assembled.entry.native.identity);

  const persisted = yield* Effect.result(store.recordState(state, assembled.entry.native.identity));
  yield* inventoryMoved(registry, ref.execution);
  if (persisted._tag === 'Failure') {
    yield* assembled.entry.execution.input.fence('stopping', 'the Started receipt was not persisted');
    const effect =
      persisted.failure instanceof StoreLost
        ? {
            _tag: 'StoreFailed' as const,
            operation,
            execution: ref,
            phase: state.phase,
            cleanup: persisted.failure.cleanup,
            reason: persisted.failure.reason,
          }
        : { _tag: 'StartUncertain' as const, operation, execution: ref };
    yield* Effect.ignore(
      store.settle({
        operation,
        kind: 'receipt',
        fingerprint: fingerprintOf(launch),
        execution: ref.execution,
        receipt: { _tag: 'Uncertain', effect },
      }),
    );
    yield* deliverCancellation(registry, operation, ref, launch);
    return { _tag: 'Uncertain', effect } satisfies StartAnswer;
  }

  yield* deliverCancellation(registry, operation, ref, launch);

  const decided = yield* Effect.result(calls.decision(operation));
  if (decided._tag === 'Success' && decided.success?._tag === 'Cancelled') {
    yield* stopOf(registry, ref.execution, operation, decided.success.cause).pipe(Effect.catchTag('ExecutionUnknown', () => Effect.void));
  }
  yield* releaseSoon(registry, assembled.entry);

  const standing = yield* calls.deadline(operation).pipe(Effect.catchTag('CallMissing', () => Effect.succeed(undefined)));
  const timeoutMs = standing?.executionMs;
  return {
    _tag: 'Started',
    operation,
    execution: ref,
    state,
    native: assembled.entry.native.identity,
    deadline:
      standing?.armed === true && timeoutMs !== undefined ? { execution: ref, timeoutMs, start: 'native-acquired' as const } : undefined,
  } satisfies StartAnswer;
});

export class Executions extends Context.Service<
  Executions,
  {
    readonly start: (claim: HostClaim, operation: HostRequestRef, launch: LaunchRequest) => Effect.Effect<StartAnswer>;
    readonly cancelStart: (
      claim: HostClaim,
      operation: HostRequestRef,
      cause: CancellationCause,
      trigger: string,
      when?: 'always' | 'unadmitted',
    ) => Effect.Effect<CancelAnswer>;
    readonly summary: (execution: ExecutionId) => Effect.Effect<ExecutionSummary | undefined>;
    readonly settingUp: (execution: ExecutionId) => Effect.Effect<boolean>;
    readonly changed: (execution: ExecutionId) => Effect.Effect<Effect.Effect<void>, ExecutionUnknown>;
    readonly list: (after: ExecutionId | undefined, limit: number) => Effect.Effect<ExecutionPage>;
    readonly changes: (since: InventoryRevision, limit: number) => Effect.Effect<InventoryChanges>;
    readonly inventoryRevision: () => Effect.Effect<InventoryRevision>;
    readonly inventoryChanged: () => Effect.Effect<Effect.Effect<void>>;
  }
>()('@runlith/execution-host/Executions') {}

export const executionsOf = (registry: RegistryState) =>
  Executions.of({
    start: (claim, operation, launch) =>
      Effect.flatMap(Effect.result(commanding(registry, claim, 'start')), (allowed) =>
        allowed._tag === 'Failure'
          ? Effect.succeed(refused(operation, 'Unauthorized', `the presented custody is not the one that stands: ${allowed.failure._tag}`))
          : start(registry, operation, launch),
      ),
    cancelStart: (claim, operation, cause, trigger, when) => cancelStart(registry, claim, operation, cause, trigger, when),
    summary: (execution) => summary(registry, execution),
    settingUp: (execution) => Effect.map(Ref.get(registry.queued), (queued) => queued.has(execution)),
    changed: (execution) => Effect.flatMap(live(registry, execution), (found) => Effect.map(Ref.get(found.changed), Deferred.await)),
    list: (after, limit) => list(registry, after, limit),
    changes: (since, limit) => changes(registry, since, limit),
    inventoryRevision: () => Effect.sync(() => registry.held.revision),
    inventoryChanged: () => Effect.map(Ref.get(registry.inventoryWake), Deferred.await),
  });
