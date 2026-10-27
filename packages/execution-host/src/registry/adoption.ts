import { Cause, Data, Effect, Exit, Fiber, FileSystem, Option, Path, Ref, Schema, Scope } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { ExecutionId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import type { HostRequestRef } from '@runlith/executions/protocol/execution';
import { type AdoptionRefusal, type UnadoptedExecution } from '@runlith/executions/protocol/runtime';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { recordedEnding } from '@runlith/executions/protocol/stop';
import { makeSegmentRecord } from '../ExecutionRecord';
import { restoreScreen } from '../screenRestore';
import type { HeldExecution } from '../holder/Holder';
import type { NativeExecution } from '../nativeLaunch';
import type { ExecutionRecord } from '../store/records';
import type { Departure } from '../store/departure';
import { assemble, baseColors, type Adopted } from './assembly';
import { inventoryMoved, type Live, type RegistryState } from './state';
import { releaseSoon } from './retention';
import { stopOf } from './endings';
import type { StopIntent } from '../db/persisted';

export class AdoptionRefused extends Data.TaggedError('AdoptionRefused')<{
  readonly reason: AdoptionRefusal;
  readonly detail: string;
  readonly ref?: ExecutionRef;
}> {}

const refusing =
  (reason: AdoptionRefusal, ref?: ExecutionRef) =>
  (failure: { readonly _tag: string }): AdoptionRefused =>
    new AdoptionRefused({ reason, detail: failure._tag, ref });

const decodeId = Schema.decodeUnknownEffect(ExecutionId);

const ADOPTED_COMMAND = { program: 'adopted', args: [], environment: [] } as const;

const launchOf = (
  registry: RegistryState,
  stored: ExecutionRecord,
  held: HeldExecution,
  custody: { readonly holder: LaunchRequest['holder']; readonly origin: LaunchRequest['origin'] },
  call: Adopted['call'],
  paced: boolean,
): LaunchRequest | undefined => {
  const { limits } = registry;
  const state = stored.state;
  const base = {
    command: ADOPTED_COMMAND,
    transport:
      held.channels._tag === 'pty'
        ? ({ _tag: 'pty', geometry: { rows: limits.geometry.rows, columns: limits.geometry.columns } } as const)
        : ({ _tag: 'pipes', stdin: held.channels.stdin === undefined ? 'ignore' : 'pipe' } as const),
    purpose: state.purpose,
    target: stored.target,
    holder: custody.holder,
    origin: custody.origin,
    paced: paced ? (true as const) : undefined,
  };
  if (state.lifetime === 'command') {
    return stored.command === undefined ? undefined : { ...base, lifetime: 'command', admission: stored.command };
  }
  return { ...base, lifetime: state.lifetime, budget: call?.budget };
};

const continueEnding = Effect.fnUntraced(
  function* (registry: RegistryState, entry: Live, operation: HostRequestRef, intents: ReadonlyArray<StopIntent>) {
    if ((yield* Ref.get(entry.state)).phase === 'ended') return;
    const execution = entry.ref.execution;
    const asked = intents[0];
    if (asked !== undefined) {
      yield* stopOf(registry, execution, asked.operation, asked.cause, asked.requested);
      return;
    }
    const decided = yield* registry.calls.decision(operation);
    if (decided?._tag === 'Cancelled') yield* stopOf(registry, execution, operation, decided.cause);
  },
  Effect.result,
  Effect.flatMap((outcome) =>
    outcome._tag === 'Success'
      ? Effect.void
      : Effect.logWarning(`the ending this execution was already under could not be continued: ${outcome.failure._tag}`),
  ),
);

const one = Effect.fn('ExecutionRegistry.adopt')(
  function* (registry: RegistryState, held: HeldExecution) {
    const { store, spawner, held: standing, fs, path, records, limits, registryScope, capacity } = registry;
    const id = yield* decodeId(held.id).pipe(Effect.mapError(refusing('no-record')));
    const stored = yield* store
      .executionOf(id)
      .pipe(Effect.mapError((failure) => refusing(failure._tag === 'StoredExecutionMissing' ? 'no-record' : 'store-unreadable')(failure)));
    const ref = stored.state.ref;
    const operation: HostRequestRef | undefined = yield* store.startOf(id).pipe(Effect.mapError(refusing('store-unreadable', ref)));
    if (operation === undefined) {
      return yield* new AdoptionRefused({ reason: 'no-start', detail: 'no start operation stands in the store for it', ref });
    }
    const custody = yield* store.custodyOf(id).pipe(Effect.mapError(refusing('store-unreadable', ref)));
    const call = yield* store.callOf(operation).pipe(Effect.mapError(refusing('store-unreadable', ref)));
    const rules = yield* store.rulesOf(id).pipe(Effect.mapError(refusing('store-unreadable', ref)));
    const pace = yield* store.paceOf(id).pipe(Effect.mapError(refusing('store-unreadable', ref)));
    const intents = yield* store.stopRequestsOf(id).pipe(Effect.mapError(refusing('store-unreadable', ref)));
    const final = yield* store.finalOf(id).pipe(Effect.mapError(refusing('store-unreadable', ref)));
    const ending =
      stored.state.phase === 'ended' && final?.cleanup === 'complete'
        ? { ...recordedEnding(final), cost: held.reaped?.cost ?? recordedEnding(final).cost }
        : undefined;
    const launch = launchOf(registry, stored, held, custody, call, pace !== undefined);
    if (launch === undefined) {
      return yield* new AdoptionRefused({ reason: 'no-admission', detail: 'a command execution holds no admission in the store', ref });
    }
    yield* capacity.reserve(id, stored.state.transport).pipe(Effect.mapError(refusing('capacity', ref)));

    const scope = yield* Scope.make();
    const closing = yield* Effect.cached(Effect.forkIn(Scope.close(scope, Exit.void), registryScope));
    const close = Effect.flatMap(Effect.uninterruptible(closing), Fiber.join);
    const taken = yield* Ref.make(false);
    const built = yield* Effect.gen(function* () {
      const failed = (['stdout', 'stderr', 'pty'] as const).filter((stream) => stored.state.streams[stream] === 'error');
      const record = yield* makeSegmentRecord({ mode: 'reopen', records, ref, transport: stored.state.transport, limits, failed }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.mapError(refusing('record-unreadable', ref)),
      );
      return yield* Effect.gen(function* () {
        const departure = yield* store
          .departureOf(id)
          .pipe(
            Effect.mapError((failure) =>
              failure._tag === 'DepartureLost'
                ? new AdoptionRefused({ reason: 'departure-lost', detail: failure.detail, ref })
                : refusing('store-unreadable', ref)(failure),
            ),
          );
        const spawned = yield* Ref.make<NativeExecution | undefined>(undefined);
        const adopted: Adopted = {
          held,
          stored,
          call,
          rules,
          pace,
          record,
          departure,
          ending,
          retiring: Ref.get(taken),
          screen:
            stored.state.transport === 'pty'
              ? (reply) => restoreScreen(fs, path, record, ref, limits, baseColors(), reply, departure?.parsed)
              : undefined,
        };
        const assembled = yield* assemble(registry, operation, launch, ref, spawned, undefined, adopted).pipe(
          Effect.mapError(refusing('assembly-failed', ref)),
        );
        const state = yield* Ref.updateAndGet(assembled.state, (state) =>
          state.phase === 'reserved' || state.phase === 'queued' || state.phase === 'starting'
            ? { ...state, phase: 'running' as const }
            : state,
        );
        yield* store.adoptStart(operation, state, assembled.native.identity).pipe(Effect.mapError(refusing('store-unreadable', ref)));
        return { assembled, spent: departure !== undefined };
      }).pipe(Effect.onError(() => Effect.result(record.suspend())));
    }).pipe(
      Scope.provide(scope),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.onError(() => Effect.andThen(capacity.release(id), Scope.close(scope, Exit.void))),
    );
    yield* Ref.set(taken, true);
    const entry: Live = { ...built.assembled, scope, close };
    standing.hold(ref.execution, entry);
    yield* inventoryMoved(registry, ref.execution);
    if (built.spent) {
      yield* Effect.result(store.dropDeparture(id)).pipe(
        Effect.flatMap((dropped) =>
          dropped._tag === 'Success'
            ? Effect.void
            : Effect.logWarning(`the departure kept for ${id} could not be dropped: ${dropped.failure._tag}`),
        ),
      );
    }
    yield* releaseSoon(registry, entry);
    yield* Effect.forkIn(continueEnding(registry, entry, operation, intents), registryScope);
    return undefined;
  },
  Effect.exit,
  (effect, _registry, held) =>
    Effect.map(effect, (outcome): UnadoptedExecution | undefined => {
      if (Exit.isSuccess(outcome)) return outcome.value;
      const refused = Cause.findErrorOption(outcome.cause);
      return Option.isSome(refused)
        ? { execution: held.id, ref: refused.value.ref, reason: refused.value.reason, detail: refused.value.detail }
        : { execution: held.id, reason: 'assembly-failed', detail: Cause.pretty(outcome.cause) };
    }),
);

export const adoptHeld = Effect.fn('ExecutionRegistry.adoptHeld')(function* (registry: RegistryState) {
  const refused: UnadoptedExecution[] = [];
  const seen = new Set<string>();
  for (const held of registry.holder.held) {
    if (seen.has(held.id)) {
      refused.push({ execution: held.id, reason: 'assembly-failed', detail: 'the holder table names this execution twice' });
      continue;
    }
    seen.add(held.id);
    const outcome = yield* one(registry, held);
    if (outcome !== undefined) refused.push(outcome);
  }
  const limit = registry.capacity.profile.ceilings.executions;
  for (const phase of ['reserved', 'queued'] as const) {
    let after: ExecutionId | undefined;
    for (;;) {
      const starts = yield* registry.store.unresolvedStarts(phase, after, limit);
      for (const start of starts) {
        if (seen.has(start.execution.execution)) continue;
        yield* registry.store.refuseStart(start.operation, start.execution, {
          _tag: 'SpawnFailed',
          reason: 'the complete holder table contains no child for this unresolved launch',
        });
      }
      if (starts.length < limit) break;
      after = starts.at(-1)!.execution.execution;
    }
  }
  yield* Ref.set(registry.unadopted, refused);
  return refused;
});
