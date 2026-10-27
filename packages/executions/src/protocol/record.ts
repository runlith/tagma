import { Schema } from 'effect';
import { handle } from '@runlith/utils/printed';
import { ExecutionRef, StreamEnding } from './execution';

export const Stream = Schema.Literals(['stdout', 'stderr', 'pty', 'output']);
export type Stream = typeof Stream.Type;

export const SourceStream = Stream.pick(['stdout', 'stderr', 'pty']);
export type SourceStream = typeof SourceStream.Type;

const CANONICAL_DECIMAL = /^(0|[1-9][0-9]*)$/u;

export const ByteOffset = Schema.String.check(Schema.isPattern(CANONICAL_DECIMAL)).pipe(Schema.brand('ByteOffset')).annotate(handle());
export type ByteOffset = typeof ByteOffset.Type;

const readOffset = Schema.decodeUnknownSync(ByteOffset);

export const byteOffset = (value: bigint): ByteOffset => readOffset(value.toString());
export const offsetValue = (offset: ByteOffset): bigint => BigInt(offset);

export const StreamPositions = Schema.Struct({
  stream: Stream,
  retainedFrom: ByteOffset,
  durableThrough: ByteOffset,
  parsedThrough: ByteOffset,
  ending: StreamEnding,
});
export type StreamPositions = typeof StreamPositions.Type;

export const OutputFile = Schema.Struct({
  path: Schema.NonEmptyString,
  from: ByteOffset,
  through: ByteOffset,
});
export type OutputFile = typeof OutputFile.Type;

export const RecordTail = Schema.Literals(['complete', 'lost', 'unmeasured']);
export type RecordTail = typeof RecordTail.Type;

export const TerminalGeometry = Schema.Struct({
  rows: Schema.Int.check(Schema.isGreaterThan(0)),
  columns: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type TerminalGeometry = typeof TerminalGeometry.Type;

export const GridEntry = Schema.Struct({
  at: ByteOffset,
  geometry: TerminalGeometry,
});
export type GridEntry = typeof GridEntry.Type;

export const sameGeometry = (a: TerminalGeometry | undefined, b: TerminalGeometry | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && a.rows === b.rows && a.columns === b.columns);

export const ByteCursor = Schema.Struct({
  ref: ExecutionRef,
  stream: Stream,
  offset: ByteOffset,
});
export type ByteCursor = typeof ByteCursor.Type;

export const RecordRange = Schema.Struct({
  cursor: ByteCursor,
  next: ByteOffset,
  retainedFrom: ByteOffset,
  durableThrough: ByteOffset,
  gap: Schema.Boolean,
  grid: Schema.optional(TerminalGeometry),
});
export type RecordRange = typeof RecordRange.Type;
