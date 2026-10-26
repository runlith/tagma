import { gcAndSweep } from 'bun:jsc';
import * as Cause from 'effect/Cause';
import * as Deferred from 'effect/Deferred';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Queue from 'effect/Queue';
import { describeErrors } from '@runlith/utils/error';
import { takeMemoryReading } from '../MemoryReading.js';
import { monotonicMs } from '../monotonic.js';
import type { PerformanceRecord } from './records.js';
import type { InitializeStore, MaintainStore, RecordDrops, StoreAnswer, StoreRequest, WriteRecords } from './wire.js';
import type { PerformanceRecordKind } from '../protocol/records.js';
import { openSegmentRing, type SegmentRing, type SegmentWrite, watchSegmentRing } from '../SegmentRing.js';
import { readReport, reportMeta } from '../reports/dispatch.js';
import type { performanceRecord } from '../schema.js';

const BUSY_TIMEOUT = Duration.seconds(5);
const INSERT_CHUNK = 500;

type Command = Exclude<StoreRequest, InitializeStore>;
type Replies<E, R> = (answer: StoreAnswer) => Effect.Effect<void, E, R>;

export const runSession = Effect.fnUntraced(function* <E, R>(incoming: Queue.Dequeue<StoreRequest>, reply: Replies<E, R>) {
  const initialized = Deferred.makeUnsafe<InitializeStore>();
  const commands = yield* Queue.unbounded<Command>();
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        const request = yield* Queue.take(incoming);
        if (request._tag === 'InitializeStore') Deferred.doneUnsafe(initialized, Effect.succeed(request));
        else Queue.offerUnsafe(commands, request);
      }
    }),
  );
  const options = yield* Deferred.await(initialized);
  yield* (options.watch === true ? runWatch : runStore)(reply, commands, options).pipe(
    Effect.catchCause((cause) => reply({ _tag: 'StoreUnavailable', message: describeErrors(Cause.prettyErrors(cause)) })),
  );
});

const runStore = Effect.fn('PerformanceWorker.run')(function* <E, R>(
  reply: Replies<E, R>,
  commands: Queue.Dequeue<Command>,
  options: InitializeStore,
) {
  const ring = yield* openSegmentRing(
    options.path,
    options.instanceId,
    options.busyTimeoutMs === undefined ? BUSY_TIMEOUT : Duration.millis(options.busyTimeoutMs),
  );
  yield* Effect.addFinalizer(() => ring.close());
  yield* reply({ _tag: 'StoreReady', dropCount: ring.catalog.dropCount, droppedKinds: ring.catalog.droppedByKind });
  while (true) {
    const command = yield* Queue.take(commands);
    yield* handle(ring, options, command).pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) => {
          if (command._tag === 'ReadReport') {
            const failed = reply({
              _tag: 'ReportFailed',
              requestId: command.requestId,
              message: describeErrors(Cause.prettyErrors(cause)),
            });
            return corruptRecordOnly(cause) ? failed : failed.pipe(Effect.andThen(Effect.failCause(cause)));
          }
          return Effect.failCause(cause);
        },
        onSuccess: reply,
      }),
    );
  }
});

const runWatch = Effect.fn('PerformanceWorker.watch')(function* <E, R>(
  reply: Replies<E, R>,
  commands: Queue.Dequeue<Command>,
  options: InitializeStore,
) {
  const ring = yield* watchSegmentRing(
    options.path,
    options.busyTimeoutMs === undefined ? BUSY_TIMEOUT : Duration.millis(options.busyTimeoutMs),
  );
  yield* Effect.addFinalizer(() => ring.close());
  yield* reply({ _tag: 'StoreReady', dropCount: ring.catalog.dropCount, droppedKinds: ring.catalog.droppedByKind });
  while (true) {
    const command = yield* Queue.take(commands);
    if (command._tag !== 'ReadReport') continue;
    const answer = yield* Effect.gen(function* () {
      yield* ring.refresh();
      const meta = reportMeta(ring);
      const read = yield* readReport(ring, options, command.query, meta);
      return read._tag === 'Found'
        ? ({ _tag: 'ReportDone', requestId: command.requestId, report: read.report } satisfies StoreAnswer)
        : ({ _tag: 'ReportNotFound', requestId: command.requestId, query: read.query, meta } satisfies StoreAnswer);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed({
          _tag: 'ReportFailed',
          requestId: command.requestId,
          message: describeErrors(Cause.prettyErrors(cause)),
        } satisfies StoreAnswer),
      ),
      Effect.ensuring(ring.release()),
    );
    yield* reply(answer);
  }
});

const corruptRecordOnly = (cause: Cause.Cause<unknown>): boolean =>
  cause.reasons.length > 0 &&
  cause.reasons.every(
    (reason) => reason._tag === 'Fail' && (reason.error as { readonly _tag?: unknown })?._tag === 'PerformanceRecordUnreadable',
  );

const handle = Effect.fn('PerformanceWorker.handle')(function* (ring: SegmentRing, options: InitializeStore, command: Command) {
  switch (command._tag) {
    case 'WriteRecords':
      yield* writeRecords(ring, command);
      return { _tag: 'RecordsAck', sequence: command.sequence } satisfies StoreAnswer;
    case 'RecordDrops':
      yield* recordDrops(ring, command);
      return { _tag: 'CommandDone', sequence: command.sequence } satisfies StoreAnswer;
    case 'MaintainStore': {
      const step = yield* maintainStore(ring, command);
      return {
        _tag: 'StoreMaintained',
        sequence: command.sequence,
        evicted: step.evicted,
        records: step.records,
        droppedKinds: step.kinds,
        elapsedMs: step.elapsedMs,
      } satisfies StoreAnswer;
    }
    case 'ReadWorkerMemory': {
      const reading = takeMemoryReading('store-worker', 'all');
      if (!command.collect) return { _tag: 'WorkerMemoryDone', requestId: command.requestId, reading: { reading } } satisfies StoreAnswer;
      const started = yield* monotonicMs;
      gcAndSweep();
      const pauseMs = (yield* monotonicMs) - started;
      return {
        _tag: 'WorkerMemoryDone',
        requestId: command.requestId,
        reading: { reading, collected: { pauseMs, reading: takeMemoryReading('store-worker', 'all') } },
      } satisfies StoreAnswer;
    }
    case 'ReadReport': {
      const meta = reportMeta(ring);
      const answer = yield* readReport(ring, options, command.query, meta);
      return answer._tag === 'Found'
        ? ({ _tag: 'ReportDone', requestId: command.requestId, report: answer.report } satisfies StoreAnswer)
        : ({ _tag: 'ReportNotFound', requestId: command.requestId, query: answer.query, meta } satisfies StoreAnswer);
    }
  }
});

const lines = new TextDecoder();
type WrittenRecord = readonly [PerformanceRecord, string];

const runIdOf = (record: PerformanceRecord): string | null => {
  if (record.kind !== 'span') return null;
  const payload: unknown = record.payload;
  if (payload === null || typeof payload !== 'object') return null;
  const attributes: unknown = (payload as { readonly attributes?: unknown }).attributes;
  if (attributes === null || typeof attributes !== 'object') return null;
  const runId: unknown = (attributes as Record<string, unknown>)['run.id'];
  return typeof runId === 'string' ? runId : null;
};

const writeRecords = Effect.fn('PerformanceWorker.writeRecords')(function* (ring: SegmentRing, command: WriteRecords) {
  const written = JSON.parse(lines.decode(command.records)) as ReadonlyArray<WrittenRecord>;
  const rows: Array<typeof performanceRecord.$inferInsert> = [];
  const kinds = new Map<PerformanceRecordKind, number>();
  const groups = new Set<string>();
  let firstWallTime = Number.POSITIVE_INFINITY;
  let lastWallTime = Number.NEGATIVE_INFINITY;
  for (const [record, retentionKey] of written) {
    rows.push({
      id: record.id,
      kind: record.kind,
      instanceId: record.instanceId,
      wallTime: record.wallTime,
      monotonicStart: record.monotonicStart,
      monotonicEnd: record.monotonicEnd,
      traceId: record.traceId ?? null,
      parentId: record.parentId ?? null,
      name: record.name ?? null,
      runId: runIdOf(record),
      payload: JSON.stringify(record.payload),
    });
    kinds.set(record.kind, (kinds.get(record.kind) ?? 0) + 1);
    groups.add(retentionKey);
    if (record.wallTime < firstWallTime) firstWallTime = record.wallTime;
    if (record.wallTime > lastWallTime) lastWallTime = record.wallTime;
  }
  const write: SegmentWrite = { rows, kinds, firstWallTime, lastWallTime, groups, chunk: INSERT_CHUNK };
  yield* ring.write(write, command.droppedKinds, command.maxStoredBytes);
});

const recordDrops = Effect.fn('PerformanceWorker.recordDrops')(function* (ring: SegmentRing, command: RecordDrops) {
  yield* ring.catalog.addDrops(command.droppedKinds);
});

const maintainStore = Effect.fn('PerformanceWorker.maintainStore')(function* (ring: SegmentRing, command: MaintainStore) {
  const step = yield* ring.maintain(command.maxStoredBytes, command.protectedRetentionKeys);
  if (step.blocked)
    yield* Effect.logDebug('Performance store stands over its bound: every old segment holds a retention group a producer has not closed.');
  return step;
});
