import { freemem } from 'node:os';
import { Clock, Deferred, Effect, FileSystem, Path, Semaphore, type PlatformError } from 'effect';
import type { CommandDeadline } from '@runlith/executions/protocol/command';
import type { ExecutionId, ExecutionRef, ExecutionState, Incarnation } from '@runlith/executions/protocol/execution';
import type { InputProfile } from '@runlith/executions/protocol/inputProfile';
import type { DisownReport, Disowned, KeptRecords } from '@runlith/executions/protocol/keep';
import type { NativeProcess } from '@runlith/executions/protocol/launch';
import type { Pace } from '@runlith/executions/protocol/pace';
import type { ByteCursor } from '@runlith/executions/protocol/record';
import type { SourceCompletion } from '@runlith/executions/protocol/call';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import type { EndingReceipt, ProcessWatchReading } from '@runlith/executions/protocol/stop';
import { makeSealedRecord, type SealedRecord } from '@runlith/executions/RecordFiles';
import type { RecordSeal } from '@runlith/executions/recordFormat';
import type { ReadFailure } from './ExecutionRecord';
import { ExecutionStore } from './store/ExecutionStore';
import type { IncarnationRecord } from './store/records';
import { ExecutionUnknown, ExecutionUnrecorded } from './executionFailures';
import { makeGenerationEviction, type RetentionRoom } from './GenerationEviction';
import { makeGenerationReadLeases } from './GenerationReadLeases';
import type { VolumeReader } from './RecordVolume';
import { makeRetainedRecordReads, sameRef, sealedRefusal, type ProfiledRead } from './RetainedRecordReads';

const VOLUME_RESERVE_SHARE = 20;
const KEPT_SHARE = 20;
const UNREAD_SHARE = 10;
const UNREAD_GRACE_NANOS = 5n * 60n * 1_000_000_000n;

type RecordMeasurement =
  | { readonly _tag: 'Measured'; readonly bytes: number }
  | { readonly _tag: 'Unmeasured'; readonly failure: PlatformError.PlatformError };

export type Shelving = {
  readonly ref: ExecutionRef;
  readonly directory: string;
  readonly seal: RecordSeal;
  readonly summary: ExecutionSummary;
  readonly state: ExecutionState;
  readonly process: NativeProcess;
  readonly receipt: EndingReceipt;
  readonly deadline: CommandDeadline | undefined;
  readonly processes: ProcessWatchReading | undefined;
  readonly pace: Pace | undefined;
  readonly owner: string | undefined;
  readonly scope: string | undefined;
  readonly sources: SourceCompletion;
};

type Released = Omit<Shelving, 'directory' | 'seal'> & {
  readonly record: SealedRecord;
  bytes: number | undefined;
  ledgered: number;
  readonly unreadUntil: bigint;
  readonly order: number;
};

class ReleaseOrder {
  private entries: Released[] = [];
  private positions = new Map<Released, number>();

  first(): Released | undefined {
    return this.entries[0];
  }

  add(entry: Released): void {
    const position = this.entries.length;
    this.entries.push(entry);
    this.positions.set(entry, position);
    this.reorder(position);
  }

  remove(entry: Released): void {
    const position = this.positions.get(entry);
    if (position === undefined) return;
    this.positions.delete(entry);
    const last = this.entries.pop()!;
    if (position === this.entries.length) return;
    this.entries[position] = last;
    this.positions.set(last, position);
    this.reorder(position);
  }

  private swap(left: number, right: number): void {
    const entry = this.entries[left]!;
    this.entries[left] = this.entries[right]!;
    this.entries[right] = entry;
    this.positions.set(this.entries[left]!, left);
    this.positions.set(entry, right);
  }

  private reorder(position: number): void {
    while (position > 0) {
      const parent = Math.floor((position - 1) / 2);
      if (this.entries[parent]!.order <= this.entries[position]!.order) break;
      this.swap(parent, position);
      position = parent;
    }
    for (;;) {
      const left = 2 * position + 1;
      if (left >= this.entries.length) return;
      const right = left + 1;
      const child = right < this.entries.length && this.entries[right]!.order < this.entries[left]!.order ? right : left;
      if (this.entries[position]!.order <= this.entries[child]!.order) return;
      this.swap(position, child);
      position = child;
    }
  }
}

export type ShelfInput = {
  readonly current: IncarnationRecord;
  readonly records: string;
  readonly chunkBytes: number;
  readonly pipeModes: InputProfile;
  readonly volumeOf: VolumeReader;
  readonly retired: (ref: ExecutionRef) => void;
  readonly inventoryWoken: Effect.Effect<void>;
};

type SealedReaders = { readonly reads: number; readonly drained: Deferred.Deferred<void> | undefined };

export const makeRecordShelf = Effect.fnUntraced(function* (options: ShelfInput) {
  const { current, records, chunkBytes, pipeModes, volumeOf, retired, inventoryWoken } = options;
  const store = yield* ExecutionStore;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const recordBytes = Effect.fnUntraced(function* (directory: string): Effect.fn.Return<number, PlatformError.PlatformError> {
    let bytes = 0;
    const pending = [directory];
    while (pending.length > 0) {
      const next = pending.pop()!;
      const info = yield* fs.stat(next);
      if (info.type === 'Directory') {
        const entries = yield* fs.readDirectory(next);
        for (const entry of entries) pending.push(path.join(next, entry));
      } else if (info.type === 'File') {
        bytes += Number(info.size);
      }
    }
    return bytes;
  });
  const measure = (directory: string): Effect.Effect<RecordMeasurement> =>
    recordBytes(directory).pipe(
      Effect.match({
        onSuccess: (bytes): RecordMeasurement => ({ _tag: 'Measured', bytes }),
        onFailure: (failure): RecordMeasurement => ({ _tag: 'Unmeasured', failure }),
      }),
    );
  const ledger = Effect.fnUntraced(function* (bytes: number): Effect.fn.Return<number> {
    const noted = yield* Effect.result(store.sealRecordBytes(current.incarnation, bytes));
    if (noted._tag === 'Success') return bytes;
    yield* Effect.logWarning(
      `the byte ledger was not updated for generation ${current.incarnation}: ${noted.failure._tag}; leaving pending intent for lazy repair`,
    );
    return 0;
  });
  const released = new Map<ExecutionId, Released>();
  const unread = new Map<ExecutionId, Released>();
  const unsized = new Set<Released>();
  const delivered = new ReleaseOrder();
  let releaseOrder = 0;
  const releasing = new Map<ExecutionId, Deferred.Deferred<void>>();
  const sealedReads = new Map<ExecutionId, SealedReaders>();
  const shelf = yield* Semaphore.make(1);
  const evicting = yield* Semaphore.make(1);
  let keptBytes = 0;
  const disownedOwners = new Set<string>();
  const disownedScopes = new Set<string>();
  let volume: RetentionRoom | undefined;

  const readLeases = makeGenerationReadLeases();

  const retainedReads = yield* makeRetainedRecordReads({
    current,
    records,
    chunkBytes,
    pipeModes,
    leases: readLeases,
  });

  const readVolume = Effect.map(volumeOf(records), (read) => {
    volume = read === undefined ? undefined : { reserve: Math.floor(read.total / VOLUME_RESERVE_SHARE), available: read.available };
    return volume;
  });

  const generationEviction = yield* makeGenerationEviction({
    records,
    currentIncarnation: current.incarnation,
    readVolume,
    removeRetained: (incarnation: Incarnation, execution: ExecutionId) => retainedReads.remove(incarnation, execution),
    leases: readLeases,
    availableMemory: Effect.sync(freemem),
  });

  let exhausted = false;

  const reclaimPass = Effect.flatMap(store.retiredLedger(), (generations) => generationEviction.reclaimListed(generations)).pipe(
    Effect.withSpan('Host.evictGenerations'),
    Effect.as(true),
    Effect.catch((failure) =>
      Effect.as(Effect.logWarning('the retired generations over the volume reserve were not evicted', failure), false),
    ),
  );

  const settle = (passed: boolean) =>
    Effect.map(readVolume, (after) => {
      exhausted = passed && after !== undefined && after.available < after.reserve;
      return after;
    });

  const evictGenerations = evicting.withPermits(1)(Effect.flatMap(reclaimPass, settle));

  const relieve = Effect.flatMap(readVolume, (measured) => {
    if (measured === undefined || measured.available >= measured.reserve) {
      exhausted = false;
      return Effect.succeed(measured);
    }
    return exhausted
      ? Effect.succeed(measured)
      : evicting.withPermits(1)(Effect.suspend(() => (exhausted ? readVolume : Effect.flatMap(reclaimPass, settle))));
  });

  const disownedOf = (entry: Released): boolean =>
    (entry.owner !== undefined && disownedOwners.has(entry.owner)) || (entry.scope !== undefined && disownedScopes.has(entry.scope));

  const dropReleased = Effect.fn('Host.evict')(function* (entry: Released): Effect.fn.Return<void, ExecutionUnrecorded> {
    yield* Effect.annotateCurrentSpan({ executionId: entry.ref.execution, bytes: entry.bytes ?? 'unmeasured' });
    const execution = entry.ref.execution;
    yield* store
      .noteRecordPending(entry.ref.incarnation)
      .pipe(
        Effect.mapError((failure) => new ExecutionUnrecorded({ execution, reason: `the retirement was not recorded: ${failure._tag}` })),
      );
    yield* store
      .recordState({ ...entry.state, record: 'unavailable' }, entry.process)
      .pipe(
        Effect.mapError((failure) => new ExecutionUnrecorded({ execution, reason: `the retirement was not recorded: ${failure._tag}` })),
      );
    yield* store
      .recordFinal({ ...entry.receipt, sources: entry.sources, retention: 'lost' })
      .pipe(
        Effect.mapError((failure) => new ExecutionUnrecorded({ execution, reason: `the retirement was not recorded: ${failure._tag}` })),
      );
    released.delete(execution);
    unread.delete(execution);
    unsized.delete(entry);
    delivered.remove(entry);
    keptBytes -= entry.bytes ?? 0;
    retired(entry.ref);
    yield* inventoryWoken;
  });

  const removeKept = Effect.fnUntraced(function* (entry: Released): Effect.fn.Return<void> {
    const execution = entry.ref.execution;
    yield* Effect.suspend(() => {
      const standing = sealedReads.get(execution);
      if (standing === undefined) return Effect.void;
      const drained = standing.drained ?? Deferred.makeUnsafe<void>();
      sealedReads.set(execution, { ...standing, drained });
      return Deferred.await(drained);
    });
    const removed = yield* fs.remove(entry.record.directory, { recursive: true, force: true }).pipe(
      Effect.as(true),
      Effect.catchTag('PlatformError', (failure) =>
        Effect.as(Effect.logWarning(`the record of ${execution} was not removed; its bytes stay counted`, failure), false),
      ),
    );
    if (!removed) return;
    yield* Effect.ignore(store.releaseRecordBytes(entry.ref.incarnation, entry.ledgered));
  });

  const retire = (entry: Released): Effect.Effect<boolean> =>
    dropReleased(entry).pipe(
      Effect.as(true),
      Effect.catchTag('ExecutionUnrecorded', (failure) =>
        Effect.as(Effect.logWarning(`the retirement of ${entry.ref.execution} stays unrecorded; its record stays shelved`, failure), false),
      ),
    );

  const evictOver = Effect.fnUntraced(function* (reading: RetentionRoom | undefined): Effect.fn.Return<ReadonlyArray<Released>> {
    const evicted: Released[] = [];
    if (reading === undefined) return evicted;
    for (const entry of [...unsized]) {
      const measurement = yield* measure(entry.record.directory);
      if (measurement._tag === 'Unmeasured') continue;
      entry.bytes = measurement.bytes;
      entry.ledgered = yield* ledger(measurement.bytes);
      keptBytes += measurement.bytes;
      unsized.delete(entry);
    }
    const short = reading.available < reading.reserve;
    const excess = keptBytes - reading.available / KEPT_SHARE;
    if (excess <= 0 && !(short && unsized.size > 0)) return evicted;
    const critical = keptBytes - reading.available / UNREAD_SHARE;
    const now = yield* Clock.monotonicTimeNanos;
    let freed = 0;
    const readingEntries: Released[] = [];
    try {
      for (const entry of short ? [...unsized] : []) {
        if (sealedReads.has(entry.ref.execution) || (unread.has(entry.ref.execution) && now < entry.unreadUntil)) continue;
        if (!(yield* retire(entry))) return evicted;
        evicted.push(entry);
      }
      while (freed < excess) {
        const entry = delivered.first();
        if (entry === undefined) break;
        if (sealedReads.has(entry.ref.execution)) {
          delivered.remove(entry);
          readingEntries.push(entry);
          continue;
        }
        if (!(yield* retire(entry))) return evicted;
        freed += entry.bytes ?? 0;
        evicted.push(entry);
      }
      for (const entry of unread.values()) {
        if (freed >= excess || now < entry.unreadUntil) break;
        if (sealedReads.has(entry.ref.execution)) continue;
        if (!(yield* retire(entry))) return evicted;
        freed += entry.bytes ?? 0;
        evicted.push(entry);
      }
      for (const entry of unread.values()) {
        if (freed >= critical) break;
        if (sealedReads.has(entry.ref.execution)) continue;
        if (!(yield* retire(entry))) return evicted;
        freed += entry.bytes ?? 0;
        evicted.push(entry);
      }
      return evicted;
    } finally {
      for (const entry of readingEntries) delivered.add(entry);
    }
  });

  const shelve = (seal: Effect.Effect<Shelving>, handover: Effect.Effect<void>): Effect.Effect<boolean> =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const { directory, seal: sealed, ...facts } = yield* seal;
        const measurement = yield* measure(directory);
        const bytes = measurement._tag === 'Measured' ? measurement.bytes : undefined;
        yield* shelf.withPermits(1)(
          Effect.gen(function* () {
            if (bytes === undefined) {
              yield* Effect.logWarning(
                `the record of ${facts.ref.execution} could not be measured; the next release of a command measures it again`,
                measurement,
              );
            }
            const ledgered = bytes === undefined ? 0 : yield* ledger(bytes);
            const entry: Released = {
              ...facts,
              record: yield* makeSealedRecord({ directory, seal: sealed }).pipe(
                Effect.provideService(FileSystem.FileSystem, fs),
                Effect.provideService(Path.Path, path),
              ),
              bytes,
              ledgered,
              unreadUntil: (yield* Clock.monotonicTimeNanos) + UNREAD_GRACE_NANOS,
              order: releaseOrder++,
            };
            released.set(entry.ref.execution, entry);
            unread.set(entry.ref.execution, entry);
            if (bytes === undefined) unsized.add(entry);
            keptBytes += bytes ?? 0;
            const unwanted = disownedOf(entry) && (yield* retire(entry));
            if (unwanted) {
              yield* handover;
              yield* removeKept(entry);
            }
            const guarded = yield* evictOver(yield* relieve);
            if (!unwanted) yield* handover;
            yield* inventoryWoken;
            yield* Effect.forEach(guarded, removeKept, { discard: true });
          }),
        );
        return true;
      }),
    );

  const release = (
    execution: ExecutionId,
    fence: Effect.Effect<boolean>,
    seal: Effect.Effect<Shelving>,
    handover: Effect.Effect<void>,
  ): Effect.Effect<boolean> =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        if (releasing.has(execution)) return undefined;
        const gate = Deferred.makeUnsafe<void>();
        releasing.set(execution, gate);
        return gate;
      }),
      (gate) =>
        gate === undefined
          ? Effect.succeed(false)
          : Effect.flatMap(fence, (ready) =>
              ready
                ? shelve(seal, handover).pipe(Effect.withSpan('Host.release', { attributes: { executionId: execution } }))
                : Effect.succeed(false),
            ),
      (gate) =>
        gate === undefined
          ? Effect.void
          : Effect.suspend(() => {
              releasing.delete(execution);
              return Deferred.succeed(gate, undefined);
            }),
    );

  const drop = (execution: ExecutionId): Effect.Effect<ExecutionRef | undefined, ExecutionUnrecorded> =>
    shelf.withPermits(1)(
      Effect.gen(function* () {
        const entry = released.get(execution);
        if (entry === undefined) return undefined;
        yield* dropReleased(entry);
        yield* removeKept(entry);
        return entry.ref;
      }),
    );

  const disown = Effect.fnUntraced(function* (disowned: Disowned): Effect.fn.Return<DisownReport> {
    const dropped = yield* shelf.withPermits(1)(
      Effect.gen(function* () {
        if (disowned.owner !== undefined) disownedOwners.add(disowned.owner);
        if (disowned.scope !== undefined) disownedScopes.add(disowned.scope);
        const gone: Released[] = [];
        for (const entry of [...released.values()].filter(disownedOf)) if (yield* retire(entry)) gone.push(entry);
        yield* Effect.forEach(gone, removeKept, { discard: true });
        return gone;
      }),
    );
    return { retired: dropped.length } satisfies DisownReport;
  });

  const sealedRead = (cursor: ByteCursor, limit: number): Effect.Effect<ProfiledRead, ExecutionUnknown | ReadFailure> =>
    Effect.acquireUseRelease(
      Effect.suspend((): Effect.Effect<Released, ExecutionUnknown> => {
        const execution = cursor.ref.execution;
        const entry = released.get(execution);
        if (entry === undefined) return Effect.fail(new ExecutionUnknown({ execution }));
        const standing = sealedReads.get(execution);
        sealedReads.set(execution, { reads: (standing?.reads ?? 0) + 1, drained: standing?.drained });
        return Effect.succeed(entry);
      }),
      (entry) =>
        entry.record.read(cursor, Math.min(limit, chunkBytes)).pipe(
          Effect.mapError(sealedRefusal(cursor, entry.state.transport)),
          Effect.map((read) => {
            if (unread.delete(entry.ref.execution)) delivered.add(entry);
            return { ...read, modes: pipeModes };
          }),
        ),
      (entry) =>
        Effect.suspend(() => {
          const execution = entry.ref.execution;
          const now = sealedReads.get(execution);
          if (now === undefined) return Effect.void;
          if (now.reads > 1) {
            sealedReads.set(execution, { ...now, reads: now.reads - 1 });
            return Effect.void;
          }
          sealedReads.delete(execution);
          return now.drained === undefined ? Effect.void : Effect.asVoid(Deferred.succeed(now.drained, undefined));
        }),
    );

  const read = (cursor: ByteCursor, limit: number) =>
    Effect.suspend(() => {
      const kept = released.get(cursor.ref.execution);
      return kept !== undefined && sameRef(kept.ref, cursor.ref) ? sealedRead(cursor, limit) : retainedReads.read(cursor, limit);
    });

  const sealed = (execution: ExecutionId): Effect.Effect<boolean> =>
    Effect.suspend(() => {
      const gate = releasing.get(execution);
      return Effect.andThen(
        gate === undefined ? Effect.void : Deferred.await(gate),
        Effect.sync(() => released.has(execution)),
      );
    });

  const kept = (): KeptRecords => ({
    records: released.size,
    bytes: keptBytes,
    reserve: volume === undefined ? undefined : volume.reserve,
    available: volume === undefined ? undefined : volume.available,
  });

  yield* Effect.gen(function* () {
    const ledger = yield* store.retiredLedger();
    yield* Effect.forEach(
      ledger,
      (generation) => (generation.evicting ? Effect.asVoid(readLeases.fenceRetainedReads(generation.incarnation)) : Effect.void),
      { discard: true },
    );
  });

  return {
    get: (execution: ExecutionId): Released | undefined => released.get(execution),
    has: (execution: ExecutionId): boolean => released.has(execution),
    gate: (execution: ExecutionId): Deferred.Deferred<void> | undefined => releasing.get(execution),
    release,
    drop,
    disown,
    read,
    sealed,
    kept,
    retained: retainedReads.evidence,
    positions: retainedReads.positions,
    evictGenerations,
  };
});
