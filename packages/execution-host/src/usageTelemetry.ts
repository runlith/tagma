import { randomUUID } from 'node:crypto';
import { Effect, Option } from 'effect';
import type { LoadReading, UsageMemory, UsageRate, UsageReading } from '@runlith/executions/protocol/evidence';
import { PerformanceStore } from '@runlith/performance/PerformanceStore';
import type { LoadPayload } from '@runlith/performance/protocol/records';
import { type PerformanceRecord, recordByteSize } from '@runlith/performance/store/records';

const instanceId = randomUUID();
export const RECORD_CADENCE_MICROS = 30_000_000;
export const CORES_MOVED = 0.05;
export const BYTES_MOVED = 0.05;
export const usageStep = <A, E, R>(step: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.withSpan(step, 'usage.step');

type Figure = {
  readonly takenAtMicros: number;
  readonly completeness: string;
  readonly processes: number;
  readonly cores: number | undefined;
  readonly bytes: number | undefined;
};
const differs = (last: number | undefined, next: number | undefined, moved: (last: number, next: number) => boolean): boolean =>
  last === undefined || next === undefined ? last !== next : moved(last, next);
const moved = (last: Figure, next: Figure): boolean =>
  next.takenAtMicros - last.takenAtMicros >= RECORD_CADENCE_MICROS ||
  last.completeness !== next.completeness ||
  last.processes !== next.processes ||
  differs(last.cores, next.cores, (before, after) => Math.abs(after - before) >= CORES_MOVED) ||
  differs(last.bytes, next.bytes, (before, after) => Math.abs(after - before) > BYTES_MOVED * Math.max(before, 1));
const cores = (rate: UsageRate): number | undefined => (rate._tag === 'Measured' ? rate.cores : undefined);
const bytes = (memory: UsageMemory): number | undefined => (memory._tag === 'Unknown' ? undefined : memory.bytes);

export const makeLoadRecorder = Effect.gen(function* () {
  const available = yield* Effect.serviceOption(PerformanceStore);
  let recorded: ReadonlyMap<string, Figure> = new Map();
  const reset = (): void => {
    recorded = new Map();
  };
  const record = (reading: LoadReading, executions: ReadonlyMap<string, UsageReading>): Effect.Effect<void> =>
    Effect.sync(() => {
      if (Option.isNone(available)) return;
      const store = available.value;
      const kept = new Map<string, Figure>();
      const submit = (key: string, wallTime: number, figure: Figure, payload: LoadPayload): void => {
        const last = recorded.get(key);
        if (last !== undefined && !moved(last, figure)) {
          kept.set(key, last);
          return;
        }
        kept.set(key, figure);
        const id = randomUUID();
        const record: PerformanceRecord<'load', LoadPayload> = {
          id,
          instanceId,
          kind: 'load',
          wallTime,
          monotonicStart: payload.takenAtMicros / 1000,
          monotonicEnd: payload.takenAtMicros / 1000,
          payload,
        };
        store.submit({ record, retentionKey: id, byteSize: recordByteSize(record) });
      };
      for (const execution of executions.values()) {
        const processes = execution.processes.length;
        submit(
          `execution:${execution.execution.execution}`,
          execution.observedAt,
          {
            takenAtMicros: execution.takenAtMicros,
            completeness: execution.completeness,
            processes,
            cores: cores(execution.cpu),
            bytes: bytes(execution.memory),
          },
          {
            _tag: 'Execution',
            execution: execution.execution,
            takenAtMicros: execution.takenAtMicros,
            completeness: execution.completeness,
            cpuMicros: execution.processes.reduce((sum, row) => sum + row.cpuMicros, 0),
            cpu: execution.cpu,
            memory: execution.memory,
            processes,
          },
        );
      }
      const rateOf = (value: number | null): UsageRate =>
        value === null || reading.overMicros === 0
          ? { _tag: 'Unknown', reason: 'first-sample', detail: 'one cumulative counter is not a rate' }
          : {
              _tag: 'Measured',
              cores: value,
              overMicros: reading.overMicros,
              population: { matched: 1, born: 0, departed: 0 },
              completeness: 'complete',
              gaps: [],
            };
      const installation = reading.groups.filter((group) => group.owner._tag === 'Installation' || group.owner._tag === 'Part');
      if (installation.length > 0) {
        const unread = installation.reduce((sum, group) => sum + group.unread, 0);
        const processes = installation.reduce((sum, group) => sum + group.processes.length, 0);
        const completeness = unread > 0 ? 'partial' : 'complete';
        const cpu = rateOf(installation.reduce((sum, group) => sum + group.cores, 0));
        const memory: UsageMemory = {
          _tag: 'ResidentSum',
          bytes: installation.reduce((sum, group) => sum + group.memoryBytes, 0),
          processes,
        };
        submit(
          'installation',
          reading.observedAt,
          {
            takenAtMicros: reading.takenAtMicros,
            completeness,
            processes,
            cores: cores(cpu),
            bytes: bytes(memory),
          },
          {
            _tag: 'Installation',
            takenAtMicros: reading.takenAtMicros,
            completeness,
            cpuMicros: 0,
            cpu,
            memory,
            processes,
          },
        );
      }
      const busy = rateOf(reading.cpu);
      const completeness = reading.unread === undefined ? 'complete' : 'partial';
      submit(
        'machine',
        reading.observedAt,
        {
          takenAtMicros: reading.takenAtMicros,
          completeness,
          processes: reading.cores,
          cores: cores(busy),
          bytes: reading.memory._tag === 'Measured' ? reading.memory.usedBytes : undefined,
        },
        {
          _tag: 'Machine',
          cores: reading.cores,
          takenAtMicros: reading.takenAtMicros,
          completeness,
          busy,
        },
      );
      recorded = kept;
    }).pipe(Effect.withTracerEnabled(false));
  return { reset, record };
});
