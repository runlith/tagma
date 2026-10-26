import { Deferred, Effect, Ref, type Result, Stream } from 'effect';
import { type ExecutionState, type HostRequestRef, type StreamEnding } from '@runlith/executions/protocol/execution';
import { type Stream as RecordStream, byteOffset } from '@runlith/executions/protocol/record';
import { type UnverifiableResource } from '@runlith/executions/protocol/stop';
import type { Execution } from '../Execution';
import type { SegmentRecord } from '../ExecutionRecord';
import type { Interpretation } from '../Interpretation';
import { type Presentation } from '../Presentation';
import { NativeReadStopped, nativeFailureReason, type NativeExecution, type NativeSource } from '../nativeLaunch';
import type { ExecutionInput } from '../ExecutionInput';
import { RecordWriteFailed } from '../RecordWriter';
import { abandonCheckpoint, keepTaken, retireCheckpoint, type CheckpointUnkept } from '../checkpointFile';
import { type RegistryState, inventoryMoved } from './state';
import { sweepAfter } from './endings';

export const endedStreams = (held: ExecutionState, stream: RecordStream, ending: StreamEnding): ExecutionState['streams'] =>
  held.transport === 'pty'
    ? { pty: ending, stdout: ending, stderr: ending }
    : {
        stdout: stream === 'stdout' ? ending : held.streams.stdout,
        stderr: stream === 'stderr' ? ending : held.streams.stderr,
        pty: stream === 'pty' ? ending : 'eof',
      };

export const pipeline = Effect.fnUntraced(function* (
  registry: RegistryState,
  record: SegmentRecord,
  interpretation: Interpretation | undefined,
  source: NativeSource,
  operation: HostRequestRef,
  announce: Effect.Effect<void>,
  presentation: Presentation | undefined,
  endedSource: (stream: RecordStream, ending: StreamEnding) => Effect.Effect<void>,
  rested: Deferred.Deferred<void>,
) {
  const { calls, reclaim, limits, fs, path } = registry;
  const unkept = (what: string) => (outcome: Result.Result<void, CheckpointUnkept>) =>
    outcome._tag === 'Failure' ? Effect.logWarning(`the screen checkpoint was not ${what}`, outcome.failure) : Effect.void;
  const broke = yield* Ref.make<string | undefined>(undefined);
  let abandoned = false;
  const incoming = Stream.unfold(undefined, () =>
    Effect.map(
      record
        .capture(source.stream, limits.output.landingBytes, source.read(limits.output.landingBytes))
        .pipe(Effect.catchTag('CaptureStopped', () => Effect.fail(new NativeReadStopped({ stream: source.stream })))),
      (chunk) => (chunk === undefined ? undefined : ([chunk, undefined] as const)),
    ),
  );
  yield* Stream.runForEach(incoming, (chunk) =>
    Effect.gen(function* () {
      let retained: number | undefined;
      for (let at = 0; at < chunk.length; at += limits.output.landingBytes) {
        const slice = chunk.subarray(at, Math.min(at + limits.output.landingBytes, chunk.length));
        if (interpretation === undefined) continue;
        const fed = yield* Effect.result(interpretation.burst(slice));
        if (fed._tag === 'Success') retained = fed.success.retained;
        yield* record.acknowledgeParsed(source.stream, fed._tag === 'Success' ? fed.success.parsed : fed.failure.parsedThrough).pipe(
          Effect.catchTag('FrontierRefused', () => Effect.void),
          Effect.orDie,
        );
        if (fed._tag === 'Success' && fed.success.checkpoint !== undefined) {
          yield* keepTaken(fs, path, record.directory, fed.success.checkpoint);
        }
        if (fed._tag === 'Failure') {
          yield* record.abandonInterpretation();
          if (!abandoned) {
            abandoned = true;
            yield* Effect.flatMap(Effect.result(abandonCheckpoint(fs, path, record.directory, fed.failure)), unkept('abandoned'));
          }
        }
      }
      if (interpretation !== undefined) {
        yield* reclaim.touch(interpretation.ref.execution);
        yield* reclaim.measure(interpretation.ref.execution, retained);
      }
      if (presentation !== undefined) yield* presentation.invalidate();
    }),
  ).pipe(
    Effect.andThen(
      interpretation === undefined
        ? Effect.void
        : Effect.flatMap(Effect.result(retireCheckpoint(fs, path, record.directory)), unkept('retired')),
    ),
    Effect.catchTag('NativeReadStopped', () => Effect.andThen(Deferred.succeed(rested, undefined), Effect.never)),
    Effect.catch((failure) =>
      Ref.set(
        broke,
        failure instanceof RecordWriteFailed
          ? `record ${failure.stream ?? source.stream}: ${failure.act}: ${failure.detail}`
          : nativeFailureReason(failure),
      ),
    ),
    Effect.catchDefect((defect) =>
      Effect.gen(function* () {
        yield* Ref.set(broke, String(defect));
        return yield* Effect.die(defect);
      }),
    ),
    Effect.ensuring(
      Effect.gen(function* () {
        const failure = yield* Ref.get(broke);
        yield* Effect.orDie(record.endStream(source.stream, failure === undefined ? 'eof' : 'error'));
        const positions = yield* Effect.result(record.positions(source.stream));
        if (positions._tag === 'Failure') {
          yield* Effect.logWarning(`the ${source.stream} frontier could not be read at the end of its source`, positions.failure);
        }
        const offset = positions._tag === 'Success' ? positions.success.durableThrough : byteOffset(0n);
        const completed = positions._tag === 'Success' && positions.success.ending === 'eof';
        yield* endedSource(
          source.stream,
          positions._tag === 'Success' ? positions.success.ending : failure === undefined ? 'eof' : 'error',
        );
        const settled = (stream: 'stdout' | 'stderr') =>
          calls.settle(operation, { _tag: 'Source', stream, offset, completed }).pipe(Effect.catchTag('CallMissing', () => Effect.void));
        if (source.stream !== 'pty') {
          yield* settled(source.stream);
        } else {
          yield* settled('stdout');
          yield* settled('stderr');
        }
        yield* announce;
        if (presentation !== undefined) yield* presentation.ended();
        yield* Deferred.succeed(rested, undefined);
      }),
    ),
  );
});

export const observeExit = Effect.fnUntraced(function* (
  registry: RegistryState,
  native: NativeExecution,
  record: SegmentRecord,
  operation: HostRequestRef,
  state: Ref.Ref<ExecutionState>,
  announce: Effect.Effect<void>,
  unmeasured: Ref.Ref<UnverifiableResource | undefined>,
  input: ExecutionInput,
  mirror: (state: ExecutionState) => Effect.Effect<void>,
) {
  const { calls } = registry;
  const exit = yield* Effect.result(native.exit);
  if (exit._tag === 'Failure') {
    const unreadable: UnverifiableResource = {
      kind: 'process',
      detail: 'the kernel reported no exit this host could read',
      reason: nativeFailureReason(exit.failure),
    };
    yield* Ref.set(unmeasured, unreadable);
    if (!exit.failure.ended) {
      yield* announce;
      return;
    }
  }
  yield* record.hurry;
  if (exit._tag === 'Success') {
    yield* Ref.update(state, (standing) => ({ ...standing, nativeExit: exit.success }));
    yield* calls.settle(operation, { _tag: 'Exit', exit: exit.success }).pipe(Effect.catchTag('CallMissing', () => Effect.void));
  }
  if (native.transport === 'pty') yield* input.finish();
  const ended = yield* Ref.updateAndGet(state, (held): ExecutionState => ({ ...held, phase: 'ended' }));
  yield* mirror(ended);
  yield* announce;
  yield* inventoryMoved(registry, ended.ref.execution);
});

export const finished = Effect.fn('Executions.finished')(function* (
  registry: RegistryState,
  execution: Execution,
  state: Ref.Ref<ExecutionState>,
  native: NativeExecution,
  announce: Effect.Effect<void>,
  unmeasured: Ref.Ref<UnverifiableResource | undefined>,
) {
  const { store, capacity } = registry;
  const graded = yield* execution.stop.outcome;
  if (graded !== undefined) {
    yield* sweepAfter(registry, execution.ref.execution, graded);
  }
  if ((yield* Ref.get(state)).nativeExit === undefined) {
    const absence = yield* Ref.get(unmeasured);
    if (absence === undefined) return;
    const ending = (yield* Ref.get(state)).phase === 'ended' ? yield* native.target.end('signal', undefined, 'ended') : undefined;
    yield* execution.stop.noteUnmeasurable(absence, ending);
  }
  const measured = (yield* Ref.get(state)).nativeExit === undefined ? yield* execution.stop.measured : yield* execution.stop.ended();
  if (measured === undefined) return;
  const released = yield* native.releaseOutput;
  if (released) yield* capacity.terminalReleased(execution.ref.execution);
  if (released && !measured.residual.some((row) => row.kind !== 'record') && (yield* Ref.get(state)).phase === 'ended')
    yield* capacity.exited(execution.ref.execution);
  yield* sweepAfter(registry, execution.ref.execution, measured);
  const moved = yield* Ref.updateAndGet(state, (held): ExecutionState => ({ ...held, cleanup: measured.cleanup }));
  yield* Effect.ignore(store.recordState(moved, native.identity));
  yield* announce;
  yield* inventoryMoved(registry, execution.ref.execution);
});
