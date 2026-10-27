import { Custodian } from '../Custodian';
import { Bindings } from '../Bindings';
import { ExecutionCapacity } from '../ExecutionCapacity';
import { Cause, Data, Deferred, Effect, Exit, FileSystem, Path, Ref, type Scope } from 'effect';
import { type CallBudget } from '@runlith/executions/protocol/call';
import { originOf } from '@runlith/executions/protocol/command';
import {
  type ExecutionRef,
  type ExecutionState,
  HostRequestKey,
  type HostRequestRef,
  type StreamEnding,
} from '@runlith/executions/protocol/execution';
import { type LaunchRequest, type NativeProcess } from '@runlith/executions/protocol/launch';
import { type Stream as RecordStream, type TerminalGeometry } from '@runlith/executions/protocol/record';
import { type ProcessWatchReading, type UnverifiableResource } from '@runlith/executions/protocol/stop';
import { type Execution, makeExecution } from '../Execution';
import { makeExecutionCustody } from '../ExecutionCustody';
import { ExecutionStore } from '../store/ExecutionStore';
import { type ExecutionInput, InputActUnsupported, InputWriteFailed, makeExecutionInput } from '../ExecutionInput';
import { makeSegmentRecord, type SegmentRecord } from '../ExecutionRecord';
import { type ExecutionStop, type RecordFacts, makeExecutionStop } from '../ExecutionStop';
import { makeInterpretation, type Interpretation, type InterpretationUnavailable, type ReplySink } from '../Interpretation';
import type { HeldExecution } from '../holder/Holder';
import type { BoundRuleRecord, CallRecord } from '../db/persisted';
import type { ExecutionRecord } from '../store/records';
import type { Departure } from '../store/departure';
import type { PaceContinuation } from '../Pacing';
import { type Presentation, makePresentation } from '../Presentation';
import { type RecordReaders, makeRecordReaders } from '../RecordReaders';
import { adoptNative, launchNative, NativeSpawnUncertain, type NativeExecution } from '../nativeLaunch';
import { killStray } from '../strayProcesses';
import { diskLookups } from '../ProgramMatch';
import { Processes } from '../ProcessReader';
import { type DefaultDeadline, type ProgramRules, watchReading, makeProgramRules } from '../ProgramRules';
import { type Reading, type AcceptedGate, type Accepted, type RegistryState, inventoryMoved } from './state';
import { commandBudget } from './revisions';
import { retainedOf, sourcesOf, releaseSoon } from './retention';
import { stopOf } from './endings';
import { endedStreams, pipeline, observeExit, finished } from './work';

export class LaunchAbandoned extends Data.TaggedError('LaunchAbandoned')<{
  readonly execution: string;
}> {}

const budgetOf = (launch: LaunchRequest): CallBudget | undefined =>
  launch.lifetime === 'command'
    ? commandBudget(launch.admission.limits.executionMs)
    : launch.lifetime === 'call'
      ? (launch.budget ?? {})
      : undefined;

const defaultDeadline = (
  registry: RegistryState,
  launch: LaunchRequest,
  operation: HostRequestRef,
  ref: ExecutionRef,
): DefaultDeadline | undefined => {
  const { calls } = registry;
  if (launch.lifetime !== 'command') return undefined;
  const limits = launch.admission.limits;
  if (originOf(limits) !== 'default' || limits.executionMs === undefined) return undefined;
  return {
    defaultMs: limits.executionMs,
    read: calls.deadline(operation).pipe(Effect.catchTag('CallMissing', () => Effect.succeed(undefined))),
    extend: (expected, executionMs) =>
      Effect.asVoid(
        calls
          .revise(
            operation,
            {
              operation: {
                installation: operation.installation,
                operation: HostRequestKey.make(`${operation.operation}:programs:${expected + 1}:${executionMs}`),
              },
              execution: ref,
              expected,
              change: { _tag: 'Total', executionMs },
              actor: 'host',
              cause: 'rule',
            },
            'default',
          )
          .pipe(
            Effect.flatMap((answered) => (answered._tag === 'Revised' ? inventoryMoved(registry, ref.execution) : Effect.void)),
            Effect.catchTag('CallMissing', () => Effect.void),
          ),
      ),
  };
};

export type Adopted = {
  readonly held: HeldExecution;
  readonly stored: ExecutionRecord;
  readonly call: CallRecord | undefined;
  readonly rules: ReadonlyArray<BoundRuleRecord> | undefined;
  readonly pace: PaceContinuation | undefined;
  readonly record: SegmentRecord;
  readonly departure: Departure | undefined;
  readonly retiring: Effect.Effect<boolean>;
  readonly screen: ((reply: ReplySink) => Effect.Effect<Interpretation, InterpretationUnavailable, Scope.Scope>) | undefined;
};

export const assemble = Effect.fnUntraced(function* (
  registry: RegistryState,
  operation: HostRequestRef,
  launch: LaunchRequest,
  ref: ExecutionRef,
  spawned: Ref.Ref<NativeExecution | undefined>,
  accepted?: Accepted,
  adopted?: Adopted,
) {
  const {
    store,
    custodian,
    bindings,
    capacity,
    fs,
    path,
    holder,
    terminals,
    strays,
    tables,
    watch,
    pacing,
    calls,
    reclaim,
    held,
    records,
    limits,
  } = registry;
  const over = Deferred.makeUnsafe<void>();
  yield* Effect.addFinalizer(() => Effect.asVoid(Deferred.succeed(over, undefined)));
  const transport = launch.transport._tag;
  const changed = yield* Ref.make(Deferred.makeUnsafe<void>());
  const born = launch.transport._tag === 'pty' ? { grid: launch.transport.geometry } : { streaming: launch.transport.streaming };
  const record =
    adopted !== undefined
      ? adopted.record
      : accepted === undefined
        ? yield* makeSegmentRecord({ mode: 'create', records, ref, transport, limits, ...born }).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
          )
        : yield* Effect.raceFirst(
            makeSegmentRecord({ mode: 'create', records, ref, transport, limits, ...born }).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
            ),
            Effect.flatMap(Deferred.await(accepted.ended), () => new LaunchAbandoned({ execution: ref.execution })),
          );
  const budget = adopted === undefined ? budgetOf(launch) : adopted.call?.budget;
  if (adopted !== undefined) {
    if (budget !== undefined) {
      const timing = adopted.call?.timing;
      yield* calls.open(operation, ref, budget, launch.lifetime === 'command' ? { origin: timing?.origin ?? 'caller' } : undefined, timing);
    }
  } else if (accepted !== undefined) {
    const taken = yield* accepted.revising.withPermits(1)(
      Effect.gen(function* () {
        const won = yield* Ref.modify(accepted.gate, (standing): readonly [boolean, AcceptedGate] =>
          standing === 'queued' ? [true, 'acquiring'] : [false, standing],
        );
        if (!won) return false;
        const standing = yield* Ref.get(accepted.allowance);
        yield* calls.open(operation, ref, commandBudget(standing.executionMs), {
          ceilingMs: standing.ceilingMs,
          revision: standing.revision,
          origin: standing.origin,
          foregroundMs: standing.foregroundMs,
        });
        return true;
      }),
    );
    if (!taken) return yield* new LaunchAbandoned({ execution: ref.execution });
  } else if (budget !== undefined) {
    yield* calls.open(operation, ref, budget);
  }
  const native =
    adopted === undefined
      ? yield* launchNative(launch, ref, holder, tables, launch.paced === true ? pacing.spawning : 'full').pipe(
          Effect.tapError((failure) =>
            failure instanceof NativeSpawnUncertain
              ? Effect.flatMap(Effect.result(record.suspend()), (saved) =>
                  saved._tag === 'Failure'
                    ? Effect.logWarning('the unresolved launch record could not be suspended; its launch remains uncertain', {
                        execution: ref.execution,
                        failure: saved.failure,
                      })
                    : Effect.void,
                )
              : Effect.void,
          ),
        )
      : yield* adoptNative(adopted.held, holder, tables, adopted.departure?.descendants, adopted.retiring);
  yield* Ref.set(spawned, native);
  if (adopted?.departure !== undefined) yield* native.owe(adopted.departure.echoes);
  if (watch !== undefined && native.proven !== undefined) yield* watch.hold(native.proven);
  if (launch.paced === true) yield* pacing.hold(ref, native, adopted?.pace);
  yield* calls.arm(operation).pipe(Effect.catchTag('CallMissing', () => Effect.void));

  let input: ExecutionInput | undefined;
  let presentation: Presentation | undefined;
  let interpreting: Interpretation | undefined;
  const reply: ReplySink = (bytes, settling) =>
    input === undefined
      ? Effect.succeed({ delivered: false, ending: false, detail: 'the input queue was not open yet', room: undefined })
      : Effect.map(Effect.result(input.reply(bytes, settling)), (answered) =>
          answered._tag === 'Failure'
            ? {
                delivered: false,
                ending: answered.failure.reason === 'stopping',
                detail: `${answered.failure.reason}: ${answered.failure.detail}`,
                room: undefined,
              }
            : answered.success._tag === 'ReplyQueued'
              ? { delivered: true, ending: false, detail: '', room: undefined }
              : answered.success._tag === 'ReplyEnded'
                ? { delivered: false, ending: true, detail: 'the input of this execution was closed by an end of input', room: undefined }
                : {
                    delivered: false,
                    ending: false,
                    detail: `the input queue holds ${answered.success.pendingBytes} of ${answered.success.limit} bytes`,
                    room: answered.success.room,
                  },
        );

  const resized = Effect.fn('ExecutionRegistry.resize')(function* (geometry: TerminalGeometry) {
    const at = yield* record
      .regrid(geometry)
      .pipe(Effect.mapError((failure) => new InputActUnsupported({ act: 'resize', reason: 'unreadable', detail: failure.detail })));
    if (interpreting === undefined) return;
    yield* interpreting.resize(geometry, at).pipe(
      Effect.mapError(
        (failure): InputActUnsupported =>
          new InputActUnsupported({
            act: 'resize',
            reason: failure.reason === 'budget' || failure.reason === 'profile' ? 'geometry' : 'unreadable',
            detail: failure.detail,
          }),
      ),
    );
    yield* reclaim.measure(ref.execution);
    if (presentation !== undefined) yield* presentation.invalidate();
  });
  const announce = Effect.suspend(() =>
    Effect.flatMap(Ref.getAndSet(changed, Deferred.makeUnsafe<void>()), (standing) => {
      held.touched(ref.execution);
      return Effect.asVoid(Deferred.succeed(standing, undefined));
    }),
  );
  const terminal = native.held.channels._tag === 'pty' ? native.held.channels.terminal : undefined;
  const ending = native.sink.end;
  const carried = adopted?.departure?.input;
  const queue =
    terminal === undefined
      ? yield* makeExecutionInput({
          sink: { ...native.sink, resize: (geometry) => Effect.andThen(native.sink.resize(geometry), resized(geometry)) },
          limits,
          ref,
          announce,
          carried,
        })
      : yield* terminals.open(terminal, {
          limits,
          ref,
          announce,
          carried,
          end: () =>
            ending._tag === 'Closes'
              ? ending.close()
              : Effect.fail(new InputWriteFailed({ reason: 'closed', detail: ending.refusal.detail })),
          resized,
        });
  input = queue;
  const interpretation =
    adopted !== undefined
      ? adopted.screen === undefined
        ? undefined
        : yield* adopted.screen(reply)
      : transport === 'pty'
        ? yield* makeInterpretation({
            mode: 'open',
            ref,
            geometry:
              launch.transport._tag === 'pty'
                ? launch.transport.geometry
                : { rows: limits.geometry.rows, columns: limits.geometry.columns },
            limits,
            colors: baseColors(),
            reply,
          })
        : undefined;
  interpreting = interpretation;

  const readers = yield* makeRecordReaders({ record }).pipe(Effect.provideService(ExecutionCapacity, capacity));
  const custody = yield* makeExecutionCustody({ ref }).pipe(Effect.provideService(ExecutionStore, store));
  presentation = interpretation === undefined ? undefined : yield* makePresentation({ interpretation, limits, ref });
  if (interpretation !== undefined) yield* reclaim.hold(ref.execution, interpretation, presentation);
  const state = yield* Ref.make<ExecutionState>(
    adopted !== undefined
      ? adopted.stored.state
      : {
          ref,
          transport,
          lifetime: launch.lifetime,
          purpose: launch.purpose,
          phase: 'starting',
          streams: { stdout: 'open', stderr: 'open', pty: 'open' },
          cleanup: 'pending',
          record: 'available',
        },
  );
  const unrecorded = yield* Ref.make<ReadonlyArray<UnverifiableResource>>([]);
  const facts: RecordFacts = {
    streams: () => Effect.map(record.everyPosition, (all) => all.map(({ stream, ending }) => ({ stream, ending }))),
    sources: () => sourcesOf(record),
    retention: () => retainedOf(record),
    observedExit: () => Effect.map(Ref.get(state), (held) => held.nativeExit),
    unrecorded: () => Ref.get(unrecorded),
  };
  const mirror = (moved: ExecutionState): Effect.Effect<void> =>
    Effect.flatMap(Effect.result(store.recordState(moved, native.identity)), (written) =>
      written._tag === 'Success'
        ? Effect.void
        : Ref.update(unrecorded, (held) => [
            ...held,
            { kind: 'record' as const, detail: `execution state: ${moved.phase}`, reason: String(written.failure._tag) },
          ]),
    );
  const stop = yield* makeExecutionStop({ input: queue, target: native.target, facts, ref }).pipe(
    Effect.provideService(ExecutionStore, store),
  );
  const programs = launch.lifetime === 'command' ? launch.admission.programs : undefined;
  const rules =
    programs === undefined || native.proven === undefined || watch === undefined || strays === undefined
      ? undefined
      : yield* makeProgramRules({
          set: native.proven,
          programs,
          ports: {
            lookups: diskLookups,
            kill: killStray(registry.control),
            first: transport === 'pty' ? 'hang-up' : 'interrupt',
            changed: announce,
            persist: (bound) => store.recordRules({ execution: ref, bound }).pipe(Effect.orDie),
            deadline: defaultDeadline(registry, launch, operation, ref),
          },
          resumed: adopted?.rules,
        }).pipe(Effect.provideService(Processes, strays));
  if (rules !== undefined && native.proven !== undefined && watch !== undefined) yield* watch.enforce(native.proven, rules);
  const proven = native.proven;
  const watching: Effect.Effect<ProcessWatchReading> | undefined =
    rules !== undefined
      ? rules.reading()
      : proven !== undefined
        ? Effect.map(proven.reading, (set) => ({ ...watchReading(set), rulings: [], omitted: 0 }))
        : programs !== undefined
          ? Effect.succeed({ ...watchReading(undefined), rulings: [], omitted: 0 })
          : undefined;
  const execution = yield* makeExecution({
    ref,
    custody,
    input: queue,
    record,
    readers,
    stop,
    interpretation,
    presentation,
    geometry: { rows: limits.geometry.rows, columns: limits.geometry.columns },
    watching,
  }).pipe(Effect.provideService(Bindings, bindings), Effect.provideService(Custodian, custodian));

  const reading = yield* Ref.make<Reading>({ fenced: false, reads: 0, readers: 0, settled: undefined });
  const process = yield* Ref.make<NativeProcess>(native.identity);

  yield* Effect.addFinalizer(() => capacity.release(ref.execution));

  if (budget !== undefined) {
    yield* Effect.forkScoped(
      Effect.flatMap(calls.awaitDecision(operation), (decision) =>
        decision._tag === 'Cancelled'
          ? stopOf(registry, ref.execution, operation, decision.cause).pipe(
              Effect.asVoid,
              Effect.catchTag('ExecutionUnknown', () => Effect.void),
            )
          : Effect.void,
      ).pipe(Effect.catchTag('CallMissing', () => Effect.void)),
    );
  }

  const unmeasured = yield* Ref.make<UnverifiableResource | undefined>(undefined);

  yield* Effect.forkScoped(
    record.awaitBeyond('output', 0n, undefined).pipe(
      Effect.flatMap((printed) => (printed ? inventoryMoved(registry, ref.execution) : Effect.void)),
      Effect.catchTag('StreamMissing', () => Effect.void),
    ),
  );

  const sourceEnded = Effect.fnUntraced(function* (stream: RecordStream, ending: StreamEnding) {
    const moved = yield* Ref.updateAndGet(state, (held): ExecutionState => ({
      ...held,
      streams: endedStreams(held, stream, ending),
    }));
    yield* mirror(moved);
    yield* inventoryMoved(registry, ref.execution);
  });

  const rested = native.sources.map(() => Deferred.makeUnsafe<void>());
  const stopReading = Effect.andThen(
    Effect.forEach(native.sources, (source) => Effect.andThen(source.stop, record.stopCapture(source.stream).pipe(Effect.orDie)), {
      discard: true,
    }),
    Effect.forEach(rested, (pipeline) => Deferred.await(pipeline), { discard: true }),
  );

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      const worked = yield* Effect.exit(
        Effect.all(
          [
            ...native.sources.map((source, index) =>
              pipeline(registry, record, interpretation, source, operation, announce, presentation, sourceEnded, rested[index]!),
            ),
            observeExit(registry, native, record, operation, state, announce, unmeasured, queue, mirror),
          ],
          { concurrency: 'unbounded' },
        ),
      );
      if (Exit.isFailure(worked) && !Cause.hasInterruptsOnly(worked.cause)) {
        const died: UnverifiableResource = {
          kind: 'record',
          detail: "this execution's own byte pipeline died",
          reason: Cause.pretty(worked.cause),
        };
        yield* Ref.update(unmeasured, (standing) => standing ?? died);
      }
      yield* finished(registry, execution, state, native, announce, unmeasured);
      yield* Deferred.succeed(over, undefined);
      yield* registry.inventoryWoken;
      const joined = held.get(ref.execution);
      if (joined !== undefined) yield* releaseSoon(registry, joined);
      return yield* worked;
    }),
  );

  return { ref, execution, native, operation, state, process, reading, changed, worked: over, stopReading };
});

export const baseColors = () => {
  const palette: number[] = [
    0x000000, 0xcd0000, 0x00cd00, 0xcdcd00, 0x0000ee, 0xcd00cd, 0x00cdcd, 0xe5e5e5, 0x7f7f7f, 0xff0000, 0x00ff00, 0xffff00, 0x5c5cff,
    0xff00ff, 0x00ffff, 0xffffff,
  ];
  const steps = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r += 1)
    for (let g = 0; g < 6; g += 1) for (let b = 0; b < 6; b += 1) palette.push((steps[r]! << 16) | (steps[g]! << 8) | steps[b]!);
  for (let grey = 0; grey < 24; grey += 1) {
    const value = 8 + grey * 10;
    palette.push((value << 16) | (value << 8) | value);
  }
  return { palette, foreground: 0xe5e5e5, background: 0x000000, cursor: 0xe5e5e5 };
};
