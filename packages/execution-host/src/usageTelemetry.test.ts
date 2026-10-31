import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { EvidenceScope, LoadReading } from '@runlith/executions/protocol/evidence';
import { PerformanceStore } from '@runlith/performance/PerformanceStore';
import { RECORD_CADENCE_MICROS, makeLoadRecorder } from './usageTelemetry';

const machine = { _tag: 'Local', machine: 'telemetry-fixture' } as const;
const scope: EvidenceScope = { host: machine, network: machine };
const loadAt = (takenAtMicros: number, cores: number, bytes: number): LoadReading => ({
  scope,
  observedAt: 1,
  revision: 1,
  takenAtMicros,
  overMicros: 1_000_000,
  cores: 8,
  machineName: 'Computer',
  unresolvedParts: [],
  cpu: null,
  memory: { _tag: 'Unknown', reason: 'unknown', detail: 'fixture' },
  groups: [
    {
      owner: { _tag: 'Installation' },
      cores,
      gpuCores: 0,
      gpuUnread: 1,
      memoryBytes: bytes,
      unread: 0,
      processes: [
        {
          identity: { pid: 7, birth: '7' },
          name: 'bun',
          cores,
          gpu: { _tag: 'Unavailable', reason: 'not measured' },
          memoryBytes: bytes,
          signal: false,
        },
      ],
    },
  ],
});
const unused = (): never => {
  throw new Error('the load recorder reached an unrelated store operation');
};

it.effect('records changed load subjects and refreshes them at the cadence without recording steady samples', () =>
  Effect.gen(function* () {
    const submitted: unknown[] = [];
    const store = PerformanceStore.of({
      openGroup: unused,
      closeGroup: unused,
      submit: (submission) => {
        submitted.push(submission.record.payload);
      },
      submitDurable: () => Effect.die('unexpected durable load submission'),
      readWorkerMemory: () => Effect.die('unexpected worker memory reading'),
      flush: Effect.die('unexpected load flush'),
      pressure: unused,
      diagnostics: unused,
    });
    const recorder = yield* makeLoadRecorder.pipe(Effect.provideService(PerformanceStore, store));
    const emissions: unknown[][] = [];
    for (const step of [
      loadAt(1_000_000, 1, 1000),
      loadAt(2_000_000, 1.01, 1010),
      loadAt(3_000_000, 2, 1010),
      loadAt(4_000_000, 2, 2000),
      loadAt(4_000_000 + RECORD_CADENCE_MICROS, 2, 2000),
    ]) {
      const before = submitted.length;
      yield* recorder.record(step, new Map());
      emissions.push(submitted.slice(before));
    }
    expect(emissions).toEqual([
      [
        expect.objectContaining({
          _tag: 'Installation',
          cpu: expect.objectContaining({ cores: 1 }),
          memory: expect.objectContaining({ bytes: 1000 }),
        }),
        expect.objectContaining({ _tag: 'Machine' }),
      ],
      [],
      [
        expect.objectContaining({
          _tag: 'Installation',
          cpu: expect.objectContaining({ cores: 2 }),
          memory: expect.objectContaining({ bytes: 1010 }),
        }),
      ],
      [expect.objectContaining({ _tag: 'Installation', memory: expect.objectContaining({ bytes: 2000 }) })],
      [
        expect.objectContaining({ _tag: 'Installation', takenAtMicros: 4_000_000 + RECORD_CADENCE_MICROS }),
        expect.objectContaining({ _tag: 'Machine', takenAtMicros: 4_000_000 + RECORD_CADENCE_MICROS }),
      ],
    ]);
  }),
);
