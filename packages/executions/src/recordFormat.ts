import { Data, Schema } from 'effect';
import type { ExecutionId } from './protocol/execution';
import { ExecutionRef, StreamEnding, Transport } from './protocol/execution';
import { ByteOffset, GridEntry, RecordTail, Stream, StreamPositions, offsetValue, type TerminalGeometry } from './protocol/record';

export const RECORDS_DIRECTORY = 'records';

export const SEAL_FILE = 'record.json';

export const JOURNAL_FILE = 'record.ndjson';

export const SEGMENT_HEADER_BYTES = 20;

export const MAX_RECORD_OFFSET = 2n ** 64n - 1n;

export const MAX_FOLDER_BYTES = 255;

export const streamsOf = (transport: Transport): ReadonlyArray<Stream> => (transport === 'pty' ? ['pty'] : ['stdout', 'stderr', 'output']);

const STREAM_CODES: ReadonlyArray<Stream> = ['stdout', 'stderr', 'pty', 'output'];

const MAGIC = Uint8Array.of(0x52, 0x58, 0x52, 0x53);

const HEX = '0123456789abcdef';

export class RecordNameInvalid extends Data.TaggedError('RecordNameInvalid')<{
  readonly execution: string;
  readonly reason: 'empty' | 'unpaired-surrogate' | 'too-long';
  readonly detail: string;
}> {}

export const recordFolder = (execution: ExecutionId): string | RecordNameInvalid => {
  if (execution.length === 0) {
    return new RecordNameInvalid({ execution, reason: 'empty', detail: 'an identifier with no characters names no directory' });
  }
  if (!execution.isWellFormed()) {
    return new RecordNameInvalid({
      execution,
      reason: 'unpaired-surrogate',
      detail: 'the identifier holds an unpaired surrogate and has no injective byte spelling',
    });
  }
  const bytes = new TextEncoder().encode(execution);
  if (bytes.length * 2 > MAX_FOLDER_BYTES) {
    return new RecordNameInvalid({
      execution,
      reason: 'too-long',
      detail: `${bytes.length} bytes name a ${bytes.length * 2} character directory, and a path component holds ${MAX_FOLDER_BYTES}`,
    });
  }
  let folder = '';
  for (const byte of bytes) folder += `${HEX[byte >> 4]}${HEX[byte & 0x0f]}`;
  return folder;
};

export const segmentFile = (first: bigint): string => `${first.toString().padStart(20, '0')}.seg`;

export const segmentPosition = (first: bigint, offset: bigint): bigint => BigInt(SEGMENT_HEADER_BYTES) + (offset - first);

export type SegmentHeader = {
  readonly stream: Stream;
  readonly first: bigint;
};

export type SegmentDefect = {
  readonly defect: 'short' | 'magic' | 'layout' | 'stream' | 'checksum' | 'range';
  readonly detail: string;
};

export const encodeSegmentHeader = (stream: Stream, first: bigint): Uint8Array | SegmentDefect => {
  if (first < 0n || first > MAX_RECORD_OFFSET) {
    return { defect: 'range', detail: `offset ${first} is outside the ${MAX_RECORD_OFFSET} this format addresses` };
  }
  const header = new Uint8Array(SEGMENT_HEADER_BYTES);
  header.set(MAGIC, 0);
  const view = new DataView(header.buffer);
  header[6] = STREAM_CODES.indexOf(stream);
  header[7] = 0;
  view.setBigUint64(8, first, true);
  view.setUint32(16, crc32Final(crc32Update(CRC32_INITIAL, header.subarray(0, 16))), true);
  return header;
};

export const readSegmentHeader = (bytes: Uint8Array): SegmentHeader | SegmentDefect => {
  if (bytes.length < SEGMENT_HEADER_BYTES) {
    return { defect: 'short', detail: `${bytes.length} bytes where a header is ${SEGMENT_HEADER_BYTES}` };
  }
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (bytes[index] !== MAGIC[index]) return { defect: 'magic', detail: 'the file does not begin as a record segment' };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (crc32Final(crc32Update(CRC32_INITIAL, bytes.subarray(0, 16))) !== view.getUint32(16, true)) {
    return { defect: 'checksum', detail: 'the header does not check out against itself' };
  }
  if (view.getUint16(4, true) !== 0 || bytes[7] !== 0) {
    return { defect: 'layout', detail: 'the reserved header bytes are nonzero' };
  }
  const stream = STREAM_CODES[bytes[6] ?? -1];
  if (stream === undefined) return { defect: 'stream', detail: `stream code ${bytes[6]}` };
  return { stream, first: view.getBigUint64(8, true) };
};

export const RecordWriteAction = Schema.Literals([
  'directory',
  'open',
  'append',
  'truncate',
  'close',
  'drop',
  'sync',
  'seal',
  'segment',
  'journal',
]);
export type RecordWriteAction = typeof RecordWriteAction.Type;

export const SealedSegment = Schema.Struct({
  first: ByteOffset,
  end: ByteOffset,
  checksum: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffffff })),
});
export type SealedSegment = typeof SealedSegment.Type;

const sealedStreamFields = {
  positions: StreamPositions,
  tail: RecordTail,
  segments: Schema.Array(SealedSegment),
  failure: Schema.optional(
    Schema.Struct({
      act: RecordWriteAction,
      detail: Schema.String,
    }),
  ),
};

export const SealedStream = Schema.Struct({
  ...sealedStreamFields,
  grid: Schema.optional(Schema.Array(GridEntry)),
});
export type SealedStream = typeof SealedStream.Type;

export const RecordSeal = Schema.Struct({
  ref: ExecutionRef,
  transport: Transport,
  streams: Schema.Array(SealedStream),
});
export type RecordSeal = typeof RecordSeal.Type;

export const sealCodec = Schema.fromJsonString(RecordSeal, { space: 2 });

export const trackOf = (held: SealedStream): ReadonlyArray<GridEntry> => held.grid ?? [];

export const JournalStream = Schema.Struct({
  stream: Stream,
  streaming: Schema.optional(Schema.Literal(true)),
  retainedFrom: ByteOffset,
  segments: Schema.Array(SealedSegment),
  ending: StreamEnding,
  grid: Schema.Array(GridEntry),
});
export type JournalStream = typeof JournalStream.Type;

export const JournalSnapshot = Schema.Struct({ ref: ExecutionRef, transport: Transport, streams: Schema.Array(JournalStream) });
export type JournalSnapshot = typeof JournalSnapshot.Type;

export const JournalEntry = Schema.TaggedUnion({
  Snapshot: { state: JournalSnapshot },
  Closed: { stream: Stream, segment: SealedSegment, ending: Schema.optional(StreamEnding) },
  Grid: { from: ByteOffset, entry: Schema.optional(GridEntry) },
  Retained: { stream: Stream, from: ByteOffset },
});
export type JournalEntry = typeof JournalEntry.Type;
export type JournalDelta = Exclude<JournalEntry, { readonly _tag: 'Snapshot' }>;

export const journalCodec = Schema.fromJsonString(JournalEntry);

export const gridStanding = (track: ReadonlyArray<GridEntry>, offset: bigint): TerminalGeometry | undefined => {
  let standing: TerminalGeometry | undefined;
  for (const entry of track) {
    if (offsetValue(entry.at) > offset) break;
    standing = entry.geometry;
  }
  return standing;
};

export const gridBoundary = (track: ReadonlyArray<GridEntry>, offset: bigint): bigint | undefined => {
  for (const entry of track) {
    const at = offsetValue(entry.at);
    if (at > offset) return at;
  }
  return undefined;
};

export const CRC32_INITIAL = 0xffffffff;

export const crc32Update = (register: number, bytes: Uint8Array): number => {
  let crc = register;
  for (let index = 0; index < bytes.length; index += 1) crc = (CRC_TABLE[((crc ^ bytes[index]!) & 0xff)!] as number) ^ (crc >>> 8);
  return crc >>> 0;
};

export const crc32Final = (register: number): number => (register ^ 0xffffffff) >>> 0;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();
