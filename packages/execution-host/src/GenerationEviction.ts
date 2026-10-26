import { Clock, Data, Deferred, Duration, Effect, FileSystem, Option, Path, PlatformError } from 'effect';
import { RecordNameInvalid, recordFolder } from '@runlith/executions/recordFormat';
import { type ExecutionId, type Incarnation } from '@runlith/executions/protocol/execution';
import { ExecutionStore } from './store/ExecutionStore';
import type { RetiredLedgerEntry } from './store/records';
import type { GenerationReadLeases } from './GenerationReadLeases';
import {
  evictionDrainStep,
  ledgerSizeOf,
  selectGenerationVictims,
  RETAINED_GENERATION_LIMIT,
  RETAINED_RESERVE_DIVISOR,
  type GenerationSize,
  type SizedRetiredGeneration,
} from './GenerationRetention';

export type RetentionRoom = { readonly reserve: number; readonly available: number };

type EvictionSetup = {
  readonly records: string;
  readonly currentIncarnation: Incarnation;
  readonly readVolume: Effect.Effect<RetentionRoom | undefined>;
  readonly removeRetained: (incarnation: Incarnation, execution: ExecutionId) => Effect.Effect<void, PlatformError.PlatformError>;
  readonly leases: GenerationReadLeases;
  readonly availableMemory: Effect.Effect<number>;
};

class GenerationUnmeasured extends Data.TaggedError('GenerationUnmeasured')<{ readonly message: string }> {}

const MEMORY_SHARE = 1_024;

const PAGE_READ_TARGET_MS = 25;

const ROW_OVERHEAD_BYTES = 256;

const rowEnvelope = (widestId: number): number => ROW_OVERHEAD_BYTES + 4 * widestId;

type PageCapacity = {
  readonly available: number;
  readonly widestId: number;
  readonly previous: number | undefined;
  readonly elapsedMs: number;
};

const nextPageRows = (reading: PageCapacity): number => {
  const memoryRows = Math.floor(Math.max(0, reading.available) / MEMORY_SHARE / rowEnvelope(reading.widestId));
  const timedRows =
    reading.previous === undefined
      ? 1
      : Math.min(
          2 * reading.previous,
          reading.elapsedMs <= 0 ? 2 * reading.previous : Math.floor((reading.previous * PAGE_READ_TARGET_MS) / reading.elapsedMs),
        );
  return Math.max(1, Math.min(memoryRows, timedRows));
};

export const makeGenerationEviction = Effect.fnUntraced(function* (setup: EvictionSetup) {
  const { records, currentIncarnation, readVolume, removeRetained, leases, availableMemory } = setup;
  const store = yield* ExecutionStore;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  let pageRows: number | undefined;
  let elapsedMs = 0;
  let widestId = 0;

  const readPage = Effect.fnUntraced(function* (incarnation: Incarnation, after: number | undefined) {
    const available = yield* availableMemory;
    const limit = nextPageRows({ available, widestId, previous: pageRows, elapsedMs });
    const startedAt = yield* Clock.monotonicTimeNanos;
    const page = yield* store.generationExecutions(incarnation, after, limit);
    elapsedMs = Number((yield* Clock.monotonicTimeNanos) - startedAt) / 1_000_000;
    pageRows = limit;
    for (const execution of page.executions) widestId = Math.max(widestId, execution.length);
    return page;
  });

  const DRAIN_CEILING = Duration.seconds(30);

  const describeFailure = (operation: string, subject: string, failure: PlatformError.PlatformError): string =>
    `${operation} ${subject}: ${failure.reason._tag}`;

  const measureGeneration = Effect.fnUntraced(
    function* (incarnation: Incarnation, cap: number): Effect.fn.Return<GenerationSize, GenerationUnmeasured> {
      let bytes = 0;
      let after: number | undefined;
      do {
        const page = yield* readPage(incarnation, after).pipe(
          Effect.mapError((failure) => new GenerationUnmeasured({ message: `listing generation ${incarnation}: ${failure._tag}` })),
        );
        for (const execution of page.executions) {
          const folder = recordFolder(execution);
          if (folder instanceof RecordNameInvalid) return { _tag: 'Unknown', error: `invalid record name: ${execution}` };
          const pending = [path.join(records, folder)];
          while (pending.length > 0) {
            if (bytes > cap) return { _tag: 'Capped', bytes };
            const next = pending.pop()!;
            const info = yield* fs
              .stat(next)
              .pipe(Effect.mapError((failure) => new GenerationUnmeasured({ message: describeFailure('stat', next, failure) })));
            if (info.type === 'Directory') {
              const entries = yield* fs
                .readDirectory(next)
                .pipe(Effect.mapError((failure) => new GenerationUnmeasured({ message: describeFailure('readDirectory', next, failure) })));
              for (const entry of entries) pending.push(path.join(next, entry));
            } else if (info.type === 'File') {
              bytes += Number(info.size);
            }
          }
        }
        after = page.next;
      } while (after !== undefined);
      return { _tag: 'Measured', bytes };
    },
    Effect.catchTag('GenerationUnmeasured', (failure) => Effect.succeed<GenerationSize>({ _tag: 'Unknown', error: failure.message })),
  );

  const removeGenerationFiles = Effect.fnUntraced(function* (incarnation: Incarnation) {
    let after: number | undefined;
    do {
      const page = yield* readPage(incarnation, after);
      yield* Effect.forEach(page.executions, (execution) => removeRetained(incarnation, execution), { discard: true });
      after = page.next;
    } while (after !== undefined);
  });

  const evictRetired = Effect.fnUntraced(function* (incarnation: Incarnation) {
    yield* store.beginEviction(incarnation);
    const fence = yield* leases.fenceRetainedReads(incarnation);
    const startedAt = yield* Clock.currentTimeMillis;
    let step = evictionDrainStep({ readers: fence.readers, waitedMs: 0, ceilingMs: Duration.toMillis(DRAIN_CEILING) });
    if (step === 'await-drain' && fence.drained !== undefined) {
      const drained = yield* Effect.timeoutOption(Deferred.await(fence.drained), DRAIN_CEILING);
      const waitedMs = (yield* Clock.currentTimeMillis) - startedAt;
      step = evictionDrainStep({
        readers: Option.isSome(drained) ? 0 : fence.readers,
        waitedMs,
        ceilingMs: Duration.toMillis(DRAIN_CEILING),
      });
    }
    if (step === 'delete') {
      yield* removeGenerationFiles(incarnation);
      yield* store.evictGeneration(incarnation);
      leases.dropGenerationReads(incarnation);
      return 'removed' as const;
    }
    yield* Effect.logWarning(
      `retired generation ${incarnation} still has open reads after ${Duration.toMillis(DRAIN_CEILING)} ms; keeping reads fenced and leaving its eviction for a later pass`,
    );
    return 'blocked' as const;
  });

  const reclaimListed = Effect.fnUntraced(function* (generations: ReadonlyArray<RetiredLedgerEntry>) {
    while (true) {
      const oldest = yield* store.oldestGeneration();
      if (oldest === undefined || !oldest.evicting) break;
      if ((yield* evictRetired(oldest.incarnation)) === 'blocked') return;
    }
    const settled = generations.filter((generation) => !generation.evicting).sort((left, right) => left.incarnation - right.incarnation);
    const reading = yield* readVolume;
    const cap = reading === undefined ? Number.POSITIVE_INFINITY : reading.reserve / RETAINED_RESERVE_DIVISOR;
    const excess = Math.max(0, settled.length - RETAINED_GENERATION_LIMIT);
    for (const want of settled.slice(0, excess)) {
      const oldest = yield* store.oldestGeneration();
      if (oldest === undefined || oldest.incarnation !== want.incarnation) break;
      if ((yield* evictRetired(oldest.incarnation)) === 'blocked') return;
    }
    let pending: Array<SizedRetiredGeneration> = settled.slice(excess).map((generation) => ({
      incarnation: generation.incarnation,
      evicting: false,
      size: ledgerSizeOf(generation.bytes, generation.uncertain),
    }));
    while (true) {
      const selection = selectGenerationVictims(pending, currentIncarnation, reading?.reserve);
      const doomed = new Set(selection.victims);
      let deleted = false;
      while (true) {
        const oldest = yield* store.oldestGeneration();
        if (oldest === undefined || !doomed.has(oldest.incarnation)) break;
        if ((yield* evictRetired(oldest.incarnation)) === 'blocked') return;
        deleted = true;
        pending = pending.filter((generation) => generation.incarnation !== oldest.incarnation);
      }
      if (deleted) continue;
      const barrier = selection.unknownBarrier;
      if (barrier === undefined || reading?.reserve === undefined) break;
      const oldest = yield* store.oldestGeneration();
      if (oldest === undefined || oldest.incarnation !== barrier.incarnation) break;
      const sized = yield* measureGeneration(oldest.incarnation, cap);
      if (sized._tag === 'Unknown') {
        yield* Effect.logWarning(
          `the historical-byte budget was unmeasurable at generation ${oldest.incarnation} (${sized.error}) and is not enforced past it`,
        );
        break;
      }
      if (sized._tag === 'Capped') {
        if ((yield* evictRetired(oldest.incarnation)) === 'blocked') return;
        pending = pending.filter((generation) => generation.incarnation !== oldest.incarnation);
        continue;
      }
      yield* store.setGenerationBytes(oldest.incarnation, sized.bytes);
      pending = pending.map((generation) => (generation.incarnation === oldest.incarnation ? { ...generation, size: sized } : generation));
    }
    let pressured = reading;
    while (true) {
      if (pressured === undefined || pressured.available >= pressured.reserve) return;
      const oldest = yield* store.oldestGeneration();
      if (oldest === undefined) return;
      if ((yield* evictRetired(oldest.incarnation)) === 'blocked') return;
      pressured = yield* readVolume;
    }
  });

  return { reclaimListed };
});
