import { Data, Deferred, Effect, Exit, FileSystem, Path, Ref, Result, Scheduler, Scope, Semaphore } from 'effect';
import {
  CRC32_INITIAL,
  MAX_RECORD_OFFSET,
  crc32Final,
  crc32Update,
  gridBoundary,
  gridStanding,
  segmentFile,
  segmentPosition,
  streamsOf,
  type RecordSeal,
  type RecordWriteAction,
  type SealedSegment,
  type SealedStream,
} from '@runlith/executions/recordFormat';
import type { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import { type ExecutionRef, type RecordAvailability, type StreamEnding, type Transport } from '@runlith/executions/protocol/execution';
import {
  type ByteOffset,
  type Stream,
  byteOffset,
  offsetValue,
  sameGeometry,
  type ByteCursor,
  type GridEntry,
  type OutputFile,
  type RecordRange,
  type RecordTail,
  type StreamPositions,
  type TerminalGeometry,
} from '@runlith/executions/protocol/record';
import { RecordWriteFailed, makeRecordWriter, type RecordSegment, type RecordOptions } from './RecordWriter';
import { countGridEntry, countRetentionEvicted } from './hostTelemetry';

export class RecordOpenRefused extends Data.TaggedError('RecordOpenRefused')<{ readonly act: 'limits' | 'grid'; readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export class StreamMissing extends Data.TaggedError('StreamMissing')<{ readonly stream: Stream; readonly transport: string }> {
  override get message(): string {
    return `${this.transport} carries no ${this.stream} stream`;
  }
}

export type RecordRefusalReason =
  | { readonly _tag: 'Storage'; readonly detail: string }
  | { readonly _tag: 'Ended'; readonly detail: string }
  | { readonly _tag: 'Sealed'; readonly detail: string }
  | {
      readonly _tag: 'Saturated';
      readonly retainedFrom: ByteOffset;
      readonly parsedThrough: ByteOffset;
      readonly durableThrough: ByteOffset;
      readonly requested: number;
      readonly limit: number;
    }
  | { readonly _tag: 'Exhausted'; readonly durableThrough: ByteOffset };

export class RecordRefused extends Data.TaggedError('RecordRefused')<{
  readonly stream: Stream;
  readonly reason: RecordRefusalReason;
}> {
  override get message(): string {
    switch (this.reason._tag) {
      case 'Storage':
      case 'Ended':
      case 'Sealed':
        return `${this.stream}: ${this.reason.detail}`;
      case 'Saturated':
        return `${this.stream} cannot retain ${this.reason.requested} more bytes within ${this.reason.limit}`;
      case 'Exhausted':
        return `${this.stream} reached its last record offset at ${this.reason.durableThrough}`;
    }
  }
}

export class RecordChunkRefused extends Data.TaggedError('RecordChunkRefused')<{
  readonly stream: Stream;
  readonly requested: number;
  readonly limit: number;
}> {
  override get message(): string {
    return `${this.stream} chunk has ${this.requested} bytes, beyond its landing limit ${this.limit}`;
  }
}

export class RecordUnavailable extends Data.TaggedError('RecordUnavailable')<{
  readonly act: 'append' | 'read';
  readonly inFlight: number;
  readonly limit: number;
}> {
  override get message(): string {
    return `${this.act} has ${this.inFlight} acts in flight at its limit ${this.limit}`;
  }
}

export class FrontierRefused extends Data.TaggedError('FrontierRefused')<{
  readonly stream: Stream;
  readonly reason: 'behind' | 'ahead';
  readonly offered: ByteOffset;
  readonly parsedThrough: ByteOffset;
  readonly durableThrough: ByteOffset;
}> {
  override get message(): string {
    return `${this.stream} parsed frontier ${this.offered} is ${this.reason} of ${this.parsedThrough}..${this.durableThrough}`;
  }
}

export class CursorRefused extends Data.TaggedError('CursorRefused')<{
  readonly reason: 'ref' | 'ahead' | 'limit';
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export class RecordReadFailed extends Data.TaggedError('RecordReadFailed')<{
  readonly stream: Stream;
  readonly act: 'open' | 'read' | 'missing';
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export class CaptureStopped extends Data.TaggedError('CaptureStopped')<{ readonly stream: Stream }> {
  override get message(): string {
    return `${this.stream} capture has stopped`;
  }
}

export type AppendFailure = CaptureStopped | StreamMissing | RecordRefused | RecordUnavailable | RecordChunkRefused | RecordWriteFailed;
export type ReadFailure = StreamMissing | RecordRefused | RecordUnavailable | CursorRefused | RecordReadFailed;

export type RecordRead = {
  readonly bytes: Uint8Array;
  readonly range: RecordRange;
};

export type SealAnswer = {
  readonly seal: RecordSeal;
  readonly written: boolean;
  readonly detail: string | undefined;
};

type HandleCount = { open: number };

type OpenSegment = {
  readonly handle: FileSystem.File;
  readonly gate: Semaphore.Semaphore;
  readonly scope: Scope.Closeable;
  readonly counter: HandleCount;
  closed: boolean;
  users: number;
  idle: Deferred.Deferred<void> | undefined;
};

type RecordFailure = { readonly act: RecordWriteAction; readonly detail: string };

const CACHED_SEGMENTS = 1;

const OUTPUT = 'output' satisfies Stream;

type StreamState = {
  readonly stream: Stream;
  readonly retainedFrom: bigint;
  readonly durableThrough: bigint;
  readonly parsedThrough: bigint;
  readonly ending: StreamEnding;
  readonly segments: ReadonlyArray<RecordSegment>;
  readonly open: ReadonlyMap<bigint, OpenSegment>;
  readonly failure: RecordFailure | undefined;
  readonly appending: Deferred.Deferred<void> | undefined;
  readonly arriving: bigint | undefined;
  readonly retiringThrough: bigint | undefined;
  readonly grid: ReadonlyArray<GridEntry>;
  readonly advanced: Deferred.Deferred<void> | undefined;
  readonly drains: ReadonlyMap<symbol, bigint> | undefined;
  readonly waitingReader: boolean;
  readonly captureStopped: boolean;
  readonly room: Deferred.Deferred<void> | undefined;
};

type RecordState = {
  readonly streams: ReadonlyMap<Stream, StreamState>;
  readonly reads: number;
  readonly sealed: boolean;
  readonly mirrorsClosed: boolean;
  readonly interpreted: boolean;
};

type Taken = { readonly chunk: Uint8Array; readonly place: number | undefined };

type Opening = RecordOptions & {
  readonly mode: 'create' | 'reopen';
  readonly records: string;
  readonly ref: ExecutionRef;
  readonly transport: Transport;
  readonly limits: ExecutionLimits;
  readonly failed?: ReadonlyArray<Stream>;
};

export type RecordStanding = {
  readonly positions: StreamPositions;
  readonly grid: TerminalGeometry | undefined;
};

export const readerDescriptors = (limits: ExecutionLimits, transport: Transport): number =>
  limits.read.readers + streamsOf(transport).length * CACHED_SEGMENTS;

export const makeSegmentRecord = Effect.fnUntraced(function* (opening: Opening) {
  const { records, ref, transport, limits } = opening;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const refusal = unusableLimits(limits);
  if (refusal !== undefined) return yield* new RecordOpenRefused({ act: 'limits', detail: refusal });
  if (opening.mode === 'create' && transport === 'pty' && opening.grid === undefined) {
    return yield* new RecordOpenRefused({
      act: 'grid',
      detail: 'a terminal record names the grid its first byte is laid out at, and none was given',
    });
  }
  const writer = yield* makeRecordWriter(
    opening.mode === 'create'
      ? { mode: 'create', records, ref, transport, actMs: opening.actMs, grid: opening.grid, streaming: opening.streaming }
      : { mode: 'reopen', records, ref, transport, actMs: opening.actMs },
  );
  const streams = new Map<Stream, StreamState>();
  for (const held of writer.journal.snapshot.streams) {
    let segments: RecordSegment[];
    let through: bigint;
    let grid: ReadonlyArray<GridEntry>;
    let ending = held.ending;
    let failure: RecordFailure | undefined;
    if (opening.mode === 'create') {
      yield* writer.openSegment(held.stream, 0n);
      segments = [{ first: 0n, end: 0n, register: CRC32_INITIAL }];
      through = 0n;
      grid = held.grid;
    } else {
      segments = held.segments.map((segment) => ({
        first: offsetValue(segment.first),
        end: offsetValue(segment.end),
        register: crc32Final(segment.checksum),
      }));
      const first = offsetValue(held.segments.at(-1)?.end ?? held.retainedFrom);
      if (held.ending === 'open' && opening.failed?.includes(held.stream) === true) {
        segments.push({ first, end: first, register: CRC32_INITIAL });
        yield* writer.journalEntry({
          _tag: 'Closed',
          stream: held.stream,
          segment: { first: byteOffset(first), end: byteOffset(first), checksum: crc32Final(CRC32_INITIAL) },
          ending: 'error',
        });
        ending = 'error';
        failure = { act: 'segment', detail: 'the previous owner ended this stream in error at a frontier its journal does not hold' };
      } else if (held.ending === 'open') {
        segments.push(yield* writer.reopenSegment(held.stream, first, limits.output.segmentBytes, limits.output.landingBytes));
      }
      through = segments.at(-1)?.end ?? first;
      grid = settledTrack(held.grid, through);
      if (grid !== held.grid) yield* writer.journalEntry({ _tag: 'Grid', from: byteOffset(through), entry: grid.at(-1) });
    }
    streams.set(held.stream, {
      stream: held.stream,
      retainedFrom: offsetValue(held.retainedFrom),
      durableThrough: through,
      parsedThrough: offsetValue(held.retainedFrom),
      ending,
      segments,
      open: new Map(),
      failure,
      appending: undefined,
      arriving: undefined,
      retiringThrough: undefined,
      grid,
      advanced: undefined,
      drains: held.streaming === true ? new Map() : undefined,
      waitingReader: held.streaming === true,
      captureStopped: false,
      room: undefined,
    });
  }
  const state = yield* Ref.make<RecordState>({ streams, reads: 0, sealed: false, mirrorsClosed: false, interpreted: transport === 'pty' });
  const sealing = yield* Ref.make<Deferred.Deferred<SealAnswer> | undefined>(undefined);
  const gridding = yield* Semaphore.make(1);
  const reading: HandleCount = { open: 0 };
  let suspended = false;
  let settling: Deferred.Deferred<void> | undefined;
  let kept: OutputFile | undefined;
  const teeing = streams.has(OUTPUT);
  const turns = new Map<number, Deferred.Deferred<void>>();
  let issued = 0;
  let turn = 0;
  let drained: Deferred.Deferred<void> | undefined;

  const decide = <A, E>(
    stream: Stream,
    f: (held: StreamState, state: RecordState) => readonly [Effect.Effect<A, E>, StreamState],
  ): Effect.Effect<A, E | StreamMissing> =>
    Effect.flatten(
      Ref.modify(state, (current): readonly [Effect.Effect<A, E | StreamMissing>, RecordState] => {
        const held = current.streams.get(stream);
        if (held === undefined) return [new StreamMissing({ stream, transport }), current];
        const [answer, next] = f(held, current);
        return [answer, { ...current, streams: new Map(current.streams).set(stream, next) }];
      }),
    );

  const update = (stream: Stream, f: (held: StreamState) => StreamState): Effect.Effect<void> =>
    Ref.update(state, (current) => {
      const held = current.streams.get(stream);
      if (held === undefined) return current;
      return { ...current, streams: new Map(current.streams).set(stream, f(held)) };
    });

  const closeOpen = (entries: Iterable<OpenSegment>): Effect.Effect<void> =>
    Effect.forEach(
      entries,
      (entry) =>
        Effect.andThen(
          entry.idle === undefined ? Effect.void : Deferred.await(entry.idle),
          entry.gate.withPermits(1)(closeSegmentHandle(entry)),
        ),
      { discard: true },
    );

  const fence = (stream: Stream, failure: RecordFailure): Effect.Effect<void> =>
    update(stream, (held) =>
      held.failure === undefined ? { ...held, failure, grid: settledTrack(held.grid, held.durableThrough) } : held,
    );

  const storing = <A>(stream: Stream, act: Effect.Effect<A, RecordWriteFailed>): Effect.Effect<A, RecordWriteFailed> =>
    Effect.tapError(act, (failure) => fence(stream, { act: failure.act, detail: failure.detail }));

  const stopAppends = (): Effect.Effect<ReadonlyArray<Deferred.Deferred<void>>> =>
    Effect.flatten(
      Ref.modify(state, (current) => {
        const heldStreams = [...current.streams.values()];
        const appending = heldStreams.flatMap((held) => (held.appending === undefined ? [] : [held.appending]));
        return [Effect.as(Effect.forEach(heldStreams, roomOpened, { discard: true }), appending), { ...current, sealed: true }];
      }),
    );

  const finished = (stream: Stream): Effect.Effect<void> =>
    Effect.flatMap(
      Ref.modify(state, (current) => {
        const held = current.streams.get(stream);
        if (held === undefined) return [undefined, current] as const;
        return [
          held.appending,
          { ...current, streams: new Map(current.streams).set(stream, { ...held, appending: undefined, retiringThrough: undefined }) },
        ] as const;
      }),
      (appending) => (appending === undefined ? Effect.void : Effect.asVoid(Deferred.succeed(appending, undefined))),
    );

  const admit = (
    stream: Stream,
    length: number,
    capturing = false,
    mirroring = false,
  ): Effect.Effect<AppendPlan | Deferred.Deferred<void>, AppendFailure> =>
    decide<AppendPlan | Deferred.Deferred<void>, Exclude<AppendFailure, StreamMissing>>(stream, (held, current) => {
      if (capturing && held.captureStopped) return [new CaptureStopped({ stream }), held];
      if (mirroring ? current.mirrorsClosed : current.sealed) {
        return [new RecordRefused({ stream, reason: { _tag: 'Sealed', detail: 'the record is sealed' } }), held];
      }
      if (held.failure !== undefined) {
        return [new RecordRefused({ stream, reason: { _tag: 'Storage', detail: `${held.failure.act}: ${held.failure.detail}` } }), held];
      }
      if (held.ending !== 'open') {
        return [new RecordRefused({ stream, reason: { _tag: 'Ended', detail: `the stream ended: ${held.ending}` } }), held];
      }
      if (held.appending !== undefined) return [new RecordUnavailable({ act: 'append', inFlight: 1, limit: 1 }), held];
      if (length > limits.output.landingBytes)
        return [new RecordChunkRefused({ stream, requested: length, limit: limits.output.landingBytes }), held];
      const durable = held.durableThrough + BigInt(length);
      if (durable > MAX_RECORD_OFFSET) {
        return [new RecordRefused({ stream, reason: { _tag: 'Exhausted', durableThrough: byteOffset(held.durableThrough) } }), held];
      }
      const evicted = evictable(held, durable, BigInt(limits.output.retainedBytes), current.interpreted);
      if (evicted === undefined) {
        if (held.drains !== undefined) {
          const room = held.room ?? Deferred.makeUnsafe<void>();
          return [Effect.succeed(room), { ...held, room }];
        }
        return [
          new RecordRefused({
            stream,
            reason: {
              _tag: 'Saturated',
              retainedFrom: byteOffset(held.retainedFrom),
              parsedThrough: byteOffset(held.parsedThrough),
              durableThrough: byteOffset(held.durableThrough),
              requested: length,
              limit: limits.output.retainedBytes,
            },
          }),
          held,
        ];
      }
      const open = held.segments[held.segments.length - 1] as RecordSegment;
      const rolls = open.end - open.first + BigInt(length) > BigInt(limits.output.segmentBytes);
      const admitted: AppendPlan = {
        stream,
        evicted,
        rollAt: rolls ? held.durableThrough : undefined,
        first: open.first,
        confirmed: held.durableThrough,
      };
      return [
        evicted.length === 0 ? Effect.succeed(admitted) : Effect.andThen(countRetentionEvicted(evicted.length), Effect.succeed(admitted)),
        {
          ...held,
          appending: Deferred.makeUnsafe<void>(),
          retiringThrough: evicted.at(-1)?.end,
          arriving: laterOf(held.arriving, durable),
        },
      ];
    });

  const closedSegment = Effect.fnUntraced(function* (stream: Stream, ended: boolean) {
    const held = (yield* Ref.get(state)).streams.get(stream);
    const segment = held?.segments.at(-1);
    if (segment === undefined || held === undefined) return;
    yield* (ended ? writer.journalEntry : writer.capturing.journalEntry)({
      _tag: 'Closed',
      stream,
      segment: { first: byteOffset(segment.first), end: byteOffset(segment.end), checksum: crc32Final(segment.register) },
      ending: ended ? held.ending : undefined,
    });
  });

  const store = Effect.fnUntraced(function* (plan: AppendPlan, bytes: Uint8Array) {
    const { stream, confirmed } = plan;
    const written = BigInt(bytes.length);
    const register = (open: number) => crc32Update(open, bytes);
    for (const segment of plan.evicted) {
      yield* storing(stream, writer.capturing.journalEntry({ _tag: 'Retained', stream, from: byteOffset(segment.end) }));
      const dropped = yield* Ref.modify(state, (current) => {
        const open = liveOpen(current, stream);
        const entry = open?.get(segment.first);
        const kept = open === undefined ? undefined : new Map(open);
        kept?.delete(segment.first);
        const next = kept === undefined ? current : withOpen(current, stream, kept);
        const held = next.streams.get(stream);
        if (held === undefined) return [entry, next] as const;
        return [
          entry,
          {
            ...next,
            streams: new Map(next.streams).set(stream, {
              ...held,
              retainedFrom: segment.end,
              segments: held.segments.filter((candidate) => candidate.first !== segment.first),
              grid: retainedTrack(held.grid, segment.end),
            }),
          },
        ] as const;
      });
      if (dropped !== undefined) yield* closeOpen([dropped]);
      yield* storing(stream, writer.capturing.dropSegment(stream, segment.first));
    }
    let first = plan.first;
    if (plan.rollAt !== undefined) {
      yield* storing(stream, writer.capturing.closeSegment(stream));
      yield* storing(stream, closedSegment(stream, false));
      first = plan.rollAt;
      yield* update(stream, (held) => ({ ...held, segments: [...held.segments, { first, end: first, register: CRC32_INITIAL }] }));
      yield* storing(stream, writer.capturing.openSegment(stream, first));
    }
    const stored = yield* Effect.result(writer.capturing.append(stream, bytes));
    if (Result.isFailure(stored)) {
      const cut = yield* Effect.result(writer.capturing.truncateSegment(stream, confirmed - first));
      const detail = Result.isFailure(cut)
        ? `${stored.failure.detail}; the cut back also failed: ${cut.failure.detail}`
        : stored.failure.detail;
      yield* fence(stream, { act: stored.failure.act, detail });
      return yield* stored.failure;
    }
    yield* Effect.flatten(
      Ref.modify(state, (current) => {
        const held = current.streams.get(stream);
        if (held === undefined) return [Effect.void, current] as const;
        const next: StreamState = {
          ...held,
          durableThrough: held.durableThrough + written,
          arriving: held.arriving !== undefined && held.arriving > held.durableThrough + written ? held.arriving : undefined,
          segments: held.segments.map((segment, index) =>
            index === held.segments.length - 1 ? { ...segment, end: segment.end + written, register: register(segment.register) } : segment,
          ),
          advanced: undefined,
        };
        return [woken(held), { ...current, streams: new Map(current.streams).set(stream, next) }] as const;
      }),
    );
    return byteOffset(confirmed + written);
  });

  const land = (stream: Stream, bytes: Uint8Array, mirroring: boolean): Effect.Effect<ByteOffset, AppendFailure> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        for (;;) {
          const plan = yield* admit(stream, bytes.length, false, mirroring);
          if ('stream' in plan) return yield* store(plan, bytes).pipe(Effect.ensuring(finished(stream)));
          yield* restore(Deferred.await(plan));
        }
      }),
    );

  const append = (stream: Stream, bytes: Uint8Array): Effect.Effect<ByteOffset, AppendFailure> => land(stream, bytes, false);

  const receiving = (stream: Stream, bytes: number): Effect.Effect<void> =>
    update(stream, (held) => ({ ...held, arriving: laterOf(held.arriving, held.durableThrough + BigInt(bytes)) }));

  const awaitTurn = (place: number): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (place === turn) return Effect.void;
      const waiting = Deferred.makeUnsafe<void>();
      turns.set(place, waiting);
      return Deferred.await(waiting);
    });

  const passTurn = Effect.suspend(() => {
    turn += 1;
    const next = turns.get(turn);
    if (next !== undefined) turns.delete(turn);
    const idle = turn === issued ? drained : undefined;
    if (idle !== undefined) drained = undefined;
    return Effect.asVoid(
      Effect.andThen(
        next === undefined ? Effect.void : Deferred.succeed(next, undefined),
        idle === undefined ? Effect.void : Deferred.succeed(idle, undefined),
      ),
    );
  });

  const closeMirrors = Effect.gen(function* () {
    for (;;) {
      const waiting = yield* Ref.modify(state, (current) => {
        if (turn === issued) return [undefined, { ...current, mirrorsClosed: true }] as const;
        drained ??= Deferred.makeUnsafe<void>();
        return [drained, current] as const;
      });
      if (waiting === undefined) return;
      yield* Deferred.await(waiting);
    }
  });

  const broken = (failure: AppendFailure): Effect.Effect<void> => {
    const fenced = fence(OUTPUT, { act: failure._tag === 'RecordWriteFailed' ? failure.act : 'append', detail: failure.message });
    if (failure._tag === 'RecordRefused' && failure.reason._tag === 'Sealed') return fenced;
    return Effect.andThen(fenced, endOne(OUTPUT, 'error').pipe(Effect.catchTag('StreamMissing', () => Effect.void)));
  };

  const tee = (place: number, chunk: Uint8Array): Effect.Effect<void> =>
    Effect.andThen(awaitTurn(place), Effect.asVoid(land(OUTPUT, chunk, true))).pipe(Effect.catch(broken), Effect.ensuring(passTurn));

  const placed = <E, R>(read: Effect.Effect<Uint8Array | undefined, E, R>): Effect.Effect<Taken | undefined, E, R> =>
    Effect.provideService(
      Effect.map(read, (chunk) => (chunk === undefined ? undefined : { chunk, place: teeing ? issued++ : undefined })),
      Scheduler.PreventSchedulerYield,
      true,
    );

  const mirrored = <A, E>(taken: Taken, own: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    taken.place === undefined ? own : Effect.ensuring(own, tee(taken.place, taken.chunk));

  const capture = <E, R>(
    stream: Stream,
    maximum: number,
    read: Effect.Effect<Uint8Array | undefined, E, R>,
  ): Effect.Effect<Uint8Array | undefined, E | AppendFailure, R> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const streaming = yield* decide(stream, (held) => [Effect.succeed(held.drains !== undefined), held]);
        if (!streaming) {
          const taken = yield* placed(restore(read));
          if (taken !== undefined) {
            if (stream === 'pty') yield* receiving(stream, taken.chunk.length);
            yield* mirrored(taken, append(stream, taken.chunk));
          }
          return taken?.chunk;
        }
        for (;;) {
          const plan = yield* admit(stream, maximum, true);
          if (!('stream' in plan)) {
            yield* restore(Deferred.await(plan));
            continue;
          }
          return yield* Effect.gen(function* () {
            const taken = yield* placed(read);
            if (taken !== undefined) yield* mirrored(taken, store(plan, taken.chunk));
            return taken?.chunk;
          }).pipe(Effect.ensuring(finished(stream)));
        }
      }),
    );

  const stopCapture = (stream: Stream): Effect.Effect<void, StreamMissing> =>
    decide(stream, (held) => [roomOpened(held), { ...held, captureStopped: true, room: undefined }]);

  const follow = (stream: Stream, from: ByteOffset): Effect.Effect<symbol | undefined, StreamMissing | RecordUnavailable, Scope.Scope> => {
    const drain = Symbol();
    return Effect.acquireRelease(
      decide<symbol | undefined, RecordUnavailable>(stream, (held) => {
        if (held.drains === undefined) return [Effect.succeed(undefined), held];
        if (held.retiringThrough !== undefined && offsetValue(from) < held.retiringThrough) {
          return [new RecordUnavailable({ act: 'read', inFlight: 1, limit: 1 }), held];
        }
        return [
          Effect.andThen(roomOpened(held), Effect.succeed(drain)),
          { ...held, drains: new Map(held.drains).set(drain, offsetValue(from)), waitingReader: false, room: undefined },
        ];
      }),
      (drain) =>
        drain === undefined
          ? Effect.void
          : decide(stream, (held) => {
              const drains = new Map(held.drains);
              drains.delete(drain);
              return [roomOpened(held), { ...held, drains, room: undefined }];
            }).pipe(Effect.orDie),
    );
  };

  const advance = (stream: Stream, drain: symbol | undefined, through: ByteOffset): Effect.Effect<void, StreamMissing> => {
    if (drain === undefined) return Effect.void;
    return decide(stream, (held) => {
      if (!held.drains?.has(drain)) return [Effect.void, held];
      return [roomOpened(held), { ...held, drains: new Map(held.drains).set(drain, offsetValue(through)), room: undefined }];
    });
  };

  const acknowledgeParsed = (stream: Stream, through: ByteOffset): Effect.Effect<void, StreamMissing | FrontierRefused> => {
    const offered = offsetValue(through);
    return decide(stream, (held) => {
      if (offered < held.parsedThrough) return [frontier(held, 'behind', through), held];
      if (offered > held.durableThrough) return [frontier(held, 'ahead', through), held];
      return [Effect.void, { ...held, parsedThrough: offered }];
    });
  };

  const abandonInterpretation = (): Effect.Effect<void> => Ref.update(state, (current) => ({ ...current, interpreted: false }));

  const regrid = (geometry: TerminalGeometry): Effect.Effect<ByteOffset, RecordWriteFailed> =>
    gridding.withPermits(1)(
      Effect.uninterruptible(
        Effect.flatten(
          Ref.modify(state, (current): readonly [Effect.Effect<ByteOffset, RecordWriteFailed>, RecordState] => {
            const held = current.streams.get('pty');
            if (held === undefined) {
              const through = [...current.streams.values()].reduce((last, stream) => laterOf(last, stream.durableThrough), 0n);
              return [Effect.succeed(byteOffset(through)), current];
            }
            if (current.sealed) return [Effect.succeed(byteOffset(held.durableThrough)), current];
            const grid = regridded(held, geometry);
            if (grid === held.grid) return [Effect.succeed(grid.at(-1)?.at ?? byteOffset(held.durableThrough)), current];
            const entry = grid.length >= held.grid.length ? grid.at(-1) : undefined;
            const from = entry?.at ?? held.grid.at(-1)!.at;
            const stored = storing('pty', writer.journalEntry({ _tag: 'Grid', from, entry }));
            const notify = grid.length > held.grid.length ? Effect.andThen(woken(held), countGridEntry) : woken(held);
            return [
              Effect.as(Effect.andThen(stored, notify), grid.at(-1)?.at ?? byteOffset(held.durableThrough)),
              { ...current, streams: new Map(current.streams).set('pty', { ...held, grid, advanced: undefined }) },
            ];
          }),
        ),
      ),
    );

  const standing = (stream: Stream, position: bigint): Effect.Effect<RecordStanding, StreamMissing> =>
    decide(stream, (held) => [
      Effect.succeed({ positions: positionsOf(held), grid: gridStanding(held.grid, laterOf(position, held.retainedFrom)) }),
      held,
    ]);

  const closeEnded = Effect.fnUntraced(function* (
    stream: Stream,
    appending: Deferred.Deferred<void> | undefined,
    lent: ReadonlyMap<bigint, OpenSegment>,
  ) {
    yield* writer.hurry(stream);
    if (appending !== undefined) yield* Deferred.await(appending);
    const closed = yield* Effect.result(writer.closeSegment(stream));
    if (Result.isFailure(closed)) yield* fence(stream, { act: closed.failure.act, detail: closed.failure.detail });
    else {
      const journaled = yield* Effect.result(closedSegment(stream, true));
      if (Result.isFailure(journaled)) yield* fence(stream, { act: journaled.failure.act, detail: journaled.failure.detail });
    }
    yield* closeOpen(lent.values());
  }, Effect.uninterruptible);

  const endOne = (stream: Stream, ending: StreamEnding): Effect.Effect<void, StreamMissing> =>
    decide(stream, (held) =>
      held.ending === 'open'
        ? [
            Effect.andThen(Effect.andThen(woken(held), roomOpened(held)), closeEnded(stream, held.appending, held.open)),
            { ...held, ending, open: new Map(), advanced: undefined, room: undefined },
          ]
        : [Effect.void, held],
    );

  const keepOutput = Effect.fnUntraced(function* (rebuild: boolean) {
    const held = (yield* Ref.get(state)).streams.get(OUTPUT);
    if (held === undefined || held.ending !== 'eof' || held.failure !== undefined || held.durableThrough === held.retainedFrom) return;
    const standing = rebuild ? yield* Effect.result(writer.keptOutput) : undefined;
    if (standing !== undefined && Result.isFailure(standing)) {
      yield* Effect.logWarning(`the kept output of ${ref.execution} could not be looked up`, standing.failure);
      return;
    }
    const written =
      standing?.success === undefined
        ? yield* Effect.result(writer.keepOutput(held.segments, held.retainedFrom))
        : Result.succeed(standing.success);
    if (Result.isFailure(written)) {
      yield* Effect.logWarning(`the output of ${ref.execution} was not kept as a file`, written.failure);
      return;
    }
    kept = { path: written.success, from: byteOffset(held.retainedFrom), through: byteOffset(held.durableThrough) };
  }, Effect.uninterruptible);

  const settleOutput = Effect.flatten(
    Ref.modify(state, (current): readonly [Effect.Effect<void>, RecordState] => {
      const output = current.streams.get(OUTPUT);
      if (output === undefined) return [Effect.void, current];
      const sources = [...current.streams.values()].filter((held) => held.stream !== OUTPUT);
      if (sources.some((held) => held.ending === 'open')) return [Effect.void, current];
      if (settling !== undefined) return [Deferred.await(settling), current];
      if (output.ending !== 'open') return [Effect.void, current];
      const settled = Deferred.makeUnsafe<void>();
      settling = settled;
      return [
        endOne(OUTPUT, sources.some((held) => held.ending === 'error') ? 'error' : 'eof').pipe(
          Effect.catchTag('StreamMissing', () => Effect.void),
          Effect.andThen(keepOutput(false)),
          Effect.ensuring(Deferred.succeed(settled, undefined)),
        ),
        current,
      ];
    }),
  );

  const endStream = (stream: Stream, ending: StreamEnding): Effect.Effect<void, StreamMissing> =>
    stream === OUTPUT ? endOne(stream, ending) : Effect.andThen(endOne(stream, ending), settleOutput);

  const awaitBeyond = Effect.fnUntraced(function* (stream: Stream, beyond: bigint, grid: TerminalGeometry | undefined) {
    for (;;) {
      const waiting = yield* decide<Deferred.Deferred<void> | boolean, never>(stream, (held) => {
        if (held.durableThrough > beyond) return [Effect.succeed(true), held];
        if (!sameGeometry(gridStanding(held.grid, beyond), grid)) return [Effect.succeed(true), held];
        if (held.ending !== 'open' || held.failure !== undefined) return [Effect.succeed(false), held];
        const advanced = held.advanced ?? Deferred.makeUnsafe<void>();
        return [Effect.succeed(advanced), { ...held, advanced }];
      });
      if (typeof waiting === 'boolean') return waiting;
      yield* Deferred.await(waiting);
    }
  });

  const positions = (stream: Stream): Effect.Effect<StreamPositions, StreamMissing> =>
    Effect.flatMap(Ref.get(state), (current) => {
      const held = current.streams.get(stream);
      return held === undefined ? new StreamMissing({ stream, transport }) : Effect.succeed(positionsOf(held));
    });

  const admitRead = (cursor: ByteCursor, limit: number): Effect.Effect<ReadPlan, ReadFailure> =>
    Effect.flatten(
      Ref.modify(state, (current): readonly [Effect.Effect<ReadPlan, ReadFailure>, RecordState] => {
        const held = current.streams.get(cursor.stream);
        if (held === undefined) return [new StreamMissing({ stream: cursor.stream, transport }), current];
        if (current.sealed)
          return [new RecordRefused({ stream: cursor.stream, reason: { _tag: 'Sealed', detail: 'the record is sealed' } }), current];
        if (!Number.isSafeInteger(limit) || limit <= 0) {
          return [new CursorRefused({ reason: 'limit', detail: `limit ${limit} is not a positive whole number of bytes` }), current];
        }
        if (!sameRef(cursor.ref, ref)) return [new CursorRefused({ reason: 'ref', detail: 'the cursor names another execution' }), current];
        const offset = offsetValue(cursor.offset);
        if (offset > held.durableThrough) {
          return [
            new CursorRefused({ reason: 'ahead', detail: `offset ${offset} stands past the ${held.durableThrough} bytes confirmed` }),
            current,
          ];
        }
        if (current.reads >= limits.read.readers) {
          return [new RecordUnavailable({ act: 'read', inFlight: current.reads, limit: limits.read.readers }), current];
        }
        const wanted = Math.min(limit, limits.read.chunkBytes);
        return [Effect.succeed({ cursor, offset, wanted, held }), { ...current, reads: current.reads + 1 }];
      }),
    );

  const evicted = (cursor: ByteCursor, offset: bigint, held: StreamState): Effect.Effect<RecordRead, ReadFailure> =>
    Effect.flatMap(
      decide(cursor.stream, (current) => [Effect.succeed(current), current]),
      (current) => {
        const positions = positionsOf(current);
        const retainedFrom = current.retainedFrom;
        if (offset < retainedFrom)
          return Effect.succeed({
            bytes: new Uint8Array(0),
            range: {
              cursor,
              next: positions.retainedFrom,
              retainedFrom: positions.retainedFrom,
              durableThrough: positions.durableThrough,
              gap: true,
              grid: gridStanding(current.grid, retainedFrom),
            },
          });
        return new RecordReadFailed({
          stream: cursor.stream,
          act: 'missing',
          detail: `no retained segment carries ${offset} of ${held.retainedFrom}..${held.durableThrough}`,
        });
      },
    );

  const openSegmentFile = Effect.fnUntraced(function* (stream: Stream, first: bigint): Effect.fn.Return<OpenSegment, RecordReadFailed> {
    const scope = yield* Scope.make();
    const handle = yield* fs.open(path.join(writer.directory, stream, segmentFile(first)), { flag: 'r' }).pipe(
      Scope.provide(scope),
      Effect.catchTag('PlatformError', (error) =>
        Effect.andThen(
          Scope.close(scope, Exit.void),
          new RecordReadFailed({ stream, act: error.reason._tag === 'NotFound' ? 'missing' : 'open', detail: error.message }),
        ),
      ),
    );
    reading.open++;
    return {
      handle,
      gate: yield* Semaphore.make(1),
      scope,
      counter: reading,
      closed: false,
      users: 0,
      idle: undefined,
    } satisfies OpenSegment;
  });

  const borrow = Effect.fnUntraced(function* (stream: Stream, first: bigint) {
    const lend = (entry: OpenSegment) => {
      if (entry.users === 0) entry.idle = Deferred.makeUnsafe<void>();
      entry.users++;
      return entry;
    };
    const lent = yield* Ref.modify(state, (current) => {
      const entry = liveOpen(current, stream)?.get(first);
      return [entry === undefined ? undefined : lend(entry), current] as const;
    });
    if (lent !== undefined) return { entry: lent, own: false };
    const retired = yield* Ref.modify(state, (current) => {
      const open = liveOpen(current, stream);
      if (open === undefined || open.size < CACHED_SEGMENTS) return [undefined, current] as const;
      const idle = [...open].find(([, entry]) => entry.users === 0);
      if (idle === undefined) return [undefined, current] as const;
      const kept = new Map(open);
      kept.delete(idle[0]);
      return [idle[1], withOpen(current, stream, kept)] as const;
    });
    if (retired !== undefined) yield* closeSegmentHandle(retired);
    const opened = lend(yield* openSegmentFile(stream, first));
    const kept = yield* Ref.modify(state, (current) => {
      const open = liveOpen(current, stream);
      if (open === undefined) return [undefined, current] as const;
      const currentEntry = open.get(first);
      if (currentEntry !== undefined) return [lend(currentEntry), current] as const;
      if (open.size >= CACHED_SEGMENTS) return [undefined, current] as const;
      return [opened, withOpen(current, stream, new Map(open).set(first, opened))] as const;
    });
    if (kept === undefined) return { entry: opened, own: true };
    if (kept === opened) return { entry: opened, own: false };
    yield* closeSegmentHandle(opened);
    return { entry: kept, own: false };
  });

  const readThrough = Effect.fnUntraced(
    function* (handle: FileSystem.File, stream: Stream, first: bigint, offset: bigint, length: number) {
      const buffer = new Uint8Array(length);
      yield* handle.seek(segmentPosition(first, offset), 'start');
      let taken = 0;
      while (taken < length) {
        const read = yield* handle.read(buffer.subarray(taken));
        if (read === 0) break;
        taken += read;
      }
      if (taken < length) return yield* new RecordReadFailed({ stream, act: 'read', detail: `${taken} of ${length} bytes from ${offset}` });
      return buffer;
    },
    (effect, _handle, stream) =>
      Effect.catchTag(effect, 'PlatformError', (error) => new RecordReadFailed({ stream, act: 'read', detail: error.message })),
  );

  const readSegment = (stream: Stream, first: bigint, offset: bigint, length: number): Effect.Effect<Uint8Array, RecordReadFailed> =>
    Effect.acquireUseRelease(
      borrow(stream, first),
      (held) => held.entry.gate.withPermits(1)(readThrough(held.entry.handle, stream, first, offset, length)),
      (held) =>
        Effect.andThen(
          Effect.sync(() => {
            held.entry.users--;
            if (held.entry.users === 0 && held.entry.idle !== undefined) {
              Deferred.doneUnsafe(held.entry.idle, Effect.void);
              held.entry.idle = undefined;
            }
          }),
          held.own ? closeSegmentHandle(held.entry) : Effect.void,
        ),
    ).pipe(Effect.withSpan('readSegment', { attributes: { bytes: length } }));

  const take = (plan: ReadPlan): Effect.Effect<RecordRead, ReadFailure> => {
    const { cursor, offset, held } = plan;
    const answer = (bytes: Uint8Array, next: bigint, gap: boolean, from: bigint): RecordRead => ({
      bytes,
      range: {
        cursor,
        next: byteOffset(next),
        retainedFrom: byteOffset(from),
        durableThrough: byteOffset(held.durableThrough),
        gap,
        grid: gridStanding(held.grid, gap ? next : offset),
      },
    });
    if (offset < held.retainedFrom) return Effect.succeed(answer(new Uint8Array(0), held.retainedFrom, true, held.retainedFrom));
    if (offset === held.durableThrough) return Effect.succeed(answer(new Uint8Array(0), offset, false, held.retainedFrom));
    const segment = held.segments.find((entry) => entry.first <= offset && offset < entry.end);
    if (segment === undefined) return evicted(cursor, offset, held);
    const boundary = gridBoundary(held.grid, offset);
    const stop = boundary !== undefined && boundary < segment.end ? boundary : segment.end;
    const length = Number(minOf(BigInt(plan.wanted), stop - offset));
    return readSegment(cursor.stream, segment.first, offset, length).pipe(
      Effect.map((bytes) => answer(bytes, offset + BigInt(bytes.length), false, held.retainedFrom)),
      Effect.catchIf(
        (failure) => failure.act === 'missing',
        () => evicted(cursor, offset, held),
      ),
    );
  };

  const read = (cursor: ByteCursor, limit: number): Effect.Effect<RecordRead, ReadFailure> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.flatMap(admitRead(cursor, limit), (plan) =>
        restore(take(plan)).pipe(Effect.ensuring(Ref.update(state, (current) => ({ ...current, reads: current.reads - 1 })))),
      ),
    );

  const suspend = Effect.fnUntraced(
    function* () {
      if (suspended) return [] satisfies ReadonlyArray<StreamPositions>;
      suspended = true;
      const inFlight = yield* stopAppends();
      yield* Effect.all(inFlight.map(Deferred.await), { concurrency: 'unbounded' });
      yield* closeMirrors;
      const fenced = [...(yield* Ref.get(state)).streams.values()].filter((held) => held.failure !== undefined && held.ending === 'open');
      for (const held of fenced) yield* endStream(held.stream, 'error').pipe(Effect.catchTag('StreamMissing', () => Effect.void));
      for (const stream of writer.streams) {
        yield* writer.closeSegment(stream);
        const lent = yield* Ref.modify(state, (current) => {
          const held = current.streams.get(stream);
          return [[...(held?.open.values() ?? [])], withOpen(current, stream, new Map<bigint, OpenSegment>())] as const;
        });
        yield* closeOpen(lent);
      }
      const journaled = new Map(writer.journal.snapshot.streams.map((held) => [held.stream, held.ending] as const));
      return [...(yield* Ref.get(state)).streams.values()]
        .filter((held) => held.ending !== 'open' && journaled.get(held.stream) === 'open')
        .map(positionsOf);
    },
    Effect.uninterruptible,
    gridding.withPermits(1),
    (effect) => Effect.andThen(writer.hurry(), effect),
  );

  const seal = Effect.fnUntraced(
    function* () {
      if (suspended) {
        const current = yield* Ref.get(state);
        return {
          seal: { ref, transport, streams: [...current.streams.values()].map(sealStream) },
          written: false,
          detail: 'the record is suspended',
        };
      }
      const pending = Deferred.makeUnsafe<SealAnswer>();
      const standing = yield* Ref.modify(sealing, (held) =>
        held === undefined ? ([undefined, pending] as const) : ([held, held] as const),
      );
      if (standing !== undefined) return yield* Deferred.await(standing);
      const inFlight = yield* stopAppends();
      yield* Effect.all(inFlight.map(Deferred.await), { concurrency: 'unbounded' });
      yield* closeMirrors;
      const failures: string[] = [];
      for (const stream of writer.streams) {
        const closed = yield* Effect.result(writer.closeSegment(stream));
        if (Result.isFailure(closed)) {
          failures.push(`closing ${stream}: ${closed.failure.detail}`);
          yield* fence(stream, { act: closed.failure.act, detail: closed.failure.detail });
        }
        const lent = yield* Ref.modify(state, (current) => {
          const held = current.streams.get(stream);
          if (held === undefined) return [[] as ReadonlyArray<OpenSegment>, current] as const;
          return [[...held.open.values()], withOpen(current, stream, new Map<bigint, OpenSegment>())] as const;
        });
        yield* closeOpen(lent);
      }
      const current = yield* Ref.get(state);
      const seal: RecordSeal = { ref, transport, streams: [...current.streams.values()].map(sealStream) };
      const written = yield* Effect.result(writer.writeSeal(seal));
      if (Result.isFailure(written)) failures.push(`writing the seal: ${written.failure.detail}`);
      const outcome: SealAnswer = {
        seal,
        written: Result.isSuccess(written),
        detail: failures.length === 0 ? undefined : failures.join('; '),
      };
      yield* Deferred.succeed(pending, outcome);
      return outcome;
    },
    Effect.uninterruptible,
    gridding.withPermits(1),
    (effect) => Effect.andThen(writer.hurry(), effect),
  );

  if (opening.mode === 'reopen') {
    yield* settleOutput;
    if (kept === undefined) yield* keepOutput(true);
  }
  yield* Effect.addFinalizer(() => (suspended ? Effect.void : Effect.asVoid(seal())));
  return {
    ref,
    transport,
    get openHandles() {
      return writer.handles + reading.open;
    },
    streams: writer.streams,
    directory: writer.directory,
    hurry: writer.hurry(),
    suspend,
    append,
    capture,
    stopCapture,
    follow,
    advance,
    acknowledgeParsed,
    abandonInterpretation,
    receiving,
    regrid,
    standing,
    grid: Effect.map(Ref.get(state), (current) => current.streams.get('pty')?.grid.at(-1)?.geometry),
    endStream,
    awaitBeyond,
    positions,
    everyPosition: Effect.map(Ref.get(state), (current) => [...current.streams.values()].map(positionsOf)),
    printed: Effect.map(Ref.get(state), (current) => {
      const output = current.streams.get(OUTPUT);
      return output === undefined ? undefined : output.durableThrough > 0n;
    }),
    outputFile: Effect.sync(() => kept),
    availability: Effect.map(Ref.get(state), (current): RecordAvailability => {
      const held = [...current.streams.values()].filter((stream) => stream.stream !== OUTPUT);
      if (held.some((stream) => stream.failure !== undefined)) return 'unavailable';
      return held.some((stream) => stream.retainedFrom > 0n) ? 'gapped' : 'available';
    }),
    sealed: Effect.flatMap(Ref.get(sealing), (pending) => (pending === undefined ? Effect.succeed(undefined) : Deferred.await(pending))),
    read,
    seal,
  };
});

export type SegmentRecord = Effect.Success<ReturnType<typeof makeSegmentRecord>>;

const liveOpen = (state: RecordState, stream: Stream): ReadonlyMap<bigint, OpenSegment> | undefined => {
  const held = state.streams.get(stream);
  return held === undefined || held.ending !== 'open' ? undefined : held.open;
};

const closeSegmentHandle = (entry: OpenSegment): Effect.Effect<void> =>
  Effect.andThen(
    Scope.close(entry.scope, Exit.void),
    Effect.sync(() => {
      if (entry.closed) return;
      entry.closed = true;
      entry.counter.open--;
    }),
  );

const withOpen = (state: RecordState, stream: Stream, open: ReadonlyMap<bigint, OpenSegment>): RecordState => {
  const held = state.streams.get(stream);
  if (held === undefined) return state;
  return { ...state, streams: new Map(state.streams).set(stream, { ...held, open }) };
};

type AppendPlan = {
  readonly stream: Stream;
  readonly evicted: ReadonlyArray<RecordSegment>;
  readonly rollAt: bigint | undefined;
  readonly first: bigint;
  readonly confirmed: bigint;
};

type ReadPlan = {
  readonly cursor: ByteCursor;
  readonly offset: bigint;
  readonly wanted: number;
  readonly held: StreamState;
};

const evictable = (
  held: StreamState,
  durable: bigint,
  retained: bigint,
  interpreted: boolean,
): ReadonlyArray<RecordSegment> | undefined => {
  const evicted: RecordSegment[] = [];
  let from = held.retainedFrom;
  let consumed = held.waitingReader ? held.retainedFrom : MAX_RECORD_OFFSET;
  for (const at of held.drains?.values() ?? []) consumed = minOf(consumed, at);
  for (const segment of held.segments) {
    if (durable - from <= retained) return evicted;
    if (segment === held.segments[held.segments.length - 1]) break;
    if (interpreted && segment.end > held.parsedThrough) break;
    if (segment.end > consumed) break;
    evicted.push(segment);
    from = segment.end;
  }
  return durable - from <= retained ? evicted : undefined;
};

const unusableLimits = (limits: ExecutionLimits): string | undefined => {
  if (limits.output.landingBytes > limits.output.segmentBytes) return 'output.landingBytes exceeds output.segmentBytes';
  if (limits.output.segmentBytes > limits.output.retainedBytes) return 'output.segmentBytes exceeds output.retainedBytes';
  if (limits.output.segmentBytes + limits.output.landingBytes > limits.output.retainedBytes) {
    return 'output.segmentBytes and output.landingBytes together exceed output.retainedBytes, so retention would wedge at the first roll';
  }
  if (limits.read.chunkBytes > limits.output.retainedBytes) return 'read.chunkBytes exceeds output.retainedBytes';
  return undefined;
};

const roomOpened = (held: StreamState): Effect.Effect<void> =>
  held.room === undefined ? Effect.void : Effect.asVoid(Deferred.succeed(held.room, undefined));

const woken = (held: StreamState): Effect.Effect<void> =>
  held.advanced === undefined ? Effect.void : Effect.asVoid(Deferred.succeed(held.advanced, undefined));

const positionsOf = (held: StreamState): StreamPositions => ({
  stream: held.stream,
  retainedFrom: byteOffset(held.retainedFrom),
  durableThrough: byteOffset(held.durableThrough),
  parsedThrough: byteOffset(held.parsedThrough),
  ending: held.ending,
});

const tailOf = (held: StreamState): RecordTail => (held.failure !== undefined ? 'lost' : held.ending === 'eof' ? 'complete' : 'unmeasured');

const sealStream = (held: StreamState): SealedStream => {
  const grid = settledTrack(held.grid, held.durableThrough);
  return {
    positions: positionsOf(held),
    tail: tailOf(held),
    segments: held.segments.map((segment): SealedSegment => ({
      first: byteOffset(segment.first),
      end: byteOffset(segment.end),
      checksum: crc32Final(segment.register),
    })),
    failure: held.failure,
    grid: grid.length === 0 ? undefined : grid,
  };
};

const regridded = (held: StreamState, geometry: TerminalGeometry): ReadonlyArray<GridEntry> => {
  const last = held.grid.at(-1);
  const reached = held.failure === undefined ? laterOf(held.arriving, held.durableThrough) : held.durableThrough;
  const at = last !== undefined && offsetValue(last.at) > reached ? offsetValue(last.at) : reached;
  const kept = last !== undefined && offsetValue(last.at) === at ? held.grid.slice(0, -1) : held.grid;
  if (sameGeometry(gridStanding(kept, at), geometry)) return kept.length === held.grid.length ? held.grid : kept;
  return [...kept, { at: byteOffset(at), geometry }];
};

const retainedTrack = (track: ReadonlyArray<GridEntry>, retainedFrom: bigint): ReadonlyArray<GridEntry> => {
  let standing = 0;
  for (let index = 1; index < track.length; index += 1) {
    if (offsetValue((track[index] as GridEntry).at) <= retainedFrom) standing = index;
  }
  return standing === 0 ? track : track.slice(standing);
};

const settledTrack = (track: ReadonlyArray<GridEntry>, through: bigint): ReadonlyArray<GridEntry> => {
  if (track.every((entry) => offsetValue(entry.at) <= through)) return track;
  const settled: GridEntry[] = [];
  for (const entry of track) {
    const at = offsetValue(entry.at) > through ? byteOffset(through) : entry.at;
    if (settled.at(-1)?.at === at) settled.pop();
    if (sameGeometry(settled.at(-1)?.geometry, entry.geometry)) continue;
    settled.push(at === entry.at ? entry : { at, geometry: entry.geometry });
  }
  return settled;
};

const frontier = (held: StreamState, reason: 'behind' | 'ahead', offered: ByteOffset) =>
  new FrontierRefused({
    stream: held.stream,
    reason,
    offered,
    parsedThrough: byteOffset(held.parsedThrough),
    durableThrough: byteOffset(held.durableThrough),
  });

const sameRef = (a: ExecutionRef, b: ExecutionRef): boolean =>
  a.installation === b.installation && a.execution === b.execution && a.incarnation === b.incarnation;

const minOf = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const laterOf = (a: bigint | undefined, b: bigint): bigint => (a !== undefined && a > b ? a : b);
