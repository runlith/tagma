import { freemem } from 'node:os';
import { Clock, Deferred, Effect, FileSystem, Path, Queue, Semaphore } from 'effect';
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
import { INHERITED_PAGE, makeInheritedRecords } from './InheritedRecords';
import { makeRecordMeasure } from './RecordMeasure';
import type { VolumeReader } from './RecordVolume';
import { makeRetainedRecordReads, sameRef, sealedRefusal, type ProfiledRead } from './RetainedRecordReads';

const VOLUME_RESERVE_SHARE = 20;
const KEPT_SHARE = 20;
const UNREAD_SHARE = 10;
const UNREAD_GRACE_NANOS = 5n * 60n * 1_000_000_000n;

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
  readonly live: (execution: ExecutionId) => boolean;
  readonly inventoryWoken: Effect.Effect<void>;
};

type SealedReaders = { readonly reads: number; readonly drained: Deferred.Deferred<void> | undefined };

export const makeRecordShelf = Effect.fnUntraced(function* (options: ShelfInput) {
  const { current, records, chunkBytes, pipeModes, volumeOf, retired, live, inventoryWoken } = options;
  const store = yield* ExecutionStore;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const measure = yield* makeRecordMeasure();
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
  const reclaims = yield* Queue.sliding<void>(1);
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

  let inheritedPending = false;

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
  let reclaiming = true;

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

  const evictGenerations = Effect.forever(
    Effect.gen(function* () {
      yield* Effect.flatMap(reclaimPass, settle);
      reclaiming = false;
      yield* Queue.take(reclaims);
    }),
  );

  const relieve = Effect.map(readVolume, (measured) => {
    if (measured === undefined || measured.available >= measured.reserve) {
      exhausted = false;
    } else if (!exhausted && !reclaiming) {
      reclaiming = true;
      Queue.offerUnsafe(reclaims, undefined);
    }
    return measured;
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
      .beginRemoval(entry.ref, entry.ledgered)
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

  const readsDrained = (execution: ExecutionId): Effect.Effect<void> =>
    Effect.suspend(() => {
      const standing = sealedReads.get(execution);
      if (standing === undefined) return Effect.void;
      const drained = standing.drained ?? Deferred.makeUnsafe<void>();
      sealedReads.set(execution, { ...standing, drained });
      return Deferred.await(drained);
    });

  const removalEnded = Effect.fnUntraced(function* (execution: ExecutionId): Effect.fn.Return<void> {
    const ended = yield* Effect.result(store.endRemoval(execution));
    if (ended._tag === 'Failure') {
      yield* Effect.logWarning(`the finished removal of ${execution} stays listed; the next logic finishes it again`, ended.failure);
    }
  });

  const finishRemoval = Effect.fnUntraced(function* (ref: ExecutionRef): Effect.fn.Return<boolean> {
    yield* readsDrained(ref.execution);
    const removed = yield* retainedReads.remove(ref.incarnation, ref.execution).pipe(
      Effect.as(true),
      Effect.catchTag('PlatformError', (failure) =>
        Effect.as(Effect.logWarning(`the retired record of ${ref.execution} was not removed; its removal stays listed`, failure), false),
      ),
    );
    if (!removed) return false;
    yield* removalEnded(ref.execution);
    return true;
  });

  const inherited = yield* makeInheritedRecords({
    current,
    records,
    measure,
    kept: (execution) => released.has(execution) || releasing.has(execution) || live(execution),
    finishRemoval,
  });

  const removeKept = Effect.fnUntraced(function* (entry: Released): Effect.fn.Return<void> {
    const execution = entry.ref.execution;
    yield* readsDrained(execution);
    const removed = yield* fs.remove(entry.record.directory, { recursive: true, force: true }).pipe(
      Effect.as(true),
      Effect.catchTag('PlatformError', (failure) =>
        Effect.as(Effect.logWarning(`the record of ${execution} was not removed; its bytes stay counted`, failure), false),
      ),
    );
    if (!removed) {
      inherited.retryRemoval(execution, entry.ledgered);
      return;
    }
    yield* removalEnded(execution);
  });

  const retire = (entry: Released): Effect.Effect<boolean> =>
    dropReleased(entry).pipe(
      Effect.as(true),
      Effect.catchTag('ExecutionUnrecorded', (failure) =>
        Effect.as(Effect.logWarning(`the retirement of ${entry.ref.execution} stays unrecorded; its record stays shelved`, failure), false),
      ),
    );

  const evictOver = Effect.fnUntraced(function* (reading: RetentionRoom | undefined): Effect.fn.Return<ReadonlyArray<Effect.Effect<void>>> {
    const removals: Array<Effect.Effect<void>> = [];
    inheritedPending = false;
    yield* inherited.finishUnfinished();
    if (reading === undefined) return removals;
    for (const entry of [...unsized]) {
      const measurement = yield* measure(entry.record.directory);
      if (measurement._tag === 'Unmeasured') continue;
      entry.bytes = measurement.bytes;
      entry.ledgered = yield* ledger(measurement.bytes);
      keptBytes += measurement.bytes;
      unsized.delete(entry);
    }
    const short = reading.available < reading.reserve;
    let excess = keptBytes + inherited.bytes() - reading.available / KEPT_SHARE;
    if (excess <= 0 && !(short && unsized.size > 0)) return removals;
    let critical = keptBytes + inherited.bytes() - reading.available / UNREAD_SHARE;
    const now = yield* Clock.monotonicTimeNanos;
    let freed = 0;
    const readingEntries: Released[] = [];
    const evict = (entry: Released) =>
      Effect.map(retire(entry), (retired) => {
        if (!retired) return false;
        freed += entry.bytes ?? 0;
        removals.push(removeKept(entry));
        return true;
      });
    try {
      for (const entry of short ? [...unsized] : []) {
        if (sealedReads.has(entry.ref.execution) || (unread.has(entry.ref.execution) && now < entry.unreadUntil)) continue;
        if (!(yield* evict(entry))) return removals;
      }
      inherited.resume();
      for (let taken = 0; freed < excess; taken++) {
        if (taken === INHERITED_PAGE) {
          inheritedPending = true;
          return removals;
        }
        const next = yield* inherited.next();
        if (next === undefined) {
          const residue = inherited.settle();
          excess -= residue;
          critical -= residue;
          break;
        }
        if (!(yield* inherited.evict(next))) return removals;
        freed += next.bytes;
      }
      while (freed < excess) {
        const entry = delivered.first();
        if (entry === undefined) break;
        if (sealedReads.has(entry.ref.execution)) {
          delivered.remove(entry);
          readingEntries.push(entry);
          continue;
        }
        if (!(yield* evict(entry))) return removals;
      }
      for (const entry of unread.values()) {
        if (freed >= excess || now < entry.unreadUntil) break;
        if (sealedReads.has(entry.ref.execution)) continue;
        if (!(yield* evict(entry))) return removals;
      }
      for (const entry of unread.values()) {
        if (freed >= critical) break;
        if (sealedReads.has(entry.ref.execution)) continue;
        if (!(yield* evict(entry))) return removals;
      }
      return removals;
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
            yield* Effect.all(guarded, { discard: true });
          }),
        );
        return true;
      }),
    );

  const evictKept = Effect.gen(function* () {
    for (;;) {
      const pending = yield* shelf.withPermits(1)(
        Effect.gen(function* () {
          yield* Effect.all(yield* evictOver(yield* relieve), { discard: true });
          return inheritedPending;
        }),
      );
      if (!pending) return;
    }
  }).pipe(Effect.withSpan('Host.evictKept'));

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

  const readStarted = (execution: ExecutionId): void => {
    const standing = sealedReads.get(execution);
    sealedReads.set(execution, { reads: (standing?.reads ?? 0) + 1, drained: standing?.drained });
  };

  const readEnded = (execution: ExecutionId): Effect.Effect<void> =>
    Effect.suspend(() => {
      const now = sealedReads.get(execution);
      if (now === undefined) return Effect.void;
      if (now.reads > 1) {
        sealedReads.set(execution, { ...now, reads: now.reads - 1 });
        return Effect.void;
      }
      sealedReads.delete(execution);
      return now.drained === undefined ? Effect.void : Effect.asVoid(Deferred.succeed(now.drained, undefined));
    });

  const sealedRead = (cursor: ByteCursor, limit: number): Effect.Effect<ProfiledRead, ExecutionUnknown | ReadFailure> =>
    Effect.acquireUseRelease(
      Effect.suspend((): Effect.Effect<Released, ExecutionUnknown> => {
        const execution = cursor.ref.execution;
        const entry = released.get(execution);
        if (entry === undefined) return Effect.fail(new ExecutionUnknown({ execution }));
        readStarted(execution);
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
      (entry) => readEnded(entry.ref.execution),
    );

  const read = (cursor: ByteCursor, limit: number) =>
    Effect.suspend(() => {
      const execution = cursor.ref.execution;
      const kept = released.get(execution);
      if (kept !== undefined && sameRef(kept.ref, cursor.ref)) return sealedRead(cursor, limit);
      if (cursor.ref.incarnation !== current.incarnation) return retainedReads.read(cursor, limit);
      return Effect.acquireUseRelease(
        Effect.sync(() => readStarted(execution)),
        () => retainedReads.read(cursor, limit),
        () => readEnded(execution),
      );
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
    bytes: keptBytes + inherited.bytes(),
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
    evictKept,
  };
});
