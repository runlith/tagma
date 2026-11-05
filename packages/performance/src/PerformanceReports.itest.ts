import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import * as Scope from 'effect/Scope';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scratchDirectory } from './testing/scratchDirectory.js';
import { localStorePreparationLayer } from './testing/worker.js';
import type { CommandClass } from '@runlith/executions/protocol/command';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { type LoadPayload, type StoredProfileRecord } from './protocol/records.js';
import { type BreakdownCursor, type NamesCursor, type TimeCursor, performanceQuerySchema } from './protocol/queries.js';
import type { CpuProfileArtifact } from './CpuProfile.js';
import type { StallRecord } from './LoopStalls.js';
import type { MetricSample } from './MetricSnapshots.js';
import {
  type PerformanceRecord,
  PerformanceStoreQueryFailed,
  PerformanceStoreUnavailable,
  recordByteSize,
  type PerformanceStoreOptions,
  type PerformanceSubmission,
} from './store/records.js';
import { PerformanceStore, performanceStoreLayer } from './store/store.js';
import { PerformanceReportMissing, PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';
import { ringRoot, segmentBytesFor } from './SegmentRing.js';
import type { SpanRecord } from './PerformanceTracer.js';
import type { VitalRecord } from './ProcessVitals.js';

const HOUR_MS = 60 * 60 * 1_000;

test('performanceQuerySchema rejects ambiguous or unbounded list inputs', () => {
  const decode = Schema.decodeUnknownResult(performanceQuerySchema);
  expect(decode({ type: 'names' })._tag).toBe('Failure');
  expect(decode({ type: 'names', limit: 1 })._tag).toBe('Success');
  expect(decode({ type: 'names', limit: 1, after: { span: 'operation' } })._tag).toBe('Success');
  expect(decode({ type: 'names', limit: 1, after: { metric: 'operation' } })._tag).toBe('Success');
  expect(decode({ type: 'names', limit: 1, after: { span: 'a', metric: 'b' } })._tag).toBe('Success');
  expect(decode({ type: 'names', limit: 0 })._tag).toBe('Failure');
  expect(decode({ type: 'names', limit: 1, after: { span: '' } })._tag).toBe('Failure');
  expect(decode({ type: 'stalls', limit: 1 })._tag).toBe('Success');
  expect(decode({ type: 'stall', id: 'stall' })._tag).toBe('Success');
  expect(decode({ type: 'stall', id: 'stall', limit: 1, after: { wallTime: 2, id: 'span' } })._tag).toBe('Success');
  expect(decode({ type: 'slow', name: 'operation', limit: 1 })._tag).toBe('Success');
  expect(
    decode({
      type: 'slow',
      name: 'operation',
      limit: 1,
      after: { durationMs: 1, wallTime: 2, id: 'x' },
    })._tag,
  ).toBe('Success');
  expect(decode({ type: 'trace', traceId: 'trace', limit: 1 })._tag).toBe('Success');
  expect(decode({ type: 'trace', traceId: 'trace', limit: 1, spanId: 'span' })._tag).toBe('Success');
  expect(decode({ type: 'vitals', limit: 1 })._tag).toBe('Success');
  expect(decode({ type: 'metrics', name: 'operation', limit: 1 })._tag).toBe('Success');
  expect(decode({ type: 'profiles', limit: 1 })._tag).toBe('Success');
  expect(decode({ type: 'profile', id: 'profile' })._tag).toBe('Success');
  expect(decode({ type: 'profile', id: 'profile', limit: 1, raw: true })._tag).toBe('Success');
  expect(decode({ type: 'load', limit: 1, stepMs: 5_000 })._tag).toBe('Success');
  expect(
    decode({
      type: 'load',
      limit: 1,
      stepMs: 5_000,
      subject: 'Execution',
      execution: { installation: 'inst', execution: 'exec', incarnation: 0 },
      threadId: 'thread',
    })._tag,
  ).toBe('Success');

  for (const invalid of [
    { type: 'stalls', limit: 0 },
    { type: 'slow', name: '', limit: 1 },
    { type: 'metrics', name: '', limit: 1 },
    { type: 'profiles', limit: -1 },
    { type: 'stall', id: '' },
    { type: 'stall', id: 'stall', limit: 0 },
    { type: 'profile', id: '' },
    { type: 'profile', id: 'profile', limit: 0 },
    { type: 'trace', traceId: '', limit: 1 },
    { type: 'trace', traceId: 'trace' },
    { type: 'trace', traceId: 'trace', limit: 0 },
    { type: 'trace', traceId: 'trace', limit: 1, spanId: '' },
    { type: 'breakdown', id: 'parent' },
    { type: 'breakdown', id: '', limit: 1 },
    { type: 'breakdown', id: 'parent', limit: 0 },
    { type: 'breakdown', id: 'parent', limit: 1, after: { coveredMs: 1 } },
    { type: 'breakdown', id: 'parent', limit: 1, after: { coveredMs: Infinity, id: 'child' } },
    { type: 'load', limit: 1 },
    { type: 'load', limit: 1, stepMs: 0 },
    { type: 'load', stepMs: 5_000 },
    { type: 'load', limit: 1, stepMs: 5_000, execution: { installation: 'inst', execution: 'exec' } },
    { type: 'load', limit: 1, stepMs: 5_000, subject: 'Thread' },
  ]) {
    expect(decode(invalid)._tag).toBe('Failure');
  }
});

it.live('a stall names the tool call and the run that covered it, tightest first', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-callers-');
    const path = join(directory, 'performance.sqlite');
    const run = { 'run.id': 'run-1', 'thread.id': 'thread-1' };
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      for (const record of [
        stallRecord('stall', 'process', 100, 1_000, 1_200),
        spanRecord('run', 'process', 50, 0, 100_000, 'trace', null, 'agent.run', run),
        spanRecord('call', 'process', 90, 900, 1_300, 'trace', 'run', 'agent.tool-call', {
          ...run,
          'tool.name': 'submit_work',
          'tool.call.id': 'call-1',
        }),
        spanRecord('sql', 'process', 95, 950, 1_250, 'other', null, 'sql.execute'),
      ]) {
        store.submit(submission(record, 'window'));
      }
      yield* store.flush;

      const stalls = yield* reports.read({ type: 'stalls', limit: 10 });
      if (stalls.type !== 'stalls') return yield* Effect.die('unexpected report');
      expect(stalls.stalls[0]?.caller).toEqual({
        name: 'agent.tool-call',
        runId: 'run-1',
        threadId: 'thread-1',
        toolName: 'submit_work',
        toolCallId: 'call-1',
        coveredMs: 200,
        durationMs: 400,
      });

      const stall = yield* reports.read({ type: 'stall', id: 'stall' });
      if (stall.type !== 'stall') return yield* Effect.die('unexpected report');
      expect(stall.callers.map((caller) => caller.name)).toEqual(['agent.tool-call', 'agent.run']);
      expect(stall.callers.map((caller) => caller.coveredMs)).toEqual([200, 200]);
      expect(stall.overlap.map((row) => row.name)).toContain('sql.execute');
    }).pipe(Effect.provide(performanceLayer(storeOptions(path))));
  }),
);

it.live('a stall names a frame only where the sampler saw the loop busy for it, and always says how much it saw', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-sampling-');
    const path = join(directory, 'performance.sqlite');
    const busy = Array.from({ length: 400 }, () => 1);
    const later = Array.from({ length: 111 }, () => 3);
    const artifact: CpuProfileArtifact = {
      nodes: [
        { id: 1, callFrame: { functionName: 'spawn', url: 'file:///Git.ts', lineNumber: 40 } },
        { id: 2, callFrame: { functionName: '', url: 'file:///CheckoutBaselines.ts', lineNumber: 319 } },
        { id: 3, callFrame: { functionName: 'later', url: 'file:///later.ts', lineNumber: 1 } },
      ],
      startTime: 0,
      endTime: 1_000_000,
      samples: [...busy, 2, ...later],
      timeDeltas: [...busy.map(() => 1_000), 489_000, ...later.map(() => 1_000)],
    };
    const lone: CpuProfileArtifact = { ...artifact, endTime: 500_000, samples: [2], timeDeltas: [489_000] };
    const profiled = (id: string, monotonicStart: number, monotonicEnd: number, profileId = 'profile'): StallRecord => {
      const stall = stallRecord(id, 'process', 100, monotonicStart, monotonicEnd);
      return { ...stall, payload: { ...stall.payload, profileId } };
    };
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      for (const record of [
        { ...profileRecord('profile', 'process', 0, artifact), monotonicStart: 0, monotonicEnd: 1_000 },
        { ...profileRecord('lone', 'process', 0, lone), monotonicStart: 2_000, monotonicEnd: 2_500 },
        profiled('busy', 100, 399.5),
        profiled('gap', 400.5, 889.5),
        profiled('after-idle', 2_000, 2_500, 'lone'),
      ]) {
        store.submit(submission(record, 'window'));
      }
      yield* store.flush;

      for (const id of ['gap', 'after-idle']) {
        const read = yield* reports.read({ type: 'stall', id });
        if (read.type !== 'stall') return yield* Effect.die('unexpected report');
        expect(read.sampling).toEqual({ samples: 1, sampledMs: 0, frame: null });
      }

      const stalls = yield* reports.read({ type: 'stalls', limit: 10 });
      if (stalls.type !== 'stalls') return yield* Effect.die('unexpected report');
      expect(stalls.stalls.find((reading) => reading.stall.id === 'busy')?.sampling).toEqual({
        samples: 300,
        sampledMs: 299,
        frame: { functionName: 'spawn', url: 'file:///Git.ts', lineNumber: 40, selfMs: 299, samples: 300 },
      });
    }).pipe(Effect.provide(performanceLayer(storeOptions(path))));
  }),
);

it.live('a stall page larger than one SQL expression tree still names each stall its own caller', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-wide-callers-');
    const path = join(directory, 'performance.sqlite');
    const count = 1_200;
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      for (let index = 0; index < count; index += 1) {
        store.submit(submission(stallRecord(`stall-${index}`, 'process', 100 + index, index * 100, index * 100 + 10), 'window'));
        store.submit(
          submission(
            spanRecord(
              `call-${index}`,
              'process',
              100 + index,
              index * 100 + 5,
              index * 100 + 50,
              `trace-${index}`,
              null,
              `call-${index}`,
              {
                'run.id': `run-${index}`,
              },
            ),
            'window',
          ),
        );
      }
      yield* store.flush;

      const page = yield* reports.read({ type: 'stalls', since: 100, limit: count });
      if (page.type !== 'stalls') return yield* Effect.die('unexpected report');
      expect(page.stalls).toHaveLength(count);
      expect(page.stalls.map((reading) => reading.caller?.runId)).toEqual(Array.from({ length: count }, (_, index) => `run-${index}`));
    }).pipe(Effect.provide(performanceLayer(storeOptions(path))));
  }),
);

it.live('commands fold by class, and a cost nobody could read is counted apart from the totals', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-commands-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      for (const record of [
        commandRecord('test-a', 100, 0, 100, { class: 'test', cpuMicros: 80_000, peakRssBytes: 2_000_000 }),
        commandRecord('test-b', 101, 0, 40, { class: 'test', cpuMicros: 5_000, exitCode: 1 }),
        commandRecord('typecheck-a', 102, 0, 500, { class: 'typecheck' }),
        commandRecord('git-a', 103, 0, 10, { class: 'git', cpuMicros: 1_000 }),
      ]) {
        store.submit(submission(record));
      }
      yield* store.flush;

      const answer = yield* reports.read({ type: 'commands', since: 100, limit: 10 });
      if (answer.type !== 'commands') return yield* Effect.die('unexpected report');
      expect(answer.classes.map((reading) => reading.class)).toEqual(['test', 'git', 'typecheck']);

      const tests = answer.classes[0]!;
      expect(tests.count).toBe(2);
      expect(tests.failures).toBe(1);
      expect(tests.wallMs).toBe(140);
      expect(tests.maxWallMs).toBe(100);
      expect(tests.cpuMicros).toBe(85_000);
      expect(tests.maxPeakRssBytes).toBe(2_000_000);
      expect(tests.unmeasured).toBe(0);

      const typechecks = answer.classes.find((reading) => reading.class === 'typecheck')!;
      expect(typechecks.count).toBe(1);
      expect(typechecks.unmeasured).toBe(1);
      expect(typechecks.cpuMicros).toBe(0);
      expect(typechecks.wallMs).toBe(500);

      expect(answer.evidence).toBe('retained-only');
      expect(answer.commands.map((record) => record.id)).toEqual(['test-a', 'test-b', 'typecheck-a', 'git-a']);

      const empty = yield* reports.read({ type: 'commands', since: 10_000, limit: 10 });
      if (empty.type !== 'commands') return yield* Effect.die('unexpected report');
      expect(empty.classes).toEqual([]);
      expect(empty.next).toBeNull();
    }).pipe(Effect.provide(performanceLayer(storeOptions(path))));
  }),
);

it.live('load folds into aligned buckets per subject, integrates the counter and keeps unmeasured rates out of the mean', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-load-');
    const path = join(directory, 'performance.sqlite');
    const command = executionRef('exec-1');
    const shrinking = executionRef('exec-2');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      for (let second = 0; second < 30; second += 1) {
        store.submit(
          submission(
            executionLoad(`cmd-${second}`, second * 1_000, {
              execution: command,
              threadId: 'thread-a',
              cores: second === 12 ? undefined : 1,
              residentBytes: second === 7 ? 200_000_000 : 100_000_000,
              cpuMicros: second * 1_000_000,
            }),
          ),
        );
      }
      for (const [index, cpuMicros] of [5_000_000, 8_000_000, 3_000_000].entries()) {
        store.submit(
          submission(
            executionLoad(`shrink-${index}`, index * 1_000 + 500, {
              execution: shrinking,
              cores: 1,
              residentBytes: 50_000_000,
              cpuMicros,
            }),
          ),
        );
      }
      store.submit(submission(installationLoad('inst-0', 200, { cores: 2, cpuMicros: 0 })));
      store.submit(submission(installationLoad('inst-1', 5_200, { cores: 2, cpuMicros: 2_000_000 })));
      for (const [index, busy] of [4, 6, 2].entries()) {
        store.submit(submission(machineLoad(`machine-${index}`, index * 5_000 + 300, busy)));
      }
      yield* store.flush;

      const answer = yield* reports.read({ type: 'load', limit: 200, stepMs: 5_000 });
      if (answer.type !== 'load') return yield* Effect.die('unexpected report');
      expect(answer.stepMs).toBe(5_000);
      expect(answer.evidence).toBe('retained-only');
      expect(answer.subjects.map((series) => series.subject._tag)).toEqual(['Execution', 'Execution', 'Installation', 'Machine']);

      const series = answer.subjects[0]!;
      if (series.subject._tag !== 'Execution') return yield* Effect.die('unexpected subject');
      expect(series.subject.execution).toEqual(command);
      expect(series.subject.threadId).toBe('thread-a');
      expect(series.readings).toBe(30);
      expect(series.buckets.length).toBe(6);
      expect(series.buckets.map((bucket) => bucket.startedAt)).toEqual([0, 5_000, 10_000, 15_000, 20_000, 25_000]);
      expect(series.maxCores).toBe(1);
      expect(series.cpuSeconds).toBe(29);
      expect(series.counterBreaks).toBe(0);
      for (const bucket of series.buckets) {
        expect(bucket.readings).toBe(5);
        expect(bucket.meanCores).toBe(1);
        expect(bucket.maxCores).toBe(1);
      }
      expect(series.buckets[0]!.cpuSeconds).toBe(4);
      expect(series.buckets[1]!.cpuSeconds).toBe(5);
      expect(series.buckets[1]!.maxResidentBytes).toBe(200_000_000);
      expect(series.buckets[0]!.maxResidentBytes).toBe(100_000_000);
      const unrated = series.buckets[2]!;
      expect(unrated.unmeasuredCpu).toBe(1);
      expect(unrated.meanCores).toBe(1);
      expect(unrated.cpuSeconds).toBe(5);

      const fell = answer.subjects[1]!;
      if (fell.subject._tag !== 'Execution') return yield* Effect.die('unexpected subject');
      expect(fell.subject.execution).toEqual(shrinking);
      expect(fell.cpuSeconds).toBe(3);
      expect(fell.counterBreaks).toBe(1);

      const machine = answer.subjects[3]!;
      if (machine.subject._tag !== 'Machine') return yield* Effect.die('unexpected subject');
      expect(machine.subject.cores).toBe(12);
      expect(machine.maxCores).toBe(6);
      expect(machine.cpuSeconds).toBeNull();
      expect(machine.buckets[0]!.maxResidentBytes).toBeNull();
      expect(machine.buckets[0]!.unmeasuredMemory).toBe(1);

      const machineOnly = yield* reports.read({ type: 'load', limit: 200, stepMs: 5_000, subject: 'Machine' });
      if (machineOnly.type !== 'load') return yield* Effect.die('unexpected report');
      expect(machineOnly.subjects.map((one) => one.subject._tag)).toEqual(['Machine']);

      const oneCommand = yield* reports.read({ type: 'load', limit: 200, stepMs: 5_000, execution: command });
      if (oneCommand.type !== 'load') return yield* Effect.die('unexpected report');
      expect(oneCommand.subjects.length).toBe(1);
      expect(oneCommand.subjects[0]!.readings).toBe(30);

      const reused = yield* reports.read({
        type: 'load',
        limit: 200,
        stepMs: 5_000,
        execution: executionRef('exec-1', 1),
      });
      if (reused.type !== 'load') return yield* Effect.die('unexpected report');
      expect(reused.subjects).toEqual([]);

      const byThread = yield* reports.read({ type: 'load', limit: 200, stepMs: 5_000, threadId: 'thread-a' });
      if (byThread.type !== 'load') return yield* Effect.die('unexpected report');
      expect(byThread.subjects.length).toBe(1);
    }).pipe(Effect.provide(performanceLayer(storeOptions(path))));
  }),
);

it.live('time and slow cursors preserve ties and since is inclusive', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-cursors-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      for (const record of [
        stallRecord('stall-b', 'process', 100, 10, 20),
        stallRecord('stall-a', 'process', 100, 10, 20),
        stallRecord('stall-c', 'process', 100, 10, 20),
        vitalRecord('vital', 'process', 100, 0, 100),
        spanRecord('slow-long', 'process', 90, 0, 20, 'slow-trace', null, 'operation'),
        spanRecord('slow-a', 'process', 100, 0, 10, 'slow-trace', null, 'operation'),
        spanRecord('slow-b', 'process', 100, 0, 10, 'slow-trace', null, 'operation'),
        profileRecord('profile-a', 'process', 100),
        profileRecord('profile-b', 'process', 100),
      ]) {
        store.submit(submission(record));
      }
      yield* store.flush;

      const firstStalls = yield* reports.read({ type: 'stalls', since: 100, limit: 2 });
      if (firstStalls.type !== 'stalls') return yield* Effect.die('unexpected report');
      expect(firstStalls.stalls.map((reading) => reading.stall.id)).toEqual(['stall-a', 'stall-b']);
      expect(firstStalls.next).toEqual({ wallTime: 100, id: 'stall-b' });
      const lastStalls = yield* reports.read({ type: 'stalls', since: 100, limit: 2, after: firstStalls.next! });
      if (lastStalls.type !== 'stalls') return yield* Effect.die('unexpected report');
      expect(lastStalls.stalls.map((reading) => reading.stall.id)).toEqual(['stall-c']);
      expect(lastStalls.next).toBeNull();
      expect(firstStalls.retainedRange).toEqual({ from: 90, to: 100 });

      const names = yield* reports.read({ type: 'names', limit: 20 });
      if (names.type !== 'names') return yield* Effect.die('unexpected report');
      expect(names.spanNames).toEqual(['operation']);
      expect(names.metricNames).toEqual([]);

      const firstSlow = yield* reports.read({ type: 'slow', name: 'operation', limit: 2 });
      if (firstSlow.type !== 'slow') return yield* Effect.die('unexpected report');
      expect(firstSlow.spans.map((record) => record.id)).toEqual(['slow-long', 'slow-a']);
      expect(firstSlow.next).toEqual({ durationMs: 10, wallTime: 100, id: 'slow-a' });
      const lastSlow = yield* reports.read({ type: 'slow', name: 'operation', limit: 2, after: firstSlow.next! });
      if (lastSlow.type !== 'slow') return yield* Effect.die('unexpected report');
      expect(lastSlow.spans.map((record) => record.id)).toEqual(['slow-b']);

      const vitals = yield* reports.read({ type: 'vitals', since: 100, limit: 1 });
      if (vitals.type !== 'vitals') return yield* Effect.die('unexpected report');
      expect(vitals.vitals.map((record) => record.id)).toEqual(['vital']);

      const firstProfiles = yield* reports.read({ type: 'profiles', since: 100, limit: 1 });
      if (firstProfiles.type !== 'profiles') return yield* Effect.die('unexpected report');
      expect(firstProfiles.profiles.map((record) => record.id)).toEqual(['profile-a']);
      const lastProfiles = yield* reports.read({
        type: 'profiles',
        since: 100,
        limit: 1,
        after: firstProfiles.next!,
      });
      if (lastProfiles.type !== 'profiles') return yield* Effect.die('unexpected report');
      expect(lastProfiles.profiles.map((record) => record.id)).toEqual(['profile-b']);
    }).pipe(Effect.provide(performanceLayer(storeOptions(path))));
  }),
);

it.live('a memory reading attributes both threads, the allocator and the database', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-memory-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.submit(submission(spanRecord('span', 'instance-a', 100, 10, 20, 'trace', null, 'span'), 'trace'));
      yield* store.flush;

      const memory = yield* reports.read({ type: 'memory' });
      if (memory.type !== 'memory') return yield* Effect.die('unexpected report');

      expect(memory.threads.map((thread) => thread.thread)).toEqual(['main', 'store-worker']);
      for (const thread of memory.threads) {
        expect(thread.heap.sizeBytes).toBeGreaterThan(0);
        expect(thread.heap.objectCount).toBeGreaterThan(0);
        expect(thread.process.rssBytes).toBeGreaterThan(0);
        expect(thread.largestTypes.length).toBeGreaterThan(0);
        if (thread.allocator === undefined) continue;
        expect(thread.allocator.reservedBytes).toBeGreaterThan(0);
        expect(thread.allocator.committedPeakBytes).toBeGreaterThanOrEqual(thread.allocator.committedBytes);
      }

      expect(memory.store.pendingRecords).toBe(0);
      expect(memory.store.pendingBytes).toBe(0);
      expect(memory.database.path).toBe(ringRoot(path));
      expect(memory.database.pageBytes).toBeGreaterThan(0);
      expect(memory.database.pageCount).toBeGreaterThan(0);
      expect(memory.database.logBytes).toBeGreaterThan(0);
      expect(memory.database.fileBytes + memory.database.logBytes).toBeGreaterThanOrEqual(
        memory.database.pageBytes * memory.database.pageCount,
      );
    }).pipe(Effect.provide(threadedLayer(storeOptions(path))));
  }),
);

it.live('a trace answers one page of its forest, with the total and the way down', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-trace-page-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      const records = [
        spanRecord('root', 'instance-a', 100, 10, 90, 'run', null, 'agent.run'),
        spanRecord('doctor', 'instance-a', 110, 20, 80, 'run', 'root', 'Doctor.run'),
        spanRecord('scan', 'instance-a', 120, 30, 70, 'run', 'doctor', 'Doctor.scan'),
        spanRecord('gauges', 'instance-a', 130, 40, 60, 'run', 'scan', 'Doctor.gauges'),
        spanRecord('elsewhere', 'instance-a', 140, 50, 55, 'run', 'root', 'Live.publish'),
      ];
      for (const record of records) store.submit(submission(record, record.traceId ?? record.id));
      yield* store.flush;

      const first = yield* reports.read({ type: 'trace', traceId: 'run', limit: 2 });
      if (first.type !== 'trace') return yield* Effect.die('unexpected report');
      expect(first.segments.flatMap((segment) => segment.spans).map((span) => span.id)).toEqual(['root', 'doctor']);
      expect(first.totalSpans).toBe(5);
      expect(first.next).toEqual({ instanceId: 'instance-a', monotonicStart: 20, id: 'doctor' });

      const second = yield* reports.read({
        type: 'trace',
        traceId: 'run',
        limit: 2,
        after: first.next ?? undefined,
      });
      if (second.type !== 'trace') return yield* Effect.die('unexpected report');
      expect(second.segments.flatMap((segment) => segment.spans).map((span) => span.id)).toEqual(['scan', 'gauges']);
      expect(second.next).not.toBeNull();

      const under = yield* reports.read({ type: 'trace', traceId: 'run', spanId: 'doctor', limit: 10 });
      if (under.type !== 'trace') return yield* Effect.die('unexpected report');
      expect(under.segments.flatMap((segment) => segment.spans).map((span) => span.id)).toEqual(['doctor', 'scan', 'gauges']);
      expect(under.totalSpans).toBe(3);
      expect(under.next).toBeNull();
      expect(under.segments[0]?.rootIds).toEqual(['doctor']);
    }).pipe(Effect.provide(performanceLayer(storeOptions(path))));
  }),
);

it.live('breakdown unions retained direct children inside their parent and pages by covered elapsed time', () =>
  Effect.gen(function* () {
    const store = yield* PerformanceStore;
    const reports = yield* PerformanceReports;
    const records = [
      spanRecord('root', 'process', 100, 10, 110, 'trace', null, 'request'),
      spanRecord('a', 'process', 100, 0, 50, 'trace', 'root', 'first'),
      spanRecord('b', 'process', 100, 20, 30, 'trace', 'root', 'nested'),
      spanRecord('c', 'process', 100, 40, 70, 'trace', 'root', 'overlap'),
      spanRecord('d', 'process', 100, 80, 120, 'trace', 'root', 'tail'),
      spanRecord('e', 'process', 100, 120, 130, 'trace', 'root', 'outside'),
      spanRecord('z', 'process', 100, 100, 100, 'trace', 'root', 'point'),
      spanRecord('grandchild', 'process', 100, 15, 110, 'trace', 'b', 'descendant'),
      spanRecord('foreign-process', 'other', 100, 0, 200, 'trace', 'root', 'foreign'),
      spanRecord('foreign-trace', 'process', 100, 0, 200, 'other', 'root', 'foreign'),
      spanRecord('zero', 'process', 100, 200, 200, 'trace', null, 'zero'),
      spanRecord('zero-child', 'process', 100, 190, 210, 'trace', 'zero', 'surrounding'),
      spanRecord('bad-parent', 'process', 100, 0, 100, 'bad', null, 'bad-parent'),
      spanRecord('valid-child', 'process', 100, 0, 100, 'bad', 'bad-parent', 'valid'),
      spanRecord('bad-child', 'process', 100, 90, 10, 'bad', 'bad-parent', 'inverted'),
      profileRecord('non-span', 'process', 100),
    ];
    for (const record of records) store.submit(submission(record, 'fixture'));
    yield* store.flush;

    const ids: string[] = [];
    let after: BreakdownCursor | undefined;
    do {
      const page = yield* reports.read({ type: 'breakdown', id: 'root', limit: 2, after });
      if (page.type !== 'breakdown') return yield* Effect.die('unexpected report');
      expect(page.span).toEqual({
        id: 'root',
        instanceId: 'process',
        wallTime: 100,
        monotonicStart: 10,
        monotonicEnd: 110,
        traceId: 'trace',
        parentId: null,
        name: 'request',
        durationMs: 100,
      });
      expect({ covered: page.coveredMs, self: page.selfMs, count: page.totalChildren, evidence: page.evidence }).toEqual({
        covered: 90,
        self: 10,
        count: 6,
        evidence: 'retained-only',
      });
      expect(page.children).toHaveLength(2);
      if (after === undefined) {
        expect(page.children.map((child) => [child.id, child.coveredMs, child.durationMs])).toEqual([
          ['a', 40, 50],
          ['c', 30, 30],
        ]);
        expect(page.next).toEqual({ coveredMs: 30, id: 'c' });
      }
      ids.push(...page.children.map((child) => child.id));
      after = page.next ?? undefined;
    } while (after !== undefined);
    expect(ids).toEqual(['a', 'c', 'd', 'b', 'e', 'z']);

    for (const [id, duration, count] of [
      ['c', 30, 0],
      ['zero', 0, 1],
    ] as const) {
      const leaf = yield* reports.read({ type: 'breakdown', id, limit: 2 });
      if (leaf.type !== 'breakdown') return yield* Effect.die('unexpected report');
      expect([leaf.span.durationMs, leaf.coveredMs, leaf.selfMs, leaf.totalChildren, leaf.next]).toEqual([
        duration,
        0,
        duration,
        count,
        null,
      ]);
    }
    for (const id of ['missing', 'non-span']) {
      const missing = yield* Effect.flip(reports.read({ type: 'breakdown', id, limit: 1 }));
      expect(missing).toBeInstanceOf(PerformanceReportMissing);
      if (missing instanceof PerformanceReportMissing) {
        expect(missing.query).toEqual({ type: 'breakdown', id, limit: 1 });
        expect(missing.retainedRange).toEqual({ from: 100, to: 100 });
      }
    }
    const corrupt = yield* Effect.flip(reports.read({ type: 'breakdown', id: 'bad-parent', limit: 1 }));
    expect(corrupt).toBeInstanceOf(PerformanceStoreQueryFailed);
    expect(store.diagnostics().state).toBe('ready');
  }).pipe(Effect.provide(performanceLayer(storeOptions(':memory:')))),
);

it.live('breakdown keeps a wide parent bounded and preserves phase totals across every cursor', () =>
  Effect.gen(function* () {
    const store = yield* PerformanceStore;
    const reports = yield* PerformanceReports;
    store.submit(submission(spanRecord('send', 'process', 1, 0, 1423, 'send', null, 'send')));
    const phases = [
      ['replay', 0, 357],
      ['accept', 357, 363],
      ['freeze', 363, 1421],
    ] as const;
    for (const [id, start, end] of phases) {
      store.submit(submission(spanRecord(id, 'process', 1, start, end, 'send', 'send', id)));
    }
    store.submit(submission(spanRecord('wide', 'process', 1, 0, 100, 'wide', null, 'wide')));
    const expected = Array.from({ length: 257 }, (_, index) => `child-${String(index).padStart(3, '0')}`);
    for (const id of expected) {
      store.submit(submission(spanRecord(id, 'process', 1, 10, 20, 'wide', 'wide', 'child', { evidence: 'x'.repeat(1000) })));
    }
    yield* store.flush;
    const send = yield* reports.read({ type: 'breakdown', id: 'send', limit: 3 });
    if (send.type !== 'breakdown') return yield* Effect.die('unexpected report');
    expect(send.children.map((child) => [child.name, child.durationMs])).toEqual([
      ['freeze', 1058],
      ['replay', 357],
      ['accept', 6],
    ]);
    expect([send.span.durationMs, send.coveredMs, send.selfMs]).toEqual([1423, 1421, 2]);

    const ids: string[] = [];
    let after: BreakdownCursor | undefined;
    do {
      const page = yield* reports.read({ type: 'breakdown', id: 'wide', limit: 17, after });
      if (page.type !== 'breakdown') return yield* Effect.die('unexpected report');
      expect(page.children.length).toBeLessThanOrEqual(17);
      expect([page.totalChildren, page.coveredMs, page.selfMs]).toEqual([257, 10, 90]);
      ids.push(...page.children.map((child) => child.id));
      after = page.next ?? undefined;
    } while (after !== undefined);
    expect(ids).toEqual(expected);
  }).pipe(Effect.provide(performanceLayer(storeOptions(':memory:')))),
);

it.live('breakdown never turns an evicted child into complete exclusive time', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-breakdown-evicted-');
    const path = join(directory, 'performance.sqlite');
    const maxStoredBytes = 700_000;
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.openGroup('child');
      store.submit(submission(spanRecord('child', 'process', 1, 10, 90, 'trace', 'parent', 'child'), 'child'));
      yield* store.flush;
      yield* fillToRoll(path, 'breakdown-roll');
      store.submit(submission(spanRecord('parent', 'process', 2, 0, 100, 'trace', null, 'parent'), 'parent'));
      yield* store.flush;

      const before = yield* reports.read({ type: 'breakdown', id: 'parent', limit: 1 });
      if (before.type !== 'breakdown') return yield* Effect.die('unexpected report');
      expect([before.coveredMs, before.selfMs, before.totalChildren, before.evidence]).toEqual([80, 20, 1, 'retained-only']);

      store.closeGroup('child');
      yield* waitUntil(
        'the file holding the child unlinked',
        Effect.gen(function* () {
          const page = yield* reports.read({ type: 'breakdown', id: 'parent', limit: 1 });
          if (page.type !== 'breakdown') return yield* Effect.die('unexpected report');
          return page.totalChildren === 0;
        }),
      );
      const after = yield* reports.read({ type: 'breakdown', id: 'parent', limit: 1 });
      if (after.type !== 'breakdown') return yield* Effect.die('unexpected report');
      expect([after.coveredMs, after.selfMs, after.totalChildren, after.evidence]).toEqual([0, 100, 0, 'retained-only']);
      expect(after.children).toEqual([]);
    }).pipe(
      Effect.provide(
        performanceLayer({
          path,
          instanceId: 'process',
          maxPendingBytes: () => 4_000_000,
          maxStoredBytes: () => maxStoredBytes,
          maintainIntervalMs: 20,
        }),
      ),
    );
  }),
);

it.live('trace forests and stall overlap stay inside one process instance', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-correlation-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      const records: ReadonlyArray<SpanRecord | StallRecord | VitalRecord> = [
        spanRecord('child', 'instance-a', 110, 20, 25, 'trace', 'parent', 'child'),
        spanRecord('parent', 'instance-a', 100, 10, 30, 'trace', null, 'parent'),
        spanRecord('external-child', 'instance-a', 120, 40, 50, 'trace', 'external', 'external-child'),
        spanRecord('other-process', 'instance-b', 50, 5, 15, 'trace', 'parent', 'other-process'),
        stallRecord('stall', 'instance-a', 200, 20, 30),
        spanRecord('ends-at-start', 'instance-a', 200, 10, 20, 'overlap', null, 'ends-at-start'),
        spanRecord('starts-at-end', 'instance-a', 200, 30, 40, 'overlap', null, 'starts-at-end'),
        spanRecord('outside', 'instance-a', 200, 10, 19, 'overlap', null, 'outside'),
        spanRecord('wrong-instance', 'instance-b', 200, 20, 30, 'overlap', null, 'wrong-instance'),
        vitalRecord('vital-overlap', 'instance-a', 200, 0, 20),
        vitalRecord('vital-wrong-instance', 'instance-b', 200, 20, 30),
      ];
      for (const record of records) store.submit(submission(record, record.traceId ?? record.id));
      yield* store.flush;

      const trace = yield* reports.read({ type: 'trace', traceId: 'trace', limit: 100 });
      if (trace.type !== 'trace') return yield* Effect.die('unexpected report');
      expect(trace.segments.map((segment) => segment.instanceId)).toEqual(['instance-b', 'instance-a']);
      expect(trace.segments[0]?.rootIds).toEqual(['other-process']);
      expect(trace.segments[1]?.spans.map((span) => span.id)).toEqual(['parent', 'child', 'external-child']);
      expect(trace.segments[1]?.rootIds).toEqual(['parent', 'external-child']);

      expect(trace.totalSpans).toBe(4);
      expect(trace.next).toBeNull();

      const stall = yield* reports.read({ type: 'stall', id: 'stall', limit: 100 });
      if (stall.type !== 'stall') return yield* Effect.die('unexpected report');
      expect(stall.spans.map((span) => span.id)).toEqual(['parent', 'child', 'ends-at-start', 'starts-at-end']);
      expect(stall.overlap).toEqual([
        { name: 'parent', count: 1, totalMs: 20, maxMs: 20 },
        { name: 'ends-at-start', count: 1, totalMs: 10, maxMs: 10 },
        { name: 'starts-at-end', count: 1, totalMs: 10, maxMs: 10 },
        { name: 'child', count: 1, totalMs: 5, maxMs: 5 },
      ]);
      expect(stall.next).toBeNull();
      expect(stall.vitals.map((vital) => vital.id)).toEqual(['vital-overlap']);
    }).pipe(Effect.provide(performanceLayer(storeOptions(path))));
  }),
);

it.live('a stall folds every overlapping span and pages raw evidence only when asked', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-stall-fold-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.submit(submission(stallRecord('stall', 'process', 100, 0, 20), 'window'));
      for (let index = 0; index < 1_000; index += 1) {
        const id = `same-${String(index).padStart(4, '0')}`;
        store.submit(submission(spanRecord(id, 'process', 200 + index, 1, 6, id, null, 'same'), 'window'));
      }
      for (let index = 0; index < 3; index += 1) {
        const id = `other-${index}`;
        store.submit(submission(spanRecord(id, 'process', 1_200 + index, 2, 12, id, null, 'other'), 'window'));
      }
      yield* store.flush;

      const folded = yield* reports.read({ type: 'stall', id: 'stall' });
      if (folded.type !== 'stall') return yield* Effect.die('unexpected report');
      expect(folded.overlap).toEqual([
        { name: 'same', count: 1_000, totalMs: 5_000, maxMs: 5 },
        { name: 'other', count: 3, totalMs: 30, maxMs: 10 },
      ]);
      expect(folded.spans).toEqual([]);
      expect(folded.next).toBeNull();

      const rawIds: string[] = [];
      let after: TimeCursor | undefined;
      do {
        const page = yield* reports.read({
          type: 'stall',
          id: 'stall',
          limit: 50,
          after,
        });
        if (page.type !== 'stall') return yield* Effect.die('unexpected report');
        rawIds.push(...page.spans.map((span) => span.id));
        expect(page.overlap).toEqual(folded.overlap);
        after = page.next ?? undefined;
      } while (after !== undefined);
      expect(rawIds).toHaveLength(1_003);
      expect(new Set(rawIds).size).toBe(1_003);
    }).pipe(
      Effect.provide(
        performanceLayer({
          path,
          instanceId: 'process',
          maxPendingBytes: () => 2_000_000,
          maxStoredBytes: () => 2_000_000,
        }),
      ),
    );
  }),
);

it.live('metric hours subtract predecessors, expose overflow and page boundary ties', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-metrics-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      const samples: ReadonlyArray<MetricSample> = [
        metricRecord('window-1', 'window-instance', 1_000, 'window', [10, 20], [1, 0, 0], 0, 5),
        metricRecord('window-2', 'window-instance', 2_000, 'window', [10, 20], [1, 1, 0], 1, 20),
        metricRecord('window-3', 'window-instance', 3_000, 'window', [10, 20], [1, 1, 1], 1, 50),
        metricRecord('cursor-a1', 'cursor-a', 4_000, 'cursor', [10], [1, 0], 0, 5),
        metricRecord('cursor-a2', 'cursor-a', 5_000, 'cursor', [10], [1, 1], 0, 20),
        metricRecord('cursor-b1', 'cursor-b', 4_000, 'cursor', [20], [1, 0], 0, 5),
        metricRecord('cursor-b2', 'cursor-b', 5_000, 'cursor', [20], [2, 0], 0, 15),
        metricRecord('cross-1', 'cross-instance', HOUR_MS - 1, 'cross', [10], [1, 0], 0, 5),
        metricRecord('cross-2', 'cross-instance', HOUR_MS + 1, 'cross', [10], [1, 1], 0, 20),
        metricRecord('reset-1', 'reset-instance', 6_000, 'reset', [10], [2, 0], 0, 10),
        metricRecord('reset-2', 'reset-instance', 7_000, 'reset', [10], [1, 0], 0, 5),
        metricRecord('reset-3', 'reset-instance', 8_000, 'reset', [10], [1, 1], 0, 20),
        metricRecord('boundary-1', 'boundary-instance', 6_000, 'boundary', [10], [1, 0], 0, 5),
        metricRecord('boundary-2', 'boundary-instance', 7_000, 'boundary', [20], [1, 0], 0, 5),
        metricRecord('boundary-3', 'boundary-instance', 8_000, 'boundary', [20], [2, 0], 0, 15),
      ];
      for (const sample of samples) store.submit(submission(sample));
      yield* store.flush;

      const names = yield* reports.read({ type: 'names', since: 5_500, limit: 20 });
      if (names.type !== 'names') return yield* Effect.die('unexpected report');
      expect(names.metricNames).toEqual(['boundary', 'cross', 'reset']);

      const full = yield* reports.read({ type: 'metrics', name: 'window', since: 0, limit: 10 });
      if (full.type !== 'metrics') return yield* Effect.die('unexpected report');
      expect(full.hours).toHaveLength(1);
      expect(full.hours[0]).toMatchObject({
        count: 2,
        failures: 1,
        sumMs: 45,
        p50: { upperBoundMs: 20 },
        p99: { aboveMs: 20 },
        partial: true,
      });

      const window = yield* reports.read({ type: 'metrics', name: 'window', since: 2_500, limit: 10 });
      if (window.type !== 'metrics') return yield* Effect.die('unexpected report');
      expect(window.hours[0]).toMatchObject({
        count: 1,
        failures: 0,
        sumMs: 30,
        p50: { aboveMs: 20 },
        p99: { aboveMs: 20 },
        partial: true,
      });

      const first = yield* reports.read({ type: 'metrics', name: 'cursor', limit: 1 });
      if (first.type !== 'metrics') return yield* Effect.die('unexpected report');
      expect(first.hours).toHaveLength(1);
      expect(first.next).not.toBeNull();
      const second = yield* reports.read({ type: 'metrics', name: 'cursor', limit: 1, after: first.next! });
      if (second.type !== 'metrics') return yield* Effect.die('unexpected report');
      expect(second.hours).toHaveLength(1);
      expect(second.hours[0]?.boundaryKey).not.toBe(first.hours[0]?.boundaryKey);
      expect(second.next).toBeNull();

      const crossing = yield* reports.read({ type: 'metrics', name: 'cross', limit: 10 });
      const reset = yield* reports.read({ type: 'metrics', name: 'reset', limit: 10 });
      const boundary = yield* reports.read({ type: 'metrics', name: 'boundary', limit: 10 });
      if (crossing.type !== 'metrics' || reset.type !== 'metrics' || boundary.type !== 'metrics') {
        return yield* Effect.die('unexpected report');
      }
      expect(crossing.hours[0]).toMatchObject({ hourStart: HOUR_MS, count: 1, partial: true });
      expect(reset.hours[0]).toMatchObject({ count: 1, partial: true });
      expect(boundary.hours[0]).toMatchObject({ count: 1, partial: true });
    }).pipe(Effect.provide(performanceLayer(storeOptions(path))));
  }),
);

it.live('two snapshots of one instance in the same millisecond keep the order they were taken in', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-metrics-ties-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      const taken = (id: string, monotonic: number, bucketCounts: ReadonlyArray<number>): MetricSample => ({
        ...metricRecord(id, 'tie-instance', 9_000, 'tie', [10], bucketCounts, 0, 5),
        monotonicStart: monotonic,
        monotonicEnd: monotonic,
      });
      store.submit(submission(taken('z-first', 1, [1, 0])));
      store.submit(submission(taken('a-second', 2, [2, 0])));
      yield* store.flush;

      const report = yield* reports.read({ type: 'metrics', name: 'tie', limit: 10 });
      if (report.type !== 'metrics') return yield* Effect.die('unexpected report');
      expect(report.hours[0]).toMatchObject({ count: 1 });
    }).pipe(Effect.provide(performanceLayer(storeOptions(path))));
  }),
);

it.live('a metric hour subtracts the predecessor the roll left in an older segment', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-metric-roll-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.submit(submission(metricRecord('base', 'process', 1_000, 'rolled', [10], [1, 0], 0, 5)));
      yield* store.flush;
      yield* fillToRoll(path, 'metric-roll');
      store.submit(submission(metricRecord('after', 'process', 2_000, 'rolled', [10], [1, 1], 0, 20)));
      yield* store.flush;
      expect(segmentsOf(path).length).toBeGreaterThan(1);

      const hour = yield* reports.read({ type: 'metrics', name: 'rolled', since: 1_500, limit: 10 });
      if (hour.type !== 'metrics') return yield* Effect.die('unexpected report');
      expect(hour.hours).toHaveLength(1);
      expect(hour.hours[0]).toMatchObject({ count: 1, sumMs: 15, partial: true });
    }).pipe(Effect.provide(performanceLayer(rollingOptions(path))));
  }),
);

it.live('the slow page reaches back into older segments as its cursor descends', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-slow-roll-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      store.submit(submission(spanRecord('short-a', 'process', 1, 0, 1, 'slow', null, 'measured')));
      store.submit(submission(spanRecord('short-b', 'process', 2, 0, 2, 'slow', null, 'measured')));
      yield* store.flush;
      yield* fillToRoll(path, 'slow-roll');
      store.submit(submission(spanRecord('long-a', 'process', 1_000, 0, 30, 'slow', null, 'measured')));
      store.submit(submission(spanRecord('long-b', 'process', 1_001, 0, 20, 'slow', null, 'measured')));
      yield* store.flush;
      expect(segmentsOf(path).length).toBeGreaterThan(1);

      const first = yield* reports.read({ type: 'slow', name: 'measured', limit: 2 });
      if (first.type !== 'slow') return yield* Effect.die('unexpected report');
      expect(first.spans.map((span) => span.id)).toEqual(['long-a', 'long-b']);
      expect(first.next).not.toBeNull();
      expect(first.next!.wallTime).toBeGreaterThan(2);

      const second = yield* reports.read({ type: 'slow', name: 'measured', limit: 2, after: first.next! });
      if (second.type !== 'slow') return yield* Effect.die('unexpected report');
      expect(second.spans.map((span) => span.id)).toEqual(['short-b', 'short-a']);
      expect(second.next).toBeNull();
    }).pipe(Effect.provide(performanceLayer(rollingOptions(path))));
  }),
);

it.live('profile point reads rank merged frames, gate the raw artifact and keep typed not-found', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-profile-');
    const path = join(directory, 'performance.sqlite');
    let maxStoredBytes = 1_000_000;
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      const record = profileRecord('profile', 'process', 100, {
        nodes: [
          {
            id: 1,
            callFrame: { functionName: '(root)', url: '', lineNumber: -1 },
            children: [2, 3],
          },
          {
            id: 2,
            callFrame: { functionName: 'work', url: 'file:///work.ts', lineNumber: 10 },
            children: [4],
          },
          {
            id: 3,
            callFrame: { functionName: 'work', url: 'file:///work.ts', lineNumber: 10 },
            children: [4],
          },
          {
            id: 4,
            callFrame: { functionName: 'shared', url: 'file:///shared.ts', lineNumber: 20 },
          },
        ],
        startTime: 100,
        endTime: 125,
        samples: [2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 4, 4, 4, 4, 4],
        timeDeltas: Array.from({ length: 15 }, () => 1_000),
      });
      store.submit(submission(record));
      yield* store.flush;

      const list = yield* reports.read({ type: 'profiles', limit: 10 });
      const point = yield* reports.read({ type: 'profile', id: 'profile' });
      const raw = yield* reports.read({ type: 'profile', id: 'profile', raw: true });
      if (list.type !== 'profiles' || point.type !== 'profile' || raw.type !== 'profile') {
        return yield* Effect.die('unexpected report');
      }
      expect(list.profiles).toEqual([
        {
          id: 'profile',
          instanceId: 'process',
          wallTime: 100,
          monotonicStart: 100,
          monotonicEnd: 125,
          requestedBy: 'operator',
          requestedDurationMs: 25,
        },
      ]);
      expect(point.profile).toEqual({
        ...record,
        payload: { requestedBy: 'operator', requestedDurationMs: 25 },
      });
      expect(point.frames).toEqual([
        {
          functionName: 'work',
          url: 'file:///work.ts',
          lineNumber: 10,
          selfMs: 10,
          totalMs: 20,
          samples: 10,
        },
        {
          functionName: 'shared',
          url: 'file:///shared.ts',
          lineNumber: 20,
          selfMs: 5,
          totalMs: 5,
          samples: 5,
        },
        { functionName: '(root)', url: '', lineNumber: -1, selfMs: 0, totalMs: 15, samples: 0 },
      ]);
      expect(raw.profile).toEqual(record);
      expect(raw.frames).toEqual(point.frames);

      const top = yield* reports.read({ type: 'profile', id: 'profile', limit: 1 });
      if (top.type !== 'profile') return yield* Effect.die('unexpected report');
      expect(top.frames).toEqual([point.frames[0]!]);

      const missing = yield* Effect.flip(reports.read({ type: 'profile', id: 'never-written' }));
      expect(missing).toBeInstanceOf(PerformanceReportMissing);
      if (!(missing instanceof PerformanceReportMissing)) return;
      expect(missing.query).toEqual({ type: 'profile', id: 'never-written' });
      expect(missing.inheritedDrops).toBe(0);
      expect(missing.sessionDrops).toBe(0);
      expect(missing.retainedRange).toEqual({ from: 100, to: 100 });
    }).pipe(Effect.provide(performanceLayer(storeOptions(path))));
  }),
);

it.live('each corrupt persisted payload fails only its report and names the record', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-corrupt-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      for (const record of [
        spanRecord('corrupt-span', 'process', 1, 0, 1, 'corrupt-trace', null, 'corrupt-span'),
        stallRecord('corrupt-stall', 'process', 2, 0, 1),
        vitalRecord('corrupt-vital', 'process', 3, 0, 1),
        metricRecord('corrupt-metric', 'process', 4, 'corrupt-metric', [10], [1, 0], 0, 5),
        profileRecord('corrupt-profile', 'process', 5),
      ]) {
        store.submit(submission(record, record.kind === 'span' ? record.traceId : record.id));
      }
      yield* store.flush;
    }).pipe(Effect.provide(performanceStoreLayer(storeOptions(path))));

    const database = new Database(newestSegment(path));
    database.exec("update performance_record set payload = '{}' where id like 'corrupt-%' and kind <> 'profile'");
    database.exec(
      `update performance_record
       set payload = '{"requestedBy":"operator","requestedDurationMs":25,"profile":{}}'
       where id = 'corrupt-profile'`,
    );
    database.close();

    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      const profiles = yield* reports.read({ type: 'profiles', limit: 10 });
      if (profiles.type !== 'profiles') return yield* Effect.die('unexpected report');
      expect(profiles.profiles.find((profile) => profile.id === 'corrupt-profile')).toMatchObject({
        requestedBy: 'operator',
        requestedDurationMs: 25,
      });
      const cases = [
        ['corrupt-span', reports.read({ type: 'trace', traceId: 'corrupt-trace', limit: 100 })],
        ['corrupt-stall', reports.read({ type: 'stall', id: 'corrupt-stall' })],
        ['corrupt-vital', reports.read({ type: 'vitals', limit: 10 })],
        ['corrupt-metric', reports.read({ type: 'metrics', name: 'corrupt-metric', limit: 10 })],
        ['corrupt-profile', reports.read({ type: 'profile', id: 'corrupt-profile' })],
      ] as const;
      for (const [recordId, read] of cases) {
        const failure = yield* Effect.flip(read);
        expect(failure).toBeInstanceOf(PerformanceStoreQueryFailed);
        if (failure instanceof PerformanceStoreQueryFailed) expect(failure.message).toContain(recordId);
        expect(store.diagnostics().state).toBe('ready');
      }
    }).pipe(Effect.provide(performanceLayer(storeOptions(path))));
  }),
);

it.live('a reader captured past its store scope becomes unavailable and exposes diagnostics', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-unavailable-');
    const path = join(directory, 'performance.sqlite');
    const opened = yield* Scope.fork(yield* Effect.scope);
    const context = yield* Layer.buildWithScope(performanceLayer(storeOptions(path)), opened);
    const captured = { store: Context.get(context, PerformanceStore), reports: Context.get(context, PerformanceReports) };
    yield* Scope.close(opened, Exit.void);
    const failure = yield* Effect.flip(captured.reports.read({ type: 'vitals', limit: 1 }));
    expect(failure).toBeInstanceOf(PerformanceStoreUnavailable);
    expect(captured.store.diagnostics().state).toBe('unavailable');
  }),
);

it.live('a names page is bounded by names, resumes from its cursor and states what it covers', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-names-page-');
    const path = join(directory, 'performance.sqlite');
    yield* Effect.gen(function* () {
      const store = yield* PerformanceStore;
      const reports = yield* PerformanceReports;
      for (const name of ['alpha', 'beta', 'gamma']) {
        for (let index = 0; index < 4; index += 1) {
          store.submit(submission(spanRecord(`${name}-${index}`, 'process', index, index, index + 1, 'trace', null, name)));
        }
      }
      for (const name of ['m-one', 'm-two']) {
        for (let index = 0; index < 3; index += 1) {
          store.submit(submission(metricRecord(`${name}-${index}`, 'process', index, name, [1], [index, 0], 0, index)));
        }
      }
      yield* store.flush;

      const pages: Array<{ readonly spans: readonly string[]; readonly metrics: readonly string[] }> = [];
      let after: NamesCursor | undefined;
      do {
        const page = yield* reports.read({ type: 'names', limit: 2, after });
        if (page.type !== 'names') return yield* Effect.die('unexpected report');
        expect(page.evidence).toBe('retained-only');
        expect(page.spanNames.length).toBeLessThanOrEqual(2);
        expect(page.metricNames.length).toBeLessThanOrEqual(2);
        pages.push({ spans: page.spanNames, metrics: page.metricNames });
        after = page.next ?? undefined;
      } while (after !== undefined);

      expect(pages[0]).toEqual({ spans: ['alpha', 'beta'], metrics: ['m-one', 'm-two'] });
      expect(pages).toEqual([
        { spans: ['alpha', 'beta'], metrics: ['m-one', 'm-two'] },
        { spans: ['gamma'], metrics: [] },
      ]);
    }).pipe(Effect.provide(performanceLayer(storeOptions(path))));
  }),
);

it.live('SQLite plans every report through a segment index', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-reports-plans-');
    const path = join(directory, 'performance.sqlite');
    yield* PerformanceStore.use((store) =>
      Effect.gen(function* () {
        store.submit(submission(spanRecord('span', 'process', 100, 10, 20, 'trace', null, 'span')));
        yield* store.flush;
      }),
    ).pipe(Effect.provide(performanceLayer(storeOptions(path))));
    const database = new Database(newestSegment(path), { readonly: true });
    const reports = [
      {
        report: 'the window every page is ordered by',
        statement: 'select wall_time from performance_record order by wall_time, id limit 1',
        index: 'performance_record_time_idx',
      },
      {
        report: 'a time page: stalls, vitals, captures, losses, commands, load',
        statement: "select * from performance_record where kind = 'stall' and name is null order by wall_time, id limit 10",
        index: 'performance_record_kind_name_time_idx',
      },
      {
        report: 'a trace forest',
        statement: "select * from performance_record where trace_id = 'trace' and kind = 'span' order by instance_id, monotonic_start, id",
        index: 'performance_record_trace_idx',
      },
      {
        report: "a breakdown's direct children",
        statement:
          "select * from performance_record where trace_id = 'trace' and kind = 'span' and parent_id = 'parent' and instance_id = 'process'",
        index: 'performance_record_trace_idx',
      },
      {
        report: 'what was open across a stall',
        statement:
          "select * from performance_record where kind = 'span' and run_id is not null and instance_id in ('process') and monotonic_start <= 10 and monotonic_end >= 0",
        index: 'performance_record_overlap_idx',
      },
      {
        report: 'the names page',
        statement:
          "select name from performance_record where kind = 'span' and name is not null and name > 'operation' order by name limit 1",
        index: 'performance_record_kind_name_time_idx',
      },
      {
        report: "a metric name's hours, and the baseline before them",
        statement:
          "select * from performance_record where kind = 'metric' and name = 'operation' and wall_time >= 1000 order by wall_time, id limit 10",
        index: 'performance_record_kind_name_time_idx',
      },
      {
        report: 'the slow page of one span name',
        statement:
          "select * from performance_record where kind = 'span' and name = 'operation' order by monotonic_end - monotonic_start desc, wall_time, id limit 10",
        index: 'performance_record_kind_name_time_idx',
      },
      {
        report: 'the overview walk over metric names',
        statement:
          "select id, name, instance_id, wall_time from performance_record where kind = 'metric' and name >= 'operation' and wall_time >= 1000 and wall_time < 2000 order by name, instance_id, wall_time, id limit 200",
        index: 'performance_record_kind_name_time_idx',
      },
    ] as const;

    const planned = reports.map((each) => ({ ...each, detail: plan(database, each.statement) }));
    database.close();
    for (const { report, index, detail } of planned) {
      expect(`${report}: ${detail}`).toContain(index);
      expect(`${report}: ${detail}`).toMatch(/SEARCH|USING COVERING INDEX/);
    }
  }),
);

function performanceLayer(options: PerformanceStoreOptions) {
  return threadedLayer(options).pipe(Layer.provide(localStorePreparationLayer));
}

function threadedLayer(options: PerformanceStoreOptions) {
  return performanceReportsLayer.pipe(Layer.provideMerge(performanceStoreLayer(options)));
}

function storeOptions(path: string): PerformanceStoreOptions {
  return { path, instanceId: 'process', maxPendingBytes: () => 1_000_000, maxStoredBytes: () => 1_000_000 };
}

const ROLLING_BOUND = 16_000_000;

function rollingOptions(path: string): PerformanceStoreOptions {
  return {
    path,
    instanceId: 'process',
    maxPendingBytes: () => 4_000_000,
    maxStoredBytes: () => ROLLING_BOUND,
  };
}

const waitUntil = Effect.fnUntraced(
  function* <E, R>(_state: string, settled: Effect.Effect<boolean, E, R>) {
    while (!(yield* settled)) yield* Effect.sleep(5);
  },
  (waiting, state) =>
    Effect.onInterrupt(waiting, () => Effect.logWarning(`the ring had not reached the state this test waited for: ${state}`)),
);

const segmentsOf = (path: string): ReadonlyArray<string> =>
  readdirSync(join(ringRoot(path), 'segments'))
    .filter((name) => name.endsWith('.sqlite'))
    .sort()
    .map((name) => join(ringRoot(path), 'segments', name));

const newestSegment = (path: string): string => {
  const newest = segmentsOf(path).at(-1);
  if (newest === undefined) throw new Error('the ring has no segment file yet');
  return newest;
};

const openSegmentBytes = (path: string): number => {
  const file = newestSegment(path);
  return statSync(file).size + (existsSync(`${file}-wal`) ? statSync(`${file}-wal`).size : 0);
};

const fillToRoll = Effect.fnUntraced(function* (path: string, tag: string) {
  const store = yield* PerformanceStore;
  for (let index = 0; index < 40; index += 1) {
    const record = spanRecord(`${tag}-${index}`, 'filler', index + 1, index, index + 1, `${tag}-trace`, null, `${tag}-filler`, {
      project: 'x'.repeat(100_000),
    });
    store.submit(submission(record, `${tag}-trace`));
    yield* store.flush;
    if (openSegmentBytes(path) >= segmentBytesFor(ROLLING_BOUND)) return;
  }
  return yield* Effect.die('the open segment never reached the size the ring rolls it at');
});

function submission(record: PerformanceRecord, retentionKey = record.id): PerformanceSubmission {
  return { record, retentionKey, byteSize: recordByteSize(record) };
}

function spanRecord(
  id: string,
  instanceId: string,
  wallTime: number,
  monotonicStart: number,
  monotonicEnd: number,
  traceId: string,
  parentId: string | null,
  name: string,
  attributes: Record<string, string> = {},
): SpanRecord {
  return {
    id,
    kind: 'span',
    instanceId,
    wallTime,
    monotonicStart,
    monotonicEnd,
    traceId,
    parentId,
    name,
    payload: { spanKind: 'internal', exit: { _tag: 'Success' }, attributes },
  };
}

function commandRecord(
  id: string,
  wallTime: number,
  monotonicStart: number,
  monotonicEnd: number,
  payload: {
    readonly class: CommandClass;
    readonly cpuMicros?: number;
    readonly peakRssBytes?: number;
    readonly exitCode?: number;
  },
): PerformanceRecord {
  return {
    id,
    kind: 'command',
    instanceId: 'process',
    wallTime,
    monotonicStart,
    monotonicEnd,
    payload: {
      class: payload.class,
      substrate: 'managed',
      cost:
        payload.cpuMicros === undefined
          ? { _tag: 'Unmeasured', reason: 'unsupported', detail: 'this backend reads no accounting' }
          : { _tag: 'Measured', cpuMicros: payload.cpuMicros, peakRssBytes: payload.peakRssBytes ?? 1024 },
      exit: { _tag: 'Code', code: payload.exitCode ?? 0 },
    },
  } as PerformanceRecord;
}

function loadRecord(id: string, wallTime: number, payload: LoadPayload): PerformanceRecord {
  return {
    id,
    kind: 'load',
    instanceId: 'process',
    wallTime,
    monotonicStart: wallTime,
    monotonicEnd: wallTime,
    payload,
  } as PerformanceRecord;
}

const measuredCores = (cores: number) => ({
  _tag: 'Measured' as const,
  cores,
  overMicros: 1_000_000,
  population: { matched: 3, born: 0, departed: 0 },
});
const unratedCores = {
  _tag: 'Unknown' as const,
  reason: 'first-sample' as const,
  detail: 'one cumulative counter is not a rate',
};

function treeLoad(fields: {
  readonly cores: number | undefined;
  readonly residentBytes: number;
  readonly cpuMicros: number;
  readonly takenAtMicros: number;
}) {
  return {
    takenAtMicros: fields.takenAtMicros,
    completeness: 'complete' as const,
    cpuMicros: fields.cpuMicros,
    cpu: fields.cores === undefined ? unratedCores : measuredCores(fields.cores),
    memory: { _tag: 'ResidentSum' as const, bytes: fields.residentBytes, processes: 3 },
    processes: 3,
  };
}

const executionRef = (execution: string, incarnation = 0): ExecutionRef =>
  Schema.decodeUnknownSync(ExecutionRef)({ installation: 'installation-1', execution, incarnation });

function executionLoad(
  id: string,
  wallTime: number,
  fields: {
    readonly execution: ExecutionRef;
    readonly threadId?: string;
    readonly cores: number | undefined;
    readonly residentBytes: number;
    readonly cpuMicros: number;
  },
): PerformanceRecord {
  return loadRecord(id, wallTime, {
    _tag: 'Execution',
    execution: fields.execution,
    threadId: fields.threadId,
    ...treeLoad({ ...fields, takenAtMicros: wallTime * 1_000 }),
  } as LoadPayload);
}

function installationLoad(id: string, wallTime: number, fields: { readonly cores: number; readonly cpuMicros: number }): PerformanceRecord {
  return loadRecord(id, wallTime, {
    _tag: 'Installation',
    ...treeLoad({ ...fields, residentBytes: 400_000_000, takenAtMicros: wallTime * 1_000 }),
  } as LoadPayload);
}

function machineLoad(id: string, wallTime: number, busy: number): PerformanceRecord {
  return loadRecord(id, wallTime, {
    _tag: 'Machine',
    cores: 12,
    busy: measuredCores(busy),
    takenAtMicros: wallTime * 1_000,
    completeness: 'complete',
  } as LoadPayload);
}

function stallRecord(id: string, instanceId: string, wallTime: number, monotonicStart: number, monotonicEnd: number): StallRecord {
  return {
    id,
    kind: 'stall',
    instanceId,
    wallTime,
    monotonicStart,
    monotonicEnd,
    payload: {
      delayMs: monotonicEnd - monotonicStart,
      cpu: { userMicros: 0, systemMicros: 0 },
      memory: memory(),
    },
  };
}

function vitalRecord(id: string, instanceId: string, wallTime: number, monotonicStart: number, monotonicEnd: number): VitalRecord {
  return {
    id,
    kind: 'vital',
    instanceId,
    wallTime,
    monotonicStart,
    monotonicEnd,
    payload: {
      cpu: { userMicros: 0, systemMicros: 0 },
      memory: memory(),
      loopDelay: { count: 1, p50Ms: 1, p99Ms: 2, maxMs: 3 },
    },
  };
}

function metricRecord(
  id: string,
  instanceId: string,
  wallTime: number,
  name: string,
  boundariesMs: ReadonlyArray<number>,
  bucketCounts: ReadonlyArray<number>,
  failures: number,
  sumMs: number,
): MetricSample {
  const count = bucketCounts.reduce((total, bucket) => total + bucket, 0);
  return {
    id,
    kind: 'metric',
    instanceId,
    wallTime,
    monotonicStart: wallTime,
    monotonicEnd: wallTime,
    name,
    payload: {
      boundariesMs,
      bucketCounts,
      count,
      failures,
      sumMs,
      minMs: count === 0 ? 0 : 1,
      maxMs: count === 0 ? 0 : Math.max(boundariesMs.at(-1) ?? 1, 1),
    },
  };
}

function profileRecord(
  id: string,
  instanceId: string,
  wallTime: number,
  profile: CpuProfileArtifact = {
    nodes: [{ id: 1, callFrame: { functionName: 'work', url: '', lineNumber: 0 } }],
    startTime: wallTime,
    endTime: wallTime + 25,
    samples: [1],
    timeDeltas: [25_000],
  },
): StoredProfileRecord {
  return {
    id,
    kind: 'profile',
    instanceId,
    wallTime,
    monotonicStart: wallTime,
    monotonicEnd: wallTime + 25,
    payload: {
      requestedBy: 'operator',
      requestedDurationMs: 25,
      profile,
    },
  };
}

function memory() {
  return {
    rssBytes: 1,
    heapTotalBytes: 1,
    heapUsedBytes: 1,
    externalBytes: 0,
    arrayBufferBytes: 0,
  };
}

function plan(database: Database, statement: string): string {
  return database
    .query<{ detail: string }, []>(`explain query plan ${statement}`)
    .all()
    .map((row) => row.detail)
    .join('\n');
}
