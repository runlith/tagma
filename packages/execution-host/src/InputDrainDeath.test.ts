import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Duration, Effect, Metric, Schema, Schedule } from 'effect';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { InputActUnsupported, type InputSink, makeExecutionInput } from './ExecutionInput';
import { fiberDeaths } from './hostTelemetry';
import { admit, runtimeProfile } from './runtimeFixture';

const decodeRef = Schema.decodeUnknownSync(ExecutionRef);
const ref = decodeRef({ installation: 'installation-1', execution: 'execution-1', incarnation: 0 });
const limits = runtimeProfile({ inputPendingBytes: 64, inputReceipts: 2 }).execution;
describe('input drain death', () => {
  it.live(
    'a defect on the writer fences the queue as write-failed, and later admit names it',
    Effect.fnUntraced(
      function* () {
        const sink: InputSink = {
          initiallyClosed: false,
          write: () => Effect.die(new Error('writer defect')),
          stop: Effect.void,
          interrupt: () => Effect.fail(new InputActUnsupported({ act: 'interrupt', reason: 'transport', detail: 'none' })),
          resize: () => Effect.fail(new InputActUnsupported({ act: 'resize', reason: 'transport', detail: 'none' })),
          end: { _tag: 'Closes', close: () => Effect.void },
        };
        const input = yield* makeExecutionInput({ sink, limits, ref, announce: Effect.void });
        const first = yield* admit(input, {
          sequence: 0,
          cause: 'typed',
          act: { _tag: 'Write', bytes: new TextEncoder().encode('hello') },
        });
        const deaths = yield* Metric.value(Metric.withAttributes(fiberDeaths, { fiber: 'input-drain' })).pipe(
          Effect.repeat({ while: (reading) => reading.count === 0, schedule: Schedule.spaced(Duration.millis(1)) }),
        );
        const request = { sequence: 1, cause: 'typed', act: { _tag: 'Write', bytes: new TextEncoder().encode('more') } } as const;
        const fenced = yield* Effect.flip(admit(input, request));
        const again = yield* Effect.flip(admit(input, request));
        expect(first._tag).toBe('InputAdmitted');
        expect(fenced).toMatchObject({ _tag: 'InputFenced', reason: 'write-failed' });
        expect(fenced.detail).toContain('writer defect');
        expect(again._tag).toBe('InputFenced');
        expect(deaths.count).toBe(1);
      },
      (effect) => Effect.provideService(effect, Metric.MetricRegistry, new Map()),
    ),
  );
});
