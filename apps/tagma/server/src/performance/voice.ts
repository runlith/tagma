import type { CostCounts, CostCursor, CostRow } from '@runlith/performance/CostLedger';
import type { HandedArtifact, PerformanceAnswer, PerformanceValue } from './contract/wire/performance.js';

export const measured = (answer: unknown): PerformanceAnswer | null =>
  typeof answer === 'object' && answer !== null && 'performance' in answer ? (answer as PerformanceAnswer) : null;

export function performanceAnswerText(answer: unknown): string | null {
  const read = measured(answer);
  return read === null ? null : performanceText(read.performance, read.artifact);
}

const dropsText = (value: { readonly sessionDrops: number; readonly inheritedDrops: number | null }): string =>
  `drops ${value.sessionDrops} this process, ${
    value.inheritedDrops === null ? "the file's own count unread" : `${value.inheritedDrops} already in the file`
  }`;

export function performanceText(value: PerformanceValue, artifact?: HandedArtifact): string {
  switch (value.type) {
    case 'not-found':
      return `${value.query.type} not found\n${dropsText(value)}\nretained ${
        value.retainedRange === null ? 'none' : `${value.retainedRange.from}..${value.retainedRange.to}`
      }`;
    case 'unavailable':
      return `performance unavailable: ${value.message}`;
    case 'query-failed':
      return `performance query failed: ${value.message}`;
    case 'read-timed-out':
      return `performance read gave up: ${value.message}\nthe store is still answering; ask for a narrower interval`;
    case 'capture-failed':
      return `performance capture failed during ${value.operation}: ${value.message}`;
    case 'ledger':
      return ledgerText(value);
    case 'stall':
      return stallText(value);
    case 'stalls':
      return stallsText(value);
    case 'profile':
      return profileText(value, artifact);
    case 'captured':
      return capturedText(value);
    case 'breakdown':
      return breakdownText(value);
    case 'reading-kept':
      return readingText(value);
    case 'snapshot-kept':
      return snapshotText(value);
    case 'snapshot-failed':
      return `heap snapshot failed during ${value.step}: ${value.message}`;
    default:
      return JSON.stringify(value, null, 2);
  }
}

const ledgerCounts = (kind: string, values: CostCounts): string =>
  [
    kind,
    values.statements,
    values.units,
    values.programs,
    values.writerHoldMs,
    values.writerWaitMs,
    values.requestBytes,
    values.responseBytes,
    values.spans,
  ].join('\t');

const ledgerRow = (row: CostRow): string[] => [
  `${row.sequence}\t${row.id}\t${row.name}\t${row.startedAt}..${row.endedAt ?? 'running'}`,
  ledgerCounts('total', row.total),
  ledgerCounts('own', row.own),
  ...row.producers.map((producer) => ledgerCounts(producer.name, producer.counts)),
];

const ledgerCursor = (cursor: CostCursor): string => JSON.stringify(cursor);

function ledgerText(value: Extract<PerformanceValue, { readonly type: 'ledger' }>): string {
  return [
    'cost ledger: process-lifetime retained suffix; late work can update ended roots',
    'totals are own + disjoint producers; request/response bytes measure logical SQLite payload, not IPC framing',
    'bucket\tstatements\tunits\tprograms\twriterHoldMs\twriterWaitMs\trequestBytes\tresponseBytes\tspans',
    ...value.rows.flatMap(ledgerRow),
    `ledger ${value.ledgerId}; reset ${value.reset}; total ${value.total}; evicted ${value.evicted}; next ${value.next === null ? 'none' : ledgerCursor(value.next)}`,
  ].join('\n');
}

const LARGEST_TYPES = 8;

const megabytes = (count: number): string =>
  count >= 1_000_000_000 ? `${(count / 1_000_000_000).toFixed(2)} GB` : `${(count / 1_000_000).toFixed(1)} MB`;

const objectCount = (count: number): string =>
  count >= 1_000_000 ? `${(count / 1_000_000).toFixed(2)}M` : `${(count / 1_000).toFixed(0)}k`;

type ThreadReading = Extract<PerformanceValue, { readonly type: 'reading-kept' }>['reading']['payload']['threads'][number];

const threadRow = (thread: ThreadReading): string =>
  [
    thread.thread,
    megabytes(thread.process.rssBytes),
    megabytes(thread.process.heapUsedBytes),
    megabytes(thread.process.heapTotalBytes),
    objectCount(thread.heap.objectCount),
    thread.censusMs.toFixed(0),
  ].join('\t');

const largestText = (thread: ThreadReading): string => {
  const head = thread.largestTypes.slice(0, LARGEST_TYPES).map((type) => `${type.name} ${objectCount(type.count)}`);
  const rest = thread.largestTypes.length - head.length;
  return `${head.join(' · ')}${rest > 0 ? ` · +${rest} more types` : ''}`;
};

function readingText(value: Extract<PerformanceValue, { readonly type: 'reading-kept' }>): string {
  const payload = value.reading.payload;
  const collected = payload.collected;
  return [
    `reading ${value.reading.id} kept for ${payload.requestedBy}`,
    'thread\trss\theapUsed\theapTotal\tobjects\tcensusMs',
    ...payload.threads.map(threadRow),
    ...(collected === undefined ? [] : [`after collecting, pause ${collected.pauseMs.toFixed(0)} ms`, ...collected.threads.map(threadRow)]),
    ...payload.threads.map((thread) => `largest in ${thread.thread}: ${largestText(thread)}`),
    `the whole census is kept: read_performance type: growth id: ${value.reading.id}`,
  ].join('\n');
}

function snapshotText(value: Extract<PerformanceValue, { readonly type: 'snapshot-kept' }>): string {
  const snapshot = value.snapshot;
  return [
    `heap snapshot ${snapshot.id} kept for ${snapshot.requestedBy}: ${snapshot.file} (${megabytes(snapshot.bytes)})`,
    `paused ${snapshot.snapshotMs.toFixed(0)} ms, written in ${snapshot.writeMs.toFixed(0)} ms`,
    `heap after collection ${megabytes(snapshot.heap.sizeBytes)}, extra ${megabytes(snapshot.heap.extraMemoryBytes)}, ${objectCount(snapshot.heap.objectCount)} objects`,
    'kept, newest first:',
    ...snapshot.kept,
  ].join('\n');
}

function stallsText(value: Extract<PerformanceValue, { readonly type: 'stalls' }>): string {
  const rows = value.stalls.map((reading) =>
    [
      `${reading.stall.payload.delayMs.toFixed(0)} ms`,
      reading.cause,
      sampledText(reading.sampling, reading.stall.payload.delayMs),
      frameText(reading.sampling?.frame ?? null),
      callerText(reading.caller),
      reading.stall.id,
    ].join('\t'),
  );
  const next = value.next === null ? 'none' : `${value.next.wallTime}:${value.next.id}`;
  return ['delay\tcause\tsampled\tframe\tcaller\tid', ...rows, `next ${next}`].join('\n');
}

type Sampling = Extract<PerformanceValue, { readonly type: 'stalls' }>['stalls'][number]['sampling'];

const samplesText = (count: number): string => `${count} ${count === 1 ? 'sample' : 'samples'}`;

const sampledText = (sampling: Sampling, delayMs: number): string =>
  sampling === null ? 'no profile' : `${samplesText(sampling.samples)}, ${sampling.sampledMs.toFixed(1)} of ${delayMs.toFixed(0)} ms`;

function frameText(frame: NonNullable<Sampling>['frame']): string {
  if (frame === null) return '—';
  const where = frame.url === '' ? '' : ` at ${frame.url}:${frame.lineNumber}`;
  return `${frame.functionName === '' ? '(anonymous)' : frame.functionName}${where} (${samplesText(frame.samples)}, ${frame.selfMs.toFixed(1)} ms)`;
}

const cpuMs = (cpu: { readonly userMicros: number; readonly systemMicros: number }): string =>
  `${((cpu.userMicros + cpu.systemMicros) / 1_000).toFixed(1)} ms`;

function frameLine(sampling: Sampling, delayMs: number): string {
  if (sampling === null) return 'frame — the stall kept no readable profile';
  if (sampling.frame !== null) return `frame ${frameText(sampling.frame)}; the sampler saw ${sampledText(sampling, delayMs)}`;
  return `frame — the sampler saw the loop busy for under half the stall (${sampledText(sampling, delayMs)}), so no frame holds it`;
}

function callerText(caller: Extract<PerformanceValue, { readonly type: 'stalls' }>['stalls'][number]['caller']): string {
  if (caller === null) return '—';
  const what = caller.toolName ?? caller.name;
  return `${what} of ${caller.threadId === undefined ? `run ${caller.runId}` : `thread ${caller.threadId}`}`;
}

function stallText(value: Extract<PerformanceValue, { readonly type: 'stall' }>): string {
  const overlap = ['totalMs\tmaxMs\tcount\tname', ...value.overlap.map((row) => `${row.totalMs}\t${row.maxMs}\t${row.count}\t${row.name}`)];
  const callers = [
    'coveredMs\tdurationMs\trun\tthread\ttool\tname',
    ...value.callers.map((row) =>
      [
        row.coveredMs.toFixed(1),
        row.durationMs.toFixed(1),
        row.runId,
        row.threadId ?? '—',
        row.toolName ?? row.toolCallId ?? '—',
        row.name,
      ].join('\t'),
    ),
  ];
  const { cpuWindowMs, cpu, loopCpu, delayMs } = value.stall.payload;
  const next = value.next === null ? 'none' : `${value.next.wallTime}:${value.next.id}`;
  return [
    `stall ${value.stall.id} — ${delayMs} ms, ${value.cause}`,
    `wallTime ${value.stall.wallTime}; profile ${value.stall.payload.profileId ?? 'none'}`,
    `${cpuWindowMs === undefined ? '' : `over ${cpuWindowMs.toFixed(1)} ms: `}loop thread cpu ${
      loopCpu === undefined ? 'unmeasured' : cpuMs(loopCpu)
    }; process cpu, every thread, ${cpuMs(cpu)}`,
    frameLine(value.sampling, delayMs),
    'callers',
    ...callers,
    'overlap',
    ...overlap,
    `raw spans ${value.spans.length}; next ${next}`,
    ...(value.spans.length === 0 ? [] : [JSON.stringify(value.spans, null, 2)]),
    `vitals ${value.vitals.length}`,
  ].join('\n');
}

function breakdownText(value: Extract<PerformanceValue, { readonly type: 'breakdown' }>): string {
  return [
    `span ${value.span.id} — ${value.span.name}`,
    `elapsed ${value.span.durationMs} ms; covered union ${value.coveredMs} ms; self/uncovered ${value.selfMs} ms`,
    'retained-only: self includes missing, sampled-out or unfinished children; elapsed is not CPU time.',
    'Direct children overlap; their durations must not be summed.',
    'coveredMs\tdurationMs\tname\tid',
    ...value.children.map((child) => `${child.coveredMs}\t${child.durationMs}\t${child.name}\t${child.id}`),
    `children ${value.children.length} of ${value.totalChildren}; next ${JSON.stringify(value.next)}`,
    `${dropsText(value)}; retained ${value.retainedRange === null ? 'none' : `${value.retainedRange.from}..${value.retainedRange.to}`}`,
  ].join('\n');
}

const coveredMs = (record: { readonly monotonicStart: number; readonly monotonicEnd: number }): number =>
  Math.round(record.monotonicEnd - record.monotonicStart);

function profileText(value: Extract<PerformanceValue, { readonly type: 'profile' }>, artifact?: HandedArtifact): string {
  const payload = value.profile.payload;
  const frames = [
    'selfMs\ttotalMs\tsamples\tfunction\tsource',
    ...value.frames.map(
      (frame) => `${frame.selfMs}\t${frame.totalMs}\t${frame.samples}\t${frame.functionName}\t${frame.url}:${frame.lineNumber}`,
    ),
  ];
  const raw =
    artifact !== undefined
      ? [`artifact ${artifact.file} (${artifact.bytes} bytes)`]
      : payload.profile === undefined
        ? []
        : ['artifact', JSON.stringify(payload.profile)];
  return [
    `profile ${value.profile.id} — ${payload.requestedBy}, requested ${payload.requestedDurationMs} ms, covered ${coveredMs(value.profile)} ms`,
    ...frames,
    ...raw,
  ].join('\n');
}

function capturedText(value: Extract<PerformanceValue, { readonly type: 'captured' }>): string {
  const record = value.profile;
  return [
    `profile ${record.id} kept for ${record.payload.requestedBy}: requested ${record.payload.requestedDurationMs} ms, covered ${coveredMs(record)} ms`,
    ...value.cuts.map((cut) => `cut by ${cut.requestedBy}: the window before it is profile ${cut.id}`),
    `its frames: read_performance type: profile id: ${record.id}`,
  ].join('\n');
}
