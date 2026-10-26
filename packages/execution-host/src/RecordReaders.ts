import { Data, Effect, Ref, Schema, type Scope } from 'effect';
import type { ByteCursor, ByteOffset, RecordRange, Stream, StreamPositions, TerminalGeometry } from '@runlith/executions/protocol/record';
import { byteOffset, offsetValue, sameGeometry } from '@runlith/executions/protocol/record';
import { ExecutionCapacity, type CapacityRefused, type ReservationMissing } from './ExecutionCapacity';
import type { SegmentRecord, ReadFailure, StreamMissing, RecordUnavailable } from './ExecutionRecord';

export const ReaderId = Schema.NonEmptyString.pipe(Schema.brand('ReaderId'));
export type ReaderId = typeof ReaderId.Type;

export class ReaderMissing extends Data.TaggedError('ReaderMissing')<{ readonly reader: ReaderId }> {
  override get message(): string {
    return `no byte reader ${this.reader} is open`;
  }
}

export class CreditRefused extends Data.TaggedError('CreditRefused')<{
  readonly reader: ReaderId;
  readonly requested: number;
  readonly held: number;
  readonly limit: number;
}> {
  override get message(): string {
    return `credit grant ${this.requested} for reader ${this.reader} was refused with ${this.held} held and limit ${this.limit}`;
  }
}

export class ReaderUnavailable extends Data.TaggedError('ReaderUnavailable')<{ readonly reader: ReaderId }> {
  override get message(): string {
    return `byte reader ${this.reader} already has a pull in progress`;
  }
}

export type PullFailure = ReaderMissing | ReaderUnavailable | ReadFailure;

export type ReaderPull = {
  readonly bytes: Uint8Array;
  readonly range: RecordRange;
  readonly credit: number;
  readonly regridded: boolean;
};

type ReaderState = {
  readonly stream: Stream;
  readonly position: bigint;
  readonly credit: number;
  readonly pulling: boolean;
  readonly grid: TerminalGeometry | undefined;
  readonly drain: symbol | undefined;
};

export type RecordReaders = {
  readonly open: (
    stream: Stream,
    from: ByteOffset,
  ) => Effect.Effect<ReaderId, CapacityRefused | ReservationMissing | StreamMissing | RecordUnavailable, Scope.Scope>;
  readonly grant: (reader: ReaderId, bytes: number) => Effect.Effect<number, ReaderMissing | CreditRefused>;
  readonly position: (reader: ReaderId) => Effect.Effect<ByteCursor, ReaderMissing>;
  readonly positions: (reader: ReaderId) => Effect.Effect<StreamPositions, ReaderMissing | StreamMissing>;
  readonly awaitMore: (reader: ReaderId) => Effect.Effect<boolean, ReaderMissing | StreamMissing>;
  readonly pull: (reader: ReaderId) => Effect.Effect<ReaderPull, PullFailure>;
};

export type ReadersInput = { readonly record: SegmentRecord };

export const makeRecordReaders = Effect.fnUntraced(function* ({ record }: ReadersInput) {
  const readersRef = yield* Ref.make<ReadonlyMap<ReaderId, ReaderState>>(new Map());
  const capacity = yield* ExecutionCapacity;
  const open = Effect.fnUntraced(function* (
    stream: Stream,
    from: ByteOffset,
  ): Effect.fn.Return<ReaderId, CapacityRefused | ReservationMissing | StreamMissing | RecordUnavailable, Scope.Scope> {
    yield* record.positions(stream);
    const execution = record.ref.execution;
    const reader = yield* Effect.acquireRelease(
      Effect.map(capacity.reserveReader(execution), () => ReaderId.make(crypto.randomUUID())),
      (reader) =>
        Effect.andThen(
          Ref.update(readersRef, (readers) => without(readers, reader)),
          capacity.releaseReader(execution).pipe(Effect.catchTag('ReservationMissing', () => Effect.void)),
        ),
    );
    const drain = yield* record.follow(stream, from);
    yield* Ref.update(readersRef, (readers) =>
      new Map(readers).set(reader, { stream, position: offsetValue(from), credit: 0, pulling: false, grid: undefined, drain }),
    );
    return reader;
  });

  function grant(reader: ReaderId, bytes: number): Effect.Effect<number, ReaderMissing | CreditRefused> {
    const limit = capacity.profile.execution.read.readerCredits;
    return decide(reader, (held) => {
      if (!Number.isSafeInteger(bytes) || bytes <= 0) {
        return [
          Effect.fail(new CreditRefused({ reader, requested: Number.isSafeInteger(bytes) ? bytes : 0, held: held.credit, limit })),
          held,
        ];
      }
      const credit = held.credit + bytes;
      if (credit > limit) return [Effect.fail(new CreditRefused({ reader, requested: bytes, held: held.credit, limit })), held];
      return [Effect.succeed(credit), { ...held, credit }];
    });
  }

  function position(reader: ReaderId): Effect.Effect<ByteCursor, ReaderMissing> {
    return decide(reader, (held) => [Effect.succeed(cursor(held)), held]);
  }

  function positions(reader: ReaderId): Effect.Effect<StreamPositions, ReaderMissing | StreamMissing> {
    return Effect.flatMap(
      decide(reader, (held) => [Effect.succeed(held.stream), held]),
      (stream) => record.positions(stream),
    );
  }

  function awaitMore(reader: ReaderId): Effect.Effect<boolean, ReaderMissing | StreamMissing> {
    return Effect.flatMap(
      decide(reader, (held) => [Effect.succeed(held), held]),
      (held) => record.awaitBeyond(held.stream, held.position, held.grid),
    );
  }

  function pull(reader: ReaderId): Effect.Effect<ReaderPull, PullFailure> {
    return Effect.uninterruptible(
      Effect.flatMap(admit(reader), (held) =>
        take(reader, held).pipe(Effect.ensuring(Ref.update(readersRef, (readers) => resting(readers, reader)))),
      ),
    );
  }

  function admit(reader: ReaderId): Effect.Effect<ReaderState, ReaderMissing | ReaderUnavailable> {
    return decide<ReaderState, ReaderUnavailable>(reader, (held) =>
      held.pulling ? [Effect.fail(new ReaderUnavailable({ reader })), held] : [Effect.succeed(held), { ...held, pulling: true }],
    );
  }

  const take = Effect.fnUntraced(function* (reader: ReaderId, held: ReaderState): Effect.fn.Return<ReaderPull, PullFailure> {
    if (held.credit === 0) {
      const { positions, grid } = yield* record.standing(held.stream, held.position);
      const gapped = held.position < offsetValue(positions.retainedFrom);
      const range = standing(cursor(held), positions, gapped, grid);
      yield* decide<void, never>(reader, (current) => [
        Effect.void,
        { ...current, grid, position: gapped ? offsetValue(positions.retainedFrom) : current.position },
      ]).pipe(Effect.catchTag('ReaderMissing', () => Effect.void));
      yield* record.advance(held.stream, held.drain, range.next);
      return { bytes: new Uint8Array(0), range, credit: 0, regridded: !sameGeometry(held.grid, grid) };
    }
    const read = yield* record.read(cursor(held), held.credit);
    const spent = read.bytes.length;
    yield* record.advance(held.stream, held.drain, read.range.next);
    const credit = yield* decide<number, never>(reader, (standing) => {
      const next = { ...standing, position: offsetValue(read.range.next), credit: standing.credit - spent, grid: read.range.grid };
      return [Effect.succeed(next.credit), next];
    }).pipe(Effect.catchTag('ReaderMissing', () => Effect.succeed(held.credit - spent)));
    return { bytes: read.bytes, range: read.range, credit, regridded: !sameGeometry(held.grid, read.range.grid) };
  });

  function cursor(held: ReaderState): ByteCursor {
    return { ref: record.ref, stream: held.stream, offset: byteOffset(held.position) };
  }

  function decide<A, E>(
    reader: ReaderId,
    f: (held: ReaderState) => readonly [Effect.Effect<A, E>, ReaderState],
  ): Effect.Effect<A, E | ReaderMissing> {
    return Effect.flatten(
      Ref.modify(readersRef, (readers): readonly [Effect.Effect<A, E | ReaderMissing>, ReadonlyMap<ReaderId, ReaderState>] => {
        const held = readers.get(reader);
        if (held === undefined) return [Effect.fail(new ReaderMissing({ reader })), readers];
        const [answer, next] = f(held);
        return [answer, new Map(readers).set(reader, next)];
      }),
    );
  }

  return { open, grant, position, positions, awaitMore, pull } satisfies RecordReaders;
});

const standing = (cursor: ByteCursor, positions: StreamPositions, gap: boolean, grid: TerminalGeometry | undefined): RecordRange => ({
  cursor,
  next: gap ? positions.retainedFrom : cursor.offset,
  retainedFrom: positions.retainedFrom,
  durableThrough: positions.durableThrough,
  gap,
  grid: grid,
});

const without = (readers: ReadonlyMap<ReaderId, ReaderState>, reader: ReaderId): ReadonlyMap<ReaderId, ReaderState> => {
  const next = new Map(readers);
  next.delete(reader);
  return next;
};

const resting = (readers: ReadonlyMap<ReaderId, ReaderState>, reader: ReaderId): ReadonlyMap<ReaderId, ReaderState> => {
  const held = readers.get(reader);
  return held === undefined ? readers : new Map(readers).set(reader, { ...held, pulling: false });
};
