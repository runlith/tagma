import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Ref } from 'effect';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import { makeExecutionInput } from './ExecutionInput';
import { makeExecutionStop, type NativeEnding, type RecordFacts } from './ExecutionStop';
import { keyOf } from './hostFixture';
import { runtimeProfile } from './runtimeFixture';
import { ExecutionStore } from './store/ExecutionStore';
import { unreadStore } from './testing/store';

const ref: ExecutionRef = {
  installation: InstallationId.make('installation-1'),
  execution: ExecutionId.make('released-native'),
  incarnation: 1,
};
const measured: NativeEnding = {
  exit: { _tag: 'Code', code: 0 },
  measured: ['leader'],
  confirmed: [{ pid: 42, relation: 'leader', exit: { _tag: 'Code', code: 0 }, step: 'unsignalled' }],
  residual: [],
  unverifiable: [],
  abandonedOutput: false,
  cost: { _tag: 'Measured', cpuMicros: 125, peakRssBytes: 4096 },
  steps: [],
};
const released: NativeEnding = {
  exit: undefined,
  measured: [],
  confirmed: [],
  residual: [],
  unverifiable: [{ kind: 'process', detail: 'the native resource was released', reason: 'its measurement is no longer available' }],
  abandonedOutput: false,
  cost: { _tag: 'Unmeasured', reason: 'unknown', detail: 'the native resource was released' },
  steps: [],
};
const facts: RecordFacts = {
  streams: () =>
    Effect.succeed([
      { stream: 'stdout', ending: 'eof' },
      { stream: 'stderr', ending: 'eof' },
    ]),
  sources: () =>
    Effect.succeed({ stdout: { completed: true, offset: byteOffset(0n) }, stderr: { completed: true, offset: byteOffset(0n) } }),
  retention: () => Effect.succeed('retained'),
  observedExit: () => Effect.succeed({ _tag: 'Code', code: 0 }),
  unrecorded: () => Effect.succeed([]),
};
const store = ExecutionStore.of({ ...unreadStore, recordFinal: () => Effect.void, recordStop: () => Effect.void });

it.effect('requested stops preserve a complete measurement after the native resource has been released', () =>
  Effect.gen(function* () {
    const native = yield* Ref.make(measured);
    const unused = () => Effect.die('this input operation is outside the case');
    const input = yield* makeExecutionInput({
      ref,
      limits: runtimeProfile({ transports: ['pipes'] }).execution,
      announce: Effect.void,
      sink: {
        initiallyClosed: true,
        write: unused,
        stop: Effect.void,
        interrupt: unused,
        resize: unused,
        end: { _tag: 'Closes', close: () => Effect.void },
      },
    });
    const stop = yield* makeExecutionStop({
      ref,
      input,
      facts,
      target: {
        relations: ['leader'],
        identity: () => Effect.succeed({ pid: 42 }),
        end: () => Ref.get(native),
        signal: unused,
      },
    });
    const ending = yield* stop.ended();
    if (ending === undefined) return yield* Effect.die('the ended resource has no measurement');
    expect(ending.cleanup).toBe('complete');
    yield* Ref.set(native, released);
    const first = yield* stop.stop(keyOf('shutdown-stop'), 'shutdown', 'destroy');
    const second = yield* stop.stop(keyOf('operator-stop'), 'explicit-stop', 'signal');
    expect(first).toEqual({ ...ending, operation: keyOf('shutdown-stop'), requested: 'destroy', cause: 'shutdown', steps: [] });
    expect(second).toEqual({ ...ending, operation: keyOf('operator-stop'), requested: 'signal', cause: 'shutdown', steps: [] });
  }).pipe(Effect.provideService(ExecutionStore, store)),
);
