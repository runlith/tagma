import { Context, Data, Effect, FileSystem, Layer, Path, type PlatformError, Schema } from 'effect';
import type { ExecutionRef, StreamEnding } from './protocol/execution';
import { type ByteCursor, type ByteOffset, type RecordRange, type Stream, byteOffset, offsetValue } from './protocol/record';
import {
  CRC32_INITIAL,
  RecordNameInvalid,
  SEAL_FILE,
  SEGMENT_HEADER_BYTES,
  type RecordSeal,
  type SealedStream,
  crc32Final,
  crc32Update,
  gridBoundary,
  gridStanding,
  readSegmentHeader,
  sealCodec,
  recordFolder,
  segmentFile,
  segmentPosition,
  streamsOf,
  trackOf,
} from './recordFormat';

export class RecordSealMissing extends Data.TaggedError('RecordSealMissing')<{
  readonly directory: string;
}> {}

type SegmentDefect = 'missing' | 'short' | 'magic' | 'layout' | 'stream' | 'checksum' | 'offset' | 'range';

export class RecordUnreadable extends Data.TaggedError('RecordUnreadable')<{
  readonly path: string;
  readonly reason: 'filesystem' | 'incompatible' | SegmentDefect;
  readonly act?: 'seal' | 'open' | 'stat' | 'read';
  readonly stream?: Stream;
  readonly first?: ByteOffset;
  readonly detail: string;
}> {}

export class RecordInvalid extends Data.TaggedError('RecordInvalid')<{
  readonly path: string;
  readonly expected: ExecutionRef;
  readonly named: ExecutionRef;
}> {}

const filesystem = (path: string, act: 'seal' | 'open' | 'stat' | 'read', detail: string) =>
  new RecordUnreadable({ path, reason: 'filesystem', act, detail });

export class RecordCursorRefused extends Data.TaggedError('RecordCursorRefused')<{
  readonly path: string;
  readonly reason: 'ref' | 'stream' | 'ahead' | 'limit';
  readonly detail: string;
}> {}

export type SealFailure = RecordNameInvalid | RecordSealMissing | RecordUnreadable | RecordInvalid;
export type RecordReadFailure = RecordCursorRefused | RecordUnreadable;

export type RecordRead = {
  readonly bytes: Uint8Array;
  readonly range: RecordRange;
  readonly ending?: StreamEnding;
};

const decodeSeal = Schema.decodeUnknownEffect(sealCodec);

export type SealedRecord = {
  readonly directory: string;
  readonly seal: RecordSeal;
  readonly read: (cursor: ByteCursor, limit: number) => Effect.Effect<RecordRead, RecordReadFailure>;
};

export const makeSealedRecord = Effect.fnUntraced(function* ({
  directory,
  seal,
}: {
  readonly directory: string;
  readonly seal: RecordSeal;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const checked = new Set<string>();

  const readSegment = Effect.fn('SealedRecord.readSegment')(function* (
    stream: Stream,
    first: bigint,
    end: bigint,
    checksum: number,
    offset: bigint,
    wanted: number,
    limit: number,
  ) {
    const file = path.join(directory, stream, segmentFile(first));
    const corrupt = (reason: SegmentDefect, detail: string) =>
      new RecordUnreadable({ path: file, stream, first: byteOffset(first), reason, detail });
    const short = (detail: string) => corrupt('short', detail);
    const size = yield* fs.stat(file).pipe(
      Effect.map((info) => info.size),
      Effect.catchTag('PlatformError', (error) =>
        Effect.fail(
          error.reason._tag === 'NotFound'
            ? corrupt('missing', 'the seal names a segment file that is not there')
            : filesystem(file, 'stat', error.message),
        ),
      ),
    );
    const declared = BigInt(SEGMENT_HEADER_BYTES) + (end - first);
    if (size < declared) return yield* short(`${size} bytes on disk where the seal states ${declared}`);
    const handle = yield* fs
      .open(file, { flag: 'r' })
      .pipe(
        Effect.catchTag('PlatformError', (error) =>
          Effect.fail(
            error.reason._tag === 'NotFound'
              ? corrupt('missing', 'the seal names a segment file that is not there')
              : filesystem(file, 'open', error.message),
          ),
        ),
      );
    const header = yield* readExactly(handle, 0n, SEGMENT_HEADER_BYTES, file, short);
    const read = readSegmentHeader(header);
    if ('defect' in read) return yield* corrupt(read.defect === 'short' ? 'short' : read.defect, read.detail);
    if (read.stream !== stream) return yield* corrupt('stream', `the file carries ${read.stream}`);
    if (read.first !== first) return yield* corrupt('offset', `the file begins at ${read.first}, and the seal names ${first}`);
    if (!checked.has(file)) {
      yield* verify(handle, first, end, checksum, limit, file, corrupt, short);
      checked.add(file);
    }
    return yield* readExactly(handle, segmentPosition(first, offset), wanted, file, short);
  }, Effect.scoped);

  const readStream = (cursor: ByteCursor, limit: number, held: SealedStream): Effect.Effect<RecordRead, RecordReadFailure> => {
    const retainedFrom = offsetValue(held.positions.retainedFrom);
    const durableThrough = offsetValue(held.positions.durableThrough);
    const offset = offsetValue(cursor.offset);
    if (offset > durableThrough) {
      return Effect.fail(
        new RecordCursorRefused({
          path: directory,
          reason: 'ahead',
          detail: `offset ${offset} stands past the ${durableThrough} bytes this record confirmed`,
        }),
      );
    }
    const track = trackOf(held);
    const range = (next: bigint, gap: boolean): RecordRange => {
      const grid = gridStanding(track, gap ? next : offset);
      return {
        cursor,
        next: byteOffset(next),
        retainedFrom: held.positions.retainedFrom,
        durableThrough: held.positions.durableThrough,
        gap,
        grid: grid,
      };
    };
    if (offset < retainedFrom) return Effect.succeed({ bytes: new Uint8Array(0), range: range(retainedFrom, true) });
    if (offset === durableThrough)
      return Effect.succeed({ bytes: new Uint8Array(0), range: range(offset, false), ending: held.positions.ending });

    const segment = held.segments.find((entry) => offsetValue(entry.first) <= offset && offset < offsetValue(entry.end));
    if (segment === undefined) {
      return Effect.fail(
        new RecordUnreadable({
          path: directory,
          stream: cursor.stream,
          first: cursor.offset,
          reason: 'offset',
          detail: `the seal retains ${retainedFrom}..${durableThrough} and holds no segment carrying ${offset}`,
        }),
      );
    }
    const first = offsetValue(segment.first);
    const end = offsetValue(segment.end);
    const boundary = gridBoundary(track, offset);
    const stop = boundary !== undefined && boundary < end ? boundary : end;
    const wanted = Number(min(BigInt(limit), stop - offset));
    return readSegment(cursor.stream, first, end, segment.checksum, offset, wanted, limit).pipe(
      Effect.map((bytes) => ({ bytes, range: range(offset + BigInt(bytes.length), false) })),
    );
  };

  const record: SealedRecord = {
    directory,
    seal,
    read: (cursor, limit) =>
      Effect.suspend(() => {
        if (!Number.isSafeInteger(limit) || limit <= 0) {
          return new RecordCursorRefused({
            path: directory,
            reason: 'limit',
            detail: `limit ${limit} is not a positive whole number of bytes`,
          });
        }
        if (!sameRef(cursor.ref, seal.ref)) {
          return new RecordCursorRefused({ path: directory, reason: 'ref', detail: 'the cursor names another execution' });
        }
        const held = seal.streams.find((stream) => stream.positions.stream === cursor.stream);
        if (held === undefined) {
          return new RecordCursorRefused({ path: directory, reason: 'stream', detail: `this record carries no ${cursor.stream}` });
        }
        return readStream(cursor, limit, held);
      }),
  };
  return record;
});

const verify = Effect.fn('SealedRecord.verify')(function* (
  handle: FileSystem.File,
  first: bigint,
  end: bigint,
  checksum: number,
  limit: number,
  file: string,
  corrupt: (reason: 'checksum', detail: string) => RecordUnreadable,
  short: (detail: string) => RecordUnreadable,
) {
  const payload = end - first;
  const buffer = new Uint8Array(Number(min(BigInt(limit), payload > 0n ? payload : 1n)));
  let register = CRC32_INITIAL;
  let taken = 0n;
  yield* handle
    .seek(segmentPosition(first, first), 'start')
    .pipe(Effect.catchTag('PlatformError', (error) => Effect.fail(filesystem(file, 'read', error.message))));
  while (taken < payload) {
    const wanted = Number(min(BigInt(buffer.length), payload - taken));
    const read = yield* handle
      .read(buffer.subarray(0, wanted))
      .pipe(Effect.catchTag('PlatformError', (error) => Effect.fail(filesystem(file, 'read', error.message))));
    if (read === 0) return yield* short(`${taken} of ${payload} payload bytes`);
    register = crc32Update(register, buffer.subarray(0, read));
    taken += BigInt(read);
  }
  const folded = crc32Final(register);
  if (folded !== checksum) return yield* corrupt('checksum', `the payload folds to ${folded} and the seal states ${checksum}`);
});

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const owners = Context.make(FileSystem.FileSystem, fs).pipe(Context.add(Path.Path, path));

  return RecordFiles.of({
    open: Effect.fn('RecordFiles.open')(function* (records, ref) {
      const folder = recordFolder(ref.execution);
      if (folder instanceof RecordNameInvalid) return yield* folder;
      const directory = path.join(records, folder);
      const file = path.join(directory, SEAL_FILE);
      const text = yield* fs
        .readFileString(file)
        .pipe(
          Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
            Effect.fail(error.reason._tag === 'NotFound' ? new RecordSealMissing({ directory }) : filesystem(file, 'seal', error.message)),
          ),
        );
      const seal = yield* decodeSeal(text).pipe(
        Effect.catchTag('SchemaError', (error) =>
          Effect.fail(new RecordUnreadable({ path: file, reason: 'incompatible', detail: error.message })),
        ),
      );
      if (!sameRef(seal.ref, ref)) return yield* new RecordInvalid({ path: file, expected: ref, named: seal.ref });
      const contradiction = incoherent(seal);
      if (contradiction !== undefined) return yield* new RecordUnreadable({ path: file, reason: 'incompatible', detail: contradiction });
      return yield* Effect.provide(makeSealedRecord({ directory, seal }), owners);
    }),
  });
});

export class RecordFiles extends Context.Service<
  RecordFiles,
  {
    readonly open: (records: string, ref: ExecutionRef) => Effect.Effect<SealedRecord, SealFailure>;
  }
>()('@runlith/executions/RecordFiles') {
  static readonly layer = Layer.effect(RecordFiles, make);
}

const readExactly = Effect.fnUntraced(function* (
  handle: FileSystem.File,
  position: bigint,
  length: number,
  file: string,
  short: (detail: string) => RecordUnreadable,
) {
  const buffer = new Uint8Array(length);
  yield* handle
    .seek(position, 'start')
    .pipe(Effect.catchTag('PlatformError', (error) => Effect.fail(filesystem(file, 'read', error.message))));
  let taken = 0;
  while (taken < length) {
    const read = yield* handle
      .read(buffer.subarray(taken))
      .pipe(Effect.catchTag('PlatformError', (error) => Effect.fail(filesystem(file, 'read', error.message))));
    if (read === 0) break;
    taken += read;
  }
  if (taken < length) return yield* short(`${taken} of ${length} bytes from position ${position}`);
  return buffer;
});

const incoherent = (seal: RecordSeal): string | undefined => {
  const carried = streamsOf(seal.transport);
  const named = seal.streams.map((held) => held.positions.stream);
  if (new Set(named).size !== named.length) return `the seal names ${named.join(', ')} and one stream twice`;
  const foreign = named.filter((stream) => !carried.includes(stream));
  if (foreign.length > 0) return `a ${seal.transport} record cannot carry ${foreign.join(', ')}`;
  for (const held of seal.streams) {
    const { stream, retainedFrom, durableThrough, parsedThrough } = held.positions;
    const from = offsetValue(retainedFrom);
    const through = offsetValue(durableThrough);
    if (from > through) return `${stream} retains from ${from} through ${through}`;
    if (offsetValue(parsedThrough) > through) return `${stream} was parsed past what it confirmed`;
    let at = from;
    for (const segment of held.segments) {
      if (offsetValue(segment.first) !== at) return `${stream} names a segment at ${segment.first} where ${at} was expected`;
      if (offsetValue(segment.end) < at) return `${stream} names a segment ending at ${segment.end} before it begins`;
      at = offsetValue(segment.end);
    }
    if (at !== through) return `${stream} retains ${from}..${through} and its segments cover ${from}..${at}`;
    const track = trackOf(held);
    if (track.length > 0 && stream !== 'pty') return `${stream} carries a grid track, and only a terminal has a grid`;
    if (held.grid !== undefined && stream === 'pty' && (track[0] === undefined || offsetValue(track[0].at) > from)) {
      return `${stream} retains from ${from} and no grid stands at that byte`;
    }
    let entry = -1n;
    for (const standing of track) {
      const offset = offsetValue(standing.at);
      if (offset <= entry) return `${stream} names a grid entry at ${offset} that does not follow the one before it`;
      if (offset > through) return `${stream} names a grid entry at ${offset} past the ${through} bytes it confirmed`;
      entry = offset;
    }
  }
  return undefined;
};

const sameRef = (a: ExecutionRef, b: ExecutionRef): boolean =>
  a.installation === b.installation && a.execution === b.execution && a.incarnation === b.incarnation;

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
