import * as Effect from 'effect/Effect';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { LoadPayload, LoadSubject } from '../protocol/records.js';
import type { PerformanceQuery } from '../protocol/queries.js';
import type { PerformanceReportMeta } from '../protocol/reports.js';
import { PerformanceRecordUnreadable, type Readers, type ReportAnswer } from './answer.js';
import { timePage } from './page.js';
import { readRecord } from './record.js';

export const loadSubjectKey = (payload: LoadPayload): string =>
  payload._tag === 'Execution'
    ? `Execution\u0000${payload.execution.installation}\u0000${payload.execution.execution}\u0000${payload.execution.incarnation}`
    : payload._tag;

export const loadFigures = (
  payload: LoadPayload,
): {
  readonly cores: number | undefined;
  readonly residentBytes: number | undefined;
  readonly cpuMicros: number | undefined;
} => {
  const rate = payload._tag === 'Machine' ? payload.busy : payload.cpu;
  const cores = rate._tag === 'Measured' ? rate.cores : undefined;
  if (payload._tag === 'Machine') return { cores, residentBytes: undefined, cpuMicros: undefined };
  return {
    cores,
    residentBytes: payload.memory._tag === 'ResidentSum' ? payload.memory.bytes : undefined,
    cpuMicros: payload.cpuMicros,
  };
};

export type LoadBucketFold = {
  readonly startedAt: number;
  readings: number;
  maxCores: number | null;
  coresSum: number;
  measuredCpu: number;
  unmeasuredCpu: number;
  maxResidentBytes: number | null;
  unmeasuredMemory: number;
  cpuMicros: number | null;
};

export type LoadSubjectFold = {
  readonly subject: LoadSubject;
  readings: number;
  counterBreaks: number;
  previousCpuMicros: number | undefined;
  readonly buckets: Map<number, LoadBucketFold>;
};

export const readLoad = Effect.fn('PerformanceWorker.readLoad')(function* (
  readers: Readers,
  query: Extract<PerformanceQuery, { readonly type: 'load' }>,
  meta: PerformanceReportMeta,
) {
  const page = yield* timePage(readers, 'load', query);
  const folded = new Map<string, LoadSubjectFold>();
  for (const row of page.rows) {
    const record = yield* readRecord(row);
    if (record.kind !== 'load') return yield* new PerformanceRecordUnreadable({ recordId: row.id });
    const payload = record.payload;
    if (query.subject !== undefined && payload._tag !== query.subject) continue;
    if (query.execution !== undefined && !ofExecution(payload, query.execution)) continue;
    if (query.threadId !== undefined && (payload._tag !== 'Execution' || payload.threadId !== query.threadId)) {
      continue;
    }
    const key = loadSubjectKey(payload);
    const subject =
      folded.get(key) ??
      ({
        subject: loadSubjectOf(payload),
        readings: 0,
        counterBreaks: 0,
        previousCpuMicros: undefined,
        buckets: new Map<number, LoadBucketFold>(),
      } satisfies LoadSubjectFold);
    folded.set(key, subject);
    const startedAt = Math.floor(record.wallTime / query.stepMs) * query.stepMs;
    const bucket =
      subject.buckets.get(startedAt) ??
      ({
        startedAt,
        readings: 0,
        maxCores: null,
        coresSum: 0,
        measuredCpu: 0,
        unmeasuredCpu: 0,
        maxResidentBytes: null,
        unmeasuredMemory: 0,
        cpuMicros: null,
      } satisfies LoadBucketFold);
    subject.buckets.set(startedAt, bucket);
    const figures = loadFigures(payload);
    subject.readings += 1;
    bucket.readings += 1;
    if (figures.cores === undefined) bucket.unmeasuredCpu += 1;
    else {
      bucket.measuredCpu += 1;
      bucket.coresSum += figures.cores;
      bucket.maxCores = Math.max(bucket.maxCores ?? 0, figures.cores);
    }
    if (figures.residentBytes === undefined) bucket.unmeasuredMemory += 1;
    else bucket.maxResidentBytes = Math.max(bucket.maxResidentBytes ?? 0, figures.residentBytes);
    if (figures.cpuMicros !== undefined) {
      const previous = subject.previousCpuMicros;
      if (previous !== undefined) {
        if (figures.cpuMicros >= previous) bucket.cpuMicros = (bucket.cpuMicros ?? 0) + (figures.cpuMicros - previous);
        else subject.counterBreaks += 1;
      }
      subject.previousCpuMicros = figures.cpuMicros;
    }
  }
  const subjects = [...folded.values()]
    .map((fold) => {
      const buckets = [...fold.buckets.values()]
        .sort((left, right) => left.startedAt - right.startedAt)
        .map((bucket) => ({
          startedAt: bucket.startedAt,
          readings: bucket.readings,
          maxCores: bucket.maxCores,
          meanCores: bucket.measuredCpu === 0 ? null : bucket.coresSum / bucket.measuredCpu,
          unmeasuredCpu: bucket.unmeasuredCpu,
          maxResidentBytes: bucket.maxResidentBytes,
          unmeasuredMemory: bucket.unmeasuredMemory,
          cpuSeconds: bucket.cpuMicros === null ? null : bucket.cpuMicros / 1_000_000,
        }));
      const integrated = buckets.filter((bucket) => bucket.cpuSeconds !== null);
      const peaks = buckets.filter((bucket) => bucket.maxCores !== null);
      return {
        subject: fold.subject,
        readings: fold.readings,
        cpuSeconds: integrated.length === 0 ? null : integrated.reduce((total, bucket) => total + (bucket.cpuSeconds ?? 0), 0),
        maxCores: peaks.length === 0 ? null : Math.max(...peaks.map((bucket) => bucket.maxCores ?? 0)),
        counterBreaks: fold.counterBreaks,
        buckets,
      };
    })
    .sort(
      (left, right) =>
        (right.cpuSeconds ?? 0) - (left.cpuSeconds ?? 0) || (right.maxCores ?? 0) - (left.maxCores ?? 0) || right.readings - left.readings,
    );
  return {
    _tag: 'Found',
    report: { type: 'load', ...meta, stepMs: query.stepMs, subjects, evidence: 'retained-only', next: page.next },
  } satisfies ReportAnswer;
});

const loadSubjectOf = (payload: LoadPayload): LoadSubject => {
  if (payload._tag === 'Execution') {
    return {
      _tag: 'Execution',
      execution: payload.execution,
      threadId: payload.threadId,
      projectId: payload.projectId,
    };
  }
  return payload._tag === 'Machine' ? { _tag: 'Machine', cores: payload.cores } : { _tag: 'Installation' };
};

const ofExecution = (payload: LoadPayload, execution: ExecutionRef): boolean =>
  payload._tag === 'Execution' &&
  payload.execution.installation === execution.installation &&
  payload.execution.execution === execution.execution &&
  payload.execution.incarnation === execution.incarnation;
