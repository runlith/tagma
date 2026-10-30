import * as BunWorker from '@effect/platform-bun/BunWorker';
import * as Cause from 'effect/Cause';
import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Deferred from 'effect/Deferred';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as Queue from 'effect/Queue';
import { declare } from '@runlith/held/Held';
import { waiters } from '@runlith/held/Waiters';
import * as EffectWorker from 'effect/workers/Worker';
import { describeErrors } from '@runlith/utils/error';
import type { WorkerUnavailable } from '@runlith/utils/worker';
import { prepareWorker } from '@runlith/held/PreparedWorker';
import { randomUUID } from 'node:crypto';
import { takeMemoryReading } from '../MemoryReading.js';
import { PendingBuffer, PendingQueue, pendingClass } from '../PendingQueue.js';
import { RetentionGroups } from '../RetentionGroups.js';
import { makeStoreWorker } from '../StoreWorker.js';
import type { LossKindCounts, LossPayload, PerformanceRecordKind, StorePressure } from '../protocol/records.js';
import type { PerformanceStoreQuery } from '../protocol/queries.js';
import {
  PerformanceRecordRefused,
  PerformanceRecordUnavailable,
  PerformanceReportUnavailable,
  PerformanceStoreQueryFailed,
  PerformanceStoreUnavailable,
  recordByteSize,
  recordLine,
} from './records.js';
import type {
  PerformanceLossAccount,
  PerformanceRecord,
  PerformanceRecordFailure,
  PerformanceRecordNotKeptReason,
  PerformanceStoreDiagnostics,
  PerformanceStoreFailure,
  PerformanceStoreOptions,
  PerformanceSubmission,
  StoreReportRead,
  WorkerReportRead,
} from './records.js';
import type { InitializeStore, MaintainStore, RecordDrops, StoreAnswer, StoreRequest, WorkerMemoryReading, WriteRecords } from './wire.js';

export const PreparedStoreWorker = Context.Reference<EffectWorker.Worker<StoreAnswer, StoreRequest> | undefined>(
  '@runlith/performance/PreparedStoreWorker',
  { defaultValue: () => undefined },
);

export const performancePreparationLayer = Layer.effect(
  PreparedStoreWorker,
  Effect.gen(function* () {
    const platform = yield* EffectWorker.WorkerPlatform;
    return yield* prepareWorker(yield* platform.spawn<StoreAnswer, StoreRequest>(0));
  }).pipe(Effect.withTracerEnabled(false)),
).pipe(Layer.provide(BunWorker.layer(() => new globalThis.Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }))));

export class PerformanceStoreReader extends Context.Service<
  PerformanceStoreReader,
  {
    readonly read: (query: PerformanceStoreQuery) => Effect.Effect<StoreReportRead, PerformanceStoreFailure>;
  }
>()('@runlith/performance/PerformanceStoreReader') {}

export class PerformanceStore extends Context.Service<
  PerformanceStore,
  {
    readonly openGroup: (retentionKey: string) => void;
    readonly closeGroup: (retentionKey: string) => void;
    readonly submit: (submission: PerformanceSubmission) => void;
    readonly submitDurable: (submission: PerformanceSubmission) => Effect.Effect<void, PerformanceRecordFailure>;
    readonly readWorkerMemory: (collect: boolean) => Effect.Effect<WorkerMemoryReading, PerformanceStoreUnavailable>;
    readonly flush: Effect.Effect<void>;
    readonly pressure: () => StorePressure;
    readonly diagnostics: () => PerformanceStoreDiagnostics;
  }
>()('@runlith/performance/PerformanceStore') {}

const REPORT_TIMEOUT_MS = 90_000;
const FLUSH_INTERVAL_MS = 250;
const FLUSH_BYTES = 1024 * 1024;
const MAINTAIN_INTERVAL_MS = 60_000;

export const performanceStoreLayer = (options: PerformanceStoreOptions) => {
  return Layer.effectContext(
    make(options).pipe(
      Effect.withTracerEnabled(false),
      Effect.catch((error) => Effect.succeed(unavailableServices(options.path, error.message))),
      Effect.map(({ reader, store }) => Context.make(PerformanceStore, store).pipe(Context.add(PerformanceStoreReader, reader))),
    ),
  ).pipe(Layer.provide(BunWorker.layer(() => new globalThis.Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }))));
};

export const performanceStoreWatchLayer = (options: PerformanceWatchOptions) => {
  return Layer.effect(
    PerformanceStoreReader,
    watch(options).pipe(
      Effect.withTracerEnabled(false),
      Effect.catch((error) => Effect.succeed(unavailableReader(error.message))),
    ),
  ).pipe(Layer.provide(BunWorker.layer(() => new globalThis.Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }))));
};

export type PerformanceWatchOptions = {
  readonly path: string;
  readonly openTimeoutMs?: number | undefined;
  readonly busyTimeoutMs?: number | undefined;
  readonly reportTimeoutMs?: number | undefined;
  readonly maxReportSamples?: number | undefined;
};

const WATCH_OPEN_TIMEOUT_MS = 30_000;

const watch = Effect.fn('PerformanceStore.watch')(function* (options: PerformanceWatchOptions) {
  const platform = yield* EffectWorker.WorkerPlatform;
  const worker = yield* platform.spawn<StoreAnswer, StoreRequest>(0);
  let opened = Deferred.makeUnsafe<void, PerformanceStoreUnavailable>();
  const reports = yield* waiters<string, WorkerReportRead, PerformanceStoreFailure>({
    name: 'performance-watch-reports',
    owner: 'performance',
    key: (requestId) => requestId,
  });
  let unavailable: PerformanceStoreUnavailable | undefined;
  const gone = (cause: WorkerUnavailable) => {
    const error = (unavailable = new PerformanceStoreUnavailable({ message: cause.message, cause }));
    Deferred.doneUnsafe(opened, Effect.fail(error));
    reports.completeAll(Exit.fail(error));
  };
  const answer = (response: StoreAnswer) => {
    switch (response._tag) {
      case 'StoreReady':
        if (unavailable !== undefined) opened = Deferred.makeUnsafe<void, PerformanceStoreUnavailable>();
        unavailable = undefined;
        Deferred.doneUnsafe(opened, Effect.void);
        return;
      case 'StoreUnavailable':
        link.end(response.message);
        return;
      case 'ReportDone':
        reports.complete(response.requestId, Exit.succeed({ _tag: 'WorkerFound', report: response.report }));
        return;
      case 'ReportNotFound':
        reports.complete(response.requestId, Exit.succeed({ _tag: 'NotFound', query: response.query, meta: response.meta }));
        return;
      case 'ReportFailed':
        reports.complete(response.requestId, Exit.fail(new PerformanceStoreQueryFailed({ message: response.message })));
        return;
    }
  };
  const initialize: InitializeStore = {
    _tag: 'InitializeStore',
    path: options.path,
    instanceId: 'watch',
    maxStoredBytes: 0,
    busyTimeoutMs: options.busyTimeoutMs,
    maxReportSamples: options.maxReportSamples,
    watch: true,
  };
  const link = makeStoreWorker({
    worker,
    onResponse: answer,
    onGone: gone,
    initialize: () => initialize,
    options: { openTimeoutMs: options.openTimeoutMs ?? WATCH_OPEN_TIMEOUT_MS },
  });
  yield* Effect.addFinalizer(() => Effect.sync(() => link.stop()));
  yield* Effect.forkScoped(link.run);
  const reportTimeout = Duration.millis(options.reportTimeoutMs ?? REPORT_TIMEOUT_MS);
  const gate = declare<string>({
    name: 'performance-watch-read',
    owner: 'performance',
    rank: 723,
    key: (key: string) => key,
    concurrency: 1,
    threshold: Duration.seconds(90),
    ceilings: {
      hold: Duration.minutes(15),
      wait: Duration.minutes(15),
      leaves: 'the report request may have reached the worker; its late answer is ignored',
    },
    external: { named: 'performance worker', callsBack: false },
  });

  const read = (query: PerformanceStoreQuery): Effect.Effect<StoreReportRead, PerformanceStoreFailure> => {
    if (query.type === 'memory' || query.type === 'losses') {
      return Effect.fail(
        new PerformanceStoreUnavailable({
          message: `a watched ring answers what its process retained; ${query.type} is read inside the process it describes, and its vitals carry its store pressure`,
        }),
      );
    }
    return gate
      .hold(
        'sole',
        Effect.gen(function* () {
          if (unavailable !== undefined) return yield* Effect.fail(unavailable);
          yield* Deferred.await(opened).pipe(
            Effect.timeoutOrElse({
              duration: Duration.millis(options.openTimeoutMs ?? WATCH_OPEN_TIMEOUT_MS),
              orElse: () => Effect.fail(new PerformanceStoreUnavailable({ message: 'the watched ring did not open within its deadline' })),
            }),
          );
          const requestId = randomUUID();
          const result = yield* reports.wait(requestId, link.send({ _tag: 'ReadReport', requestId, query })).pipe(
            Effect.timeoutOrElse({
              duration: reportTimeout,
              orElse: () =>
                Effect.fail(
                  new PerformanceReportUnavailable({
                    reason: 'timeout',
                    message: `the ${query.type} report did not answer within ${Duration.toMillis(reportTimeout)} ms`,
                  }),
                ),
            }),
          );
          if (result._tag === 'NotFound') return result satisfies StoreReportRead;
          if (result.report.type === 'losses') {
            return yield* new PerformanceStoreQueryFailed({ message: 'a watched ring answered a losses page' });
          }
          return { _tag: 'Found', report: result.report } satisfies StoreReportRead;
        }),
      )
      .pipe(
        Effect.catchTag('HoldStalled', (stall) =>
          Effect.fail(
            new PerformanceReportUnavailable({
              reason: 'timeout',
              message: `the ${query.type} report waited ${stall.waitedMs} ms for the watch door`,
            }),
          ),
        ),
        Effect.catchTag('HoldCut', (cut) =>
          Effect.fail(
            new PerformanceReportUnavailable({
              reason: 'timeout',
              message: `the ${query.type} report held the watch door ${cut.heldMs} ms; ${cut.leaves}`,
            }),
          ),
        ),
        Effect.withTracerEnabled(false),
      );
  };

  return PerformanceStoreReader.of({ read });
});

const unavailableReader = (
  message: string,
): {
  readonly read: (query: PerformanceStoreQuery) => Effect.Effect<StoreReportRead, PerformanceStoreFailure>;
} =>
  PerformanceStoreReader.of({
    read: () => Effect.fail(new PerformanceStoreUnavailable({ message })),
  });

type Shed = {
  readonly kinds: Map<PerformanceRecordKind, number>;
  wallTime: number;
  monotonicStart: number;
  monotonicEnd: number;
  peakPendingBytes: number;
};

type Account = { readonly kinds: Map<PerformanceRecordKind, number>; readonly from: number; to: number };

const countKind = (kinds: Map<PerformanceRecordKind, number>, kind: PerformanceRecordKind, count = 1) => {
  kinds.set(kind, (kinds.get(kind) ?? 0) + count);
};

const asKindCounts = (kinds: ReadonlyMap<PerformanceRecordKind, number>): LossKindCounts => Object.fromEntries(kinds) as LossKindCounts;

const addKindCounts = (into: Map<PerformanceRecordKind, number>, counts: LossKindCounts) => {
  for (const [kind, count] of Object.entries(counts)) {
    if (count === undefined) continue;
    countKind(into, kind as PerformanceRecordKind, count);
  }
};

const takeKindCounts = (kinds: Map<PerformanceRecordKind, number>): LossKindCounts => {
  const taken = asKindCounts(kinds);
  kinds.clear();
  return taken;
};

const subtractKindCounts = (from: Map<PerformanceRecordKind, number>, counts: LossKindCounts) => {
  for (const [kind, count] of Object.entries(counts)) {
    if (count === undefined) continue;
    const next = (from.get(kind as PerformanceRecordKind) ?? 0) - count;
    if (next > 0) from.set(kind as PerformanceRecordKind, next);
    else from.delete(kind as PerformanceRecordKind);
  }
};

const keepUnrecorded = (
  accounts: Map<PerformanceRecordNotKeptReason, Account>,
  reason: PerformanceRecordNotKeptReason,
  kinds: ReadonlyMap<PerformanceRecordKind, number>,
  at: number,
) => {
  if (kinds.size === 0) return;
  const open = accounts.get(reason);
  const account = open ?? { kinds: new Map<PerformanceRecordKind, number>(), from: at, to: at };
  if (open === undefined) accounts.set(reason, account);
  for (const [kind, count] of kinds) countKind(account.kinds, kind, count);
  account.to = Math.max(account.to, at);
};

const readUnrecorded = (accounts: ReadonlyMap<PerformanceRecordNotKeptReason, Account>): ReadonlyArray<PerformanceLossAccount> =>
  [...accounts].map(([reason, account]) => ({
    reason,
    kinds: Object.fromEntries(account.kinds) as LossKindCounts,
    from: account.from,
    to: account.to,
  }));

const make = Effect.fn('PerformanceStore.make')(function* (options: PerformanceStoreOptions) {
  const platform = yield* EffectWorker.WorkerPlatform;
  const prepared = yield* PreparedStoreWorker;
  const worker = prepared ?? (yield* platform.spawn<StoreAnswer, StoreRequest>(0));
  const signal = yield* Queue.dropping<void>(1);
  const opened = yield* Queue.dropping<void>(1);
  const pending = new PendingQueue();
  const retentionGroups = new RetentionGroups();
  let sequence = 0;
  const nextSequence = () => (sequence += 1);
  const commands = yield* waiters<number, void, PerformanceStoreUnavailable>({
    name: 'performance-store-commands',
    owner: 'performance',
    key: (sequence) => String(sequence),
  });
  const durableSubmissions = yield* waiters<PendingBuffer, void, PerformanceRecordFailure>({
    name: 'performance-store-durable',
    owner: 'performance',
    key: (buffer) => String(buffer.sequence),
  });
  const reports = yield* waiters<string, WorkerReportRead, PerformanceStoreFailure>({
    name: 'performance-store-reports',
    owner: 'performance',
    key: (requestId) => requestId,
  });
  const workerMemoryReads = yield* waiters<string, WorkerMemoryReading, PerformanceStoreUnavailable>({
    name: 'performance-store-worker-memory',
    owner: 'performance',
    key: (requestId) => requestId,
  });
  const flushes = new Set<Deferred.Deferred<void>>();
  const readGate = declare<string>({
    name: 'performance-store-read',
    owner: 'performance',
    rank: 722,
    key: (key: string) => key,
    concurrency: 1,
    threshold: Duration.seconds(90),
    ceilings: {
      hold: Duration.minutes(15),
      wait: Duration.minutes(15),
      leaves: 'the report request may have reached the worker; its late answer is ignored',
    },
    external: { named: 'performance worker', callsBack: false },
  });

  let shed: Shed | undefined;
  const handedSheds = new Map<PendingBuffer, Array<Shed>>();
  const unrecorded = new Map<PerformanceRecordNotKeptReason, Account>();

  let state: PerformanceStoreDiagnostics['state'] = 'starting';
  let closed = false;
  let persistedDrops: number | null = null;
  const persistedDroppedKinds = new Map<PerformanceRecordKind, number>();
  let sessionDrops = 0;
  const sessionDroppedKinds = new Map<PerformanceRecordKind, number>();
  let uncertainRecords = 0;
  let unpersistedDrops = 0;
  const unpersistedDroppedKinds = new Map<PerformanceRecordKind, number>();
  const handedDrops = new Map<number, LossKindCounts>();
  let persistedRecords = 0;
  let maintenancePasses = 0;
  let evictedSegments = 0;
  let lastEvictionMs: number | null = null;
  let peakPendingBytes = 0;

  let activeCommands = 0;
  let lastError: string | null = null;

  const dropCount = () => (persistedDrops ?? 0) + sessionDrops;
  const isIdle = () => pending.size === 0 && unpersistedDrops === 0 && activeCommands === 0;

  const takeDrops = (command: number): { readonly droppedKinds: LossKindCounts } => {
    unpersistedDrops = 0;
    const droppedKinds = takeKindCounts(unpersistedDroppedKinds);
    handedDrops.set(command, droppedKinds);
    return { droppedKinds };
  };

  const returnDrops = () => {
    for (const droppedKinds of handedDrops.values()) {
      for (const count of Object.values(droppedKinds)) unpersistedDrops += count ?? 0;
      addKindCounts(unpersistedDroppedKinds, droppedKinds);
    }
    handedDrops.clear();
  };

  const settleFlushes = () => {
    if (!isIdle() && state !== 'unavailable') return;
    const settled = [...flushes];
    flushes.clear();
    for (const flush of settled) Deferred.doneUnsafe(flush, Effect.void);
  };

  const workerGone = (failure: string | WorkerUnavailable) => {
    if (state === 'unavailable') return;
    const message = typeof failure === 'string' ? failure : failure.message;
    state = 'unavailable';
    lastError = message;
    const notKept = new PerformanceRecordUnavailable({ reason: 'store-unavailable', message });
    for (const buffer of [...pending]) {
      if (buffer.state !== 'inflight') continue;
      uncertainRecords += buffer.records;
      handedSheds.delete(buffer);
      failDurables(buffer, notKept);
      pending.remove(buffer);
    }
    returnDrops();
    const error = Exit.fail(new PerformanceStoreUnavailable({ message, cause: typeof failure === 'string' ? undefined : failure }));
    commands.completeAll(error);
    reports.completeAll(error);
    workerMemoryReads.completeAll(error);
    settleFlushes();
  };

  const shutdown = (message: string) => {
    workerGone(message);
    if (closed) return;
    closed = true;
    const failedAt = Date.now();
    const cleared = new Map<PerformanceRecordKind, number>();
    for (const buffer of pending) {
      sessionDrops += buffer.records;
      for (const [kind, count] of buffer.kinds) {
        countKind(cleared, kind, count);
        countKind(sessionDroppedKinds, kind, count);
      }
      for (const handed of handedSheds.get(buffer) ?? []) {
        keepUnrecorded(unrecorded, 'pending-limit', handed.kinds, handed.wallTime);
      }
    }
    if (shed !== undefined) keepUnrecorded(unrecorded, 'pending-limit', shed.kinds, shed.wallTime);
    keepUnrecorded(unrecorded, 'store-unavailable', cleared, failedAt);
    pending.clear();
    retentionGroups.clear();
    shed = undefined;
    handedSheds.clear();
    unpersistedDrops = 0;
    unpersistedDroppedKinds.clear();
    durableSubmissions.completeAll(Exit.fail(new PerformanceRecordUnavailable({ reason: 'store-unavailable', message })));
    settleFlushes();
  };

  const failDurables = (buffer: PendingBuffer, failure: PerformanceRecordFailure) => {
    durableSubmissions.complete(buffer, Exit.fail(failure));
  };

  const countLoss = (buffer: PendingBuffer, heldBytes: number) => {
    const monotonic = performance.now();
    const open: Shed = (shed ??= {
      kinds: new Map(),
      wallTime: Date.now(),
      monotonicStart: monotonic,
      monotonicEnd: monotonic,
      peakPendingBytes: 0,
    });
    for (const returned of handedSheds.get(buffer) ?? []) {
      for (const [kind, count] of returned.kinds) open.kinds.set(kind, (open.kinds.get(kind) ?? 0) + count);
      open.wallTime = Math.min(open.wallTime, returned.wallTime);
      open.monotonicStart = Math.min(open.monotonicStart, returned.monotonicStart);
      open.peakPendingBytes = Math.max(open.peakPendingBytes, returned.peakPendingBytes);
    }
    handedSheds.delete(buffer);
    for (const [kind, count] of buffer.kinds) open.kinds.set(kind, (open.kinds.get(kind) ?? 0) + count);
    open.monotonicEnd = Math.max(open.monotonicEnd, monotonic);
    open.peakPendingBytes = Math.max(open.peakPendingBytes, heldBytes);
  };

  const drop = (buffer: PendingBuffer) => {
    const heldBytes = pending.bytes;
    sessionDrops += buffer.records;
    unpersistedDrops += buffer.records;
    for (const [kind, count] of buffer.kinds) {
      countKind(sessionDroppedKinds, kind, count);
      countKind(unpersistedDroppedKinds, kind, count);
    }
    countLoss(buffer, heldBytes);
    pending.remove(buffer);
    failDurables(
      buffer,
      new PerformanceRecordRefused({
        reason: 'pending-limit',
        message: 'the performance pending limit dropped the reading before durability was acknowledged',
      }),
    );
  };

  const enforceBound = (newest: PendingBuffer) => {
    while (pending.bytes > options.maxPendingBytes()) {
      const victim = pending.victim(newest);
      if (victim === undefined) return;
      drop(victim);
    }
  };

  const append = (submission: PerformanceSubmission): PendingBuffer => {
    const record = submission.record;
    const held = pendingClass(record.kind);
    let buffer = pending.opened(held);
    if (buffer === undefined) {
      buffer = pending.push(new PendingBuffer(nextSequence(), held));
      Queue.offerUnsafe(opened, undefined);
    }
    pending.append(buffer, recordLine(record, submission.retentionKey), record.kind, submission.retentionKey);
    if (pending.bytes > peakPendingBytes) peakPendingBytes = pending.bytes;
    return buffer;
  };

  const seal = (buffer: PendingBuffer) => {
    pending.seal(buffer);
    Queue.offerUnsafe(signal, undefined);
  };

  const sealOpen = () => {
    for (const held of ['span', 'rest'] as const) {
      const buffer = pending.opened(held);
      if (buffer !== undefined) pending.seal(buffer);
    }
  };

  const closeShed = () => {
    const window = shed;
    if (window === undefined || state === 'unavailable') return;
    if (pending.bytes > options.maxPendingBytes()) return;
    shed = undefined;
    const record: PerformanceRecord<'loss', LossPayload> = {
      id: randomUUID(),
      kind: 'loss',
      instanceId: options.instanceId,
      wallTime: window.wallTime,
      monotonicStart: window.monotonicStart,
      monotonicEnd: window.monotonicEnd,
      payload: {
        reason: 'pending-limit',
        kinds: Object.fromEntries(window.kinds),
        peakPendingBytes: window.peakPendingBytes,
      } satisfies LossPayload,
    };
    const buffer = append({ record, retentionKey: record.id, byteSize: recordByteSize(record) });
    const carried = handedSheds.get(buffer);
    if (carried === undefined) handedSheds.set(buffer, [window]);
    else carried.push(window);
  };

  const completeCommand = (command: number) => {
    commands.complete(command, Exit.void);
  };

  const handleResponse = (response: StoreAnswer) => {
    switch (response._tag) {
      case 'StoreReady':
        if (closed) return;
        if (persistedDrops === null) {
          persistedDrops = response.dropCount;
          persistedDroppedKinds.clear();
          addKindCounts(persistedDroppedKinds, response.droppedKinds);
        }
        state = 'ready';
        Queue.offerUnsafe(signal, undefined);
        return;
      case 'CommandDone':
      case 'RecordsAck':
        handedDrops.delete(response.sequence);
        completeCommand(response.sequence);
        return;
      case 'StoreMaintained':
        maintenancePasses += 1;
        handedDrops.delete(response.sequence);
        if (response.evicted > 0) {
          evictedSegments += response.evicted;
          lastEvictionMs = response.elapsedMs;
        }
        if (response.records > 0) {
          sessionDrops += response.records;
          addKindCounts(sessionDroppedKinds, response.droppedKinds);
        }
        completeCommand(response.sequence);
        return;
      case 'ReportDone':
        reports.complete(response.requestId, Exit.succeed({ _tag: 'WorkerFound', report: response.report }));
        return;
      case 'WorkerMemoryDone':
        workerMemoryReads.complete(response.requestId, Exit.succeed(response.reading));
        return;
      case 'ReportNotFound':
        reports.complete(response.requestId, Exit.succeed({ _tag: 'NotFound', query: response.query, meta: response.meta }));
        return;
      case 'ReportFailed':
        reports.complete(response.requestId, Exit.fail(new PerformanceStoreQueryFailed({ message: response.message })));
        return;
      case 'StoreUnavailable':
        link.end(response.message);
    }
  };

  const link = makeStoreWorker({
    worker,
    onResponse: handleResponse,
    onGone: workerGone,
    initialize: () => ({
      _tag: 'InitializeStore',
      path: options.path,
      instanceId: options.instanceId,
      maxStoredBytes: options.maxStoredBytes(),
      busyTimeoutMs: options.busyTimeoutMs,
      maxReportSamples: options.maxReportSamples,
    }),
    options: { commandTimeoutMs: options.commandTimeoutMs, openTimeoutMs: options.openTimeoutMs },
  });
  yield* Effect.forkScoped(link.run);
  const reportTimeout = Duration.millis(options.reportTimeoutMs ?? REPORT_TIMEOUT_MS);

  const stuck = (message: string) =>
    Effect.suspend(() => {
      link.end(message);
      return Effect.fail(new PerformanceStoreUnavailable({ message }));
    });

  const sendCommand = (request: WriteRecords | RecordDrops | MaintainStore, transfers?: ReadonlyArray<unknown>) => {
    activeCommands += 1;
    return commands.wait(request.sequence, link.send(request, transfers)).pipe(
      Effect.timeoutOrElse({
        duration: link.commandTimeout,
        orElse: () => stuck(`the performance worker did not answer ${request._tag} within its deadline`),
      }),
      Effect.ensuring(
        Effect.sync(() => {
          activeCommands -= 1;
          settleFlushes();
        }),
      ),
    );
  };

  const pump = Effect.gen(function* () {
    while (state !== 'unavailable') {
      closeShed();
      const buffer = pending.nextSealed();
      if (buffer !== undefined) {
        pending.post(buffer);
        const sequence = buffer.sequence;
        const records = buffer.take();
        yield* sendCommand(
          {
            _tag: 'WriteRecords',
            sequence,
            records,
            ...takeDrops(sequence),
            maxStoredBytes: options.maxStoredBytes(),
            protectedRetentionKeys: pending.protectedKeys,
          },
          [records],
        );
        persistedRecords += buffer.records;
        durableSubmissions.complete(buffer, Exit.void);
        handedSheds.delete(buffer);
        pending.remove(buffer);
        settleFlushes();
        continue;
      }
      if (unpersistedDrops > 0) {
        const drops = nextSequence();
        yield* sendCommand({ _tag: 'RecordDrops', sequence: drops, ...takeDrops(drops) });
        continue;
      }
      settleFlushes();
      break;
    }
  });

  const dispatch = Effect.gen(function* () {
    while (true) {
      yield* Queue.take(signal);
      yield* pump.pipe(Effect.catchCause((cause) => Effect.sync(() => workerGone(describeErrors(Cause.prettyErrors(cause))))));
    }
  });

  const flushInterval = Duration.millis(options.flushIntervalMs ?? FLUSH_INTERVAL_MS);
  const flushOnInterval = Effect.gen(function* () {
    while (true) {
      yield* Queue.take(opened);
      yield* Effect.sleep(flushInterval);
      sealOpen();
      Queue.offerUnsafe(signal, undefined);
    }
  }).pipe(Effect.withTracerEnabled(false));

  const maintainInterval = Duration.millis(options.maintainIntervalMs ?? MAINTAIN_INTERVAL_MS);
  const maintainOnClock = Effect.gen(function* () {
    while (true) {
      yield* Effect.sleep(maintainInterval);
      if (state !== 'ready') continue;
      yield* sendCommand({
        _tag: 'MaintainStore',
        sequence: nextSequence(),
        maxStoredBytes: options.maxStoredBytes(),
        protectedRetentionKeys: pending.protectedKeys,
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`performance store maintenance failed; the next tick retries: ${describeErrors(Cause.prettyErrors(cause))}`),
        ),
      );
    }
  }).pipe(Effect.withTracerEnabled(false));

  yield* Effect.forkScoped(dispatch);
  yield* Effect.forkScoped(flushOnInterval);
  yield* Effect.forkScoped(maintainOnClock);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      shutdown('performance store scope is closed');
      link.stop();
    }),
  );

  const openGroup = (retentionKey: string) => {
    if (retentionGroups.open(retentionKey)) pending.retain(retentionKey);
  };

  const closeGroup = (retentionKey: string) => {
    if (retentionGroups.close(retentionKey)) pending.release(retentionKey);
  };

  const submit = (submission: PerformanceSubmission) => {
    if (closed) {
      sessionDrops += 1;
      countKind(sessionDroppedKinds, submission.record.kind);
      keepUnrecorded(unrecorded, 'store-unavailable', new Map([[submission.record.kind, 1]]), Date.now());
      return;
    }
    const buffer = append(submission);
    enforceBound(buffer);
    closeShed();
    if (buffer.bytes >= FLUSH_BYTES || flushes.size > 0) seal(buffer);
  };

  const submitDurable = Effect.fnUntraced(
    function* (submission: PerformanceSubmission) {
      if (closed) {
        sessionDrops += 1;
        keepUnrecorded(unrecorded, 'store-unavailable', new Map([[submission.record.kind, 1]]), yield* Clock.currentTimeMillis);
        return yield* new PerformanceRecordUnavailable({
          reason: 'store-unavailable',
          message: lastError ?? 'performance store is unavailable',
        });
      }
      const buffer = append(submission);
      return yield* durableSubmissions.wait(
        buffer,
        Effect.sync(() => {
          enforceBound(buffer);
          closeShed();
          seal(buffer);
        }),
      );
    },
    (effect) => Effect.withTracerEnabled(effect, false),
  );

  const readWorkerMemory = (collect: boolean) =>
    Effect.suspend(() => {
      if (state === 'unavailable') {
        return Effect.fail(new PerformanceStoreUnavailable({ message: lastError ?? 'performance store is unavailable' }));
      }
      const requestId = randomUUID();
      return workerMemoryReads.wait(requestId, link.send({ _tag: 'ReadWorkerMemory', requestId, collect })).pipe(
        Effect.timeoutOrElse({
          duration: link.commandTimeout,
          orElse: () => stuck('the performance worker did not answer ReadWorkerMemory within its deadline'),
        }),
      );
    }).pipe(Effect.withTracerEnabled(false));

  const flush = Effect.suspend(() => {
    sealOpen();
    if (isIdle() || state === 'unavailable') return Effect.void;
    const cell = Deferred.makeUnsafe<void>();
    flushes.add(cell);
    Queue.offerUnsafe(signal, undefined);
    return Deferred.await(cell);
  }).pipe(Effect.withTracerEnabled(false));

  const pressure = (): StorePressure => {
    const reading: StorePressure = {
      state,
      pendingRecords: pending.size,
      pendingBytes: pending.bytes,
      peakPendingBytes,
      persistedRecords,
      droppedRecords: sessionDrops,
    };
    peakPendingBytes = pending.bytes;
    return reading;
  };

  const livePressureOnly = (reason: string): StoreReportRead => ({
    _tag: 'Found',
    report: {
      type: 'losses',
      inheritedDrops: persistedDrops,
      sessionDrops,
      inheritedDroppedKinds: persistedDrops === null ? null : asKindCounts(persistedDroppedKinds),
      sessionDroppedKinds: asKindCounts(sessionDroppedKinds),
      retainedRange: null,
      losses: [],
      next: null,
      pressure: {
        state,
        pendingRecords: pending.size,
        pendingBytes: pending.bytes,
        peakPendingBytes,
        persistedRecords,
        droppedRecords: sessionDrops,
      },
      unrecorded: readUnrecorded(unrecorded),
      evidence: { _tag: 'process-memory', reason },
    },
  });

  const read = (query: PerformanceStoreQuery): Effect.Effect<StoreReportRead, PerformanceStoreFailure> =>
    query.type === 'losses' && query.source === 'live'
      ? Effect.sync(() =>
          livePressureOnly(
            state === 'unavailable'
              ? (lastError ?? 'performance store is unavailable')
              : 'live evidence requested; retained loss windows were not read',
          ),
        ).pipe(Effect.withTracerEnabled(false))
      : readGate
          .hold(
            'sole',
            Effect.gen(function* () {
              if (state === 'unavailable') {
                const reason = lastError ?? 'performance store is unavailable';
                if (query.type === 'losses') return livePressureOnly(reason);
                return yield* new PerformanceStoreUnavailable({ message: reason });
              }
              const requestId = randomUUID();
              const result = yield* reports.wait(requestId, link.send({ _tag: 'ReadReport', requestId, query })).pipe(
                Effect.timeoutOrElse({
                  duration: reportTimeout,
                  orElse: () =>
                    Effect.fail(
                      new PerformanceReportUnavailable({
                        reason: 'timeout',
                        message: `the ${query.type} report did not answer within ${Duration.toMillis(reportTimeout)} ms`,
                      }),
                    ),
                }),
              );
              const meta = {
                inheritedDrops: persistedDrops,
                sessionDrops,
                inheritedDroppedKinds: persistedDrops === null ? null : asKindCounts(persistedDroppedKinds),
                sessionDroppedKinds: asKindCounts(sessionDroppedKinds),
              };
              if (result._tag === 'NotFound') {
                return { ...result, meta: { ...result.meta, ...meta } } satisfies StoreReportRead;
              }
              if (result.report.type === 'losses') {
                return {
                  _tag: 'Found',
                  report: {
                    ...result.report,
                    ...meta,
                    pressure: {
                      state,
                      pendingRecords: pending.size,
                      pendingBytes: pending.bytes,
                      peakPendingBytes,
                      persistedRecords,
                      droppedRecords: sessionDrops,
                    },
                    unrecorded: readUnrecorded(unrecorded),
                    evidence: { _tag: 'retained-and-live' },
                  },
                } satisfies StoreReportRead;
              }
              if (result.report.type === 'memory') {
                return {
                  _tag: 'Found',
                  report: {
                    ...result.report,
                    ...meta,
                    threads: [takeMemoryReading('main'), ...result.report.threads],
                    store: { pendingBytes: pending.bytes, pendingRecords: pending.size },
                  },
                } satisfies StoreReportRead;
              }
              return { _tag: 'Found', report: { ...result.report, ...meta } } satisfies StoreReportRead;
            }),
          )
          .pipe(
            Effect.catchTag('HoldStalled', (stall) =>
              Effect.fail(
                new PerformanceReportUnavailable({
                  reason: 'timeout',
                  message: `the ${query.type} report waited ${stall.waitedMs} ms for the store door`,
                }),
              ),
            ),
            Effect.catchTag('HoldCut', (cut) =>
              Effect.fail(
                new PerformanceReportUnavailable({
                  reason: 'timeout',
                  message: `the ${query.type} report held the store door ${cut.heldMs} ms; ${cut.leaves}`,
                }),
              ),
            ),
            Effect.withTracerEnabled(false),
          );

  return {
    store: PerformanceStore.of({
      openGroup,
      closeGroup,
      submit,
      submitDurable,
      readWorkerMemory,
      flush,
      pressure,
      diagnostics: () => ({
        state,
        path: options.path,
        restarts: link.restarts,
        activeGroups: retentionGroups.active,
        pendingBytes: pending.bytes,
        pendingRecords: pending.size,
        peakPendingBytes,
        dropCount: dropCount(),
        maintenancePasses,
        evictedSegments,
        lastEvictionMs,
        uncertainRecords,
        unrecorded: readUnrecorded(unrecorded),
        lastError,
      }),
    }),
    reader: PerformanceStoreReader.of({ read }),
  };
});

function unavailableServices(
  path: string,
  message: string,
): {
  readonly store: Context.Service.Shape<typeof PerformanceStore>;
  readonly reader: Context.Service.Shape<typeof PerformanceStoreReader>;
} {
  let dropCount = 0;
  const unrecorded = new Map<PerformanceRecordNotKeptReason, Account>();
  const lose = (submission: PerformanceSubmission) => {
    dropCount += 1;
    keepUnrecorded(unrecorded, 'store-unavailable', new Map([[submission.record.kind, 1]]), Date.now());
  };
  const error = new PerformanceStoreUnavailable({ message });
  return {
    store: PerformanceStore.of({
      openGroup: () => {},
      closeGroup: () => {},
      submit: lose,
      submitDurable: (submission) => {
        lose(submission);
        return Effect.fail(new PerformanceRecordUnavailable({ reason: 'store-unavailable', message }));
      },
      readWorkerMemory: () => Effect.fail(error),
      flush: Effect.void,
      pressure: () => ({
        state: 'unavailable',
        pendingRecords: 0,
        pendingBytes: 0,
        peakPendingBytes: 0,
        persistedRecords: 0,
        droppedRecords: dropCount,
      }),
      diagnostics: () => ({
        state: 'unavailable',
        path,
        restarts: 0,
        activeGroups: 0,
        pendingBytes: 0,
        pendingRecords: 0,
        peakPendingBytes: 0,
        dropCount,
        maintenancePasses: 0,
        evictedSegments: 0,
        lastEvictionMs: null,
        uncertainRecords: 0,
        unrecorded: readUnrecorded(unrecorded),
        lastError: message,
      }),
    }),
    reader: PerformanceStoreReader.of({
      read: (query) =>
        Effect.suspend(() => {
          if (query.type !== 'losses') return Effect.fail(error);
          const kinds = new Map<PerformanceRecordKind, number>();
          for (const account of unrecorded.values()) {
            for (const [kind, count] of account.kinds) countKind(kinds, kind, count);
          }
          return Effect.succeed({
            _tag: 'Found',
            report: {
              type: 'losses',
              inheritedDrops: null,
              sessionDrops: dropCount,
              inheritedDroppedKinds: null,
              sessionDroppedKinds: asKindCounts(kinds),
              retainedRange: null,
              losses: [],
              next: null,
              pressure: {
                state: 'unavailable',
                pendingRecords: 0,
                pendingBytes: 0,
                peakPendingBytes: 0,
                persistedRecords: 0,
                droppedRecords: dropCount,
              },
              unrecorded: readUnrecorded(unrecorded),
              evidence: { _tag: 'process-memory', reason: message },
            },
          } satisfies StoreReportRead);
        }).pipe(Effect.withTracerEnabled(false)),
    }),
  };
}
