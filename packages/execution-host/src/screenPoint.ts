import { Data, Effect, FileSystem, Path } from 'effect';
import type { TerminalColors } from '@runlith/executions/protocol/appearance';
import type { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { ScreenPointed, ScreenUnavailable } from '@runlith/executions/protocol/presentation';
import { byteOffset, offsetValue, type ByteOffset } from '@runlith/executions/protocol/record';
import { standingCheckpoint } from './checkpointFile';
import type { SegmentRecord } from './ExecutionRecord';
import { makeInterpretation, type Interpretation } from './Interpretation';
import { withLinks, type ScreenCheckpoint } from './ScreenCheckpoint';
import { pointOf } from './screenRestore';

const unavailable = (
  ref: ExecutionRef,
  parsedThrough: ByteOffset,
  reason: ScreenUnavailable['reason'],
  detail: string,
): ScreenUnavailable => ({ _tag: 'ScreenUnavailable', ref, parsedThrough, reason, detail });

const SLICE_BYTES = 16384;

class CheckpointOverflow extends Data.TaggedError('CheckpointOverflow')<{ readonly bytes: number; readonly limit: number }> {
  override get message(): string {
    return `the screen needs at least ${this.bytes} bytes against the declared frame budget of ${this.limit}`;
  }
}

const screenBytes = Effect.fn('ScreenPoint.bytes')(function* (checkpoint: ScreenCheckpoint, limit: number) {
  const encoder = new TextEncoder();
  const pieces: Uint8Array[] = [];
  let block = new Uint8Array(Math.min(limit, SLICE_BYTES));
  let used = 0;
  let size = 0;
  let work = 0;
  for (const text of withLinks(checkpoint)) {
    if (text === undefined) {
      yield* Effect.yieldNow;
      continue;
    }
    for (let at = 0; at < text.length;) {
      if (size + text.length - at > limit) return yield* new CheckpointOverflow({ bytes: size + text.length - at, limit });
      let end = Math.min(at + SLICE_BYTES, text.length);
      if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end -= 1;
      const bytes = encoder.encode(text.slice(at, end));
      size += bytes.length;
      if (size > limit) return yield* new CheckpointOverflow({ bytes: size, limit });
      for (let from = 0; from < bytes.length;) {
        const count = Math.min(block.length - used, bytes.length - from);
        block.set(bytes.subarray(from, from + count), used);
        used += count;
        from += count;
        if (used === block.length) {
          pieces.push(block);
          block = new Uint8Array(Math.min(limit - size + bytes.length - from, SLICE_BYTES));
          used = 0;
        }
      }
      at = end;
      work += bytes.length;
      if (work >= SLICE_BYTES) {
        yield* Effect.yieldNow;
        work = 0;
      }
    }
  }
  if (used > 0) pieces.push(block.subarray(0, used));
  const joined = new Uint8Array(size);
  let at = 0;
  for (const piece of pieces) {
    joined.set(piece, at);
    at += piece.length;
    yield* Effect.yieldNow;
  }
  return joined;
});

const standingPoint = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  record: SegmentRecord,
  limits: ExecutionLimits,
  history: number,
  colors: TerminalColors,
): Effect.fn.Return<ScreenCheckpoint | ScreenUnavailable> {
  const { positions, grid } = yield* record.standing('pty', 0n).pipe(Effect.orDie);
  const born = grid ?? { rows: limits.geometry.rows, columns: limits.geometry.columns };
  const point = pointOf(
    yield* standingCheckpoint(fs, path, record.directory),
    offsetValue(positions.retainedFrom),
    offsetValue(positions.durableThrough),
    born,
    positions.durableThrough,
  );
  if (point._tag === 'Lost') return unavailable(record.ref, point.failure.parsedThrough, point.failure.reason, point.failure.detail);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const restored = yield* makeInterpretation({
        mode: 'restore',
        ref: record.ref,
        point,
        limits,
        colors,
        history,
        reply: () => Effect.succeed({ delivered: false, ending: true, detail: 'this screen is replayed for a viewer' }),
      });
      const checkpoint = yield* restored.point(history);
      return (
        checkpoint ?? unavailable(record.ref, point.checkpoint.position, 'checkpoint', 'the saved screen did not restore at parser rest')
      );
    }),
  ).pipe(
    Effect.catchTag('InterpretationUnavailable', (failure) =>
      Effect.succeed(unavailable(record.ref, failure.parsedThrough, failure.reason, failure.detail)),
    ),
    Effect.catchTag('CheckpointUnwritable', (failure) =>
      Effect.succeed(unavailable(record.ref, failure.parsedThrough, 'budget', failure.detail)),
    ),
  );
});

export const screenPoint = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  record: SegmentRecord,
  interpretation: Interpretation | undefined,
  limits: ExecutionLimits,
  history: number,
  colors: TerminalColors,
): Effect.fn.Return<ScreenPointed> {
  if (interpretation === undefined)
    return unavailable(record.ref, byteOffset(0n), 'transport', 'this execution runs over pipes and has no terminal to interpret');
  const fresh = yield* Effect.result(interpretation.point(history));
  if (fresh._tag === 'Failure') {
    const failure = fresh.failure;
    return unavailable(
      record.ref,
      failure.parsedThrough,
      failure._tag === 'CheckpointUnwritable' ? 'budget' : failure.reason,
      failure.detail,
    );
  }
  const checkpoint = fresh.success ?? (yield* standingPoint(fs, path, record, limits, history, colors));
  if ('_tag' in checkpoint) return checkpoint;
  return yield* Effect.map(screenBytes(checkpoint, limits.frame.bytes), (bytes): ScreenPointed => ({
    _tag: 'ScreenPoint',
    ref: record.ref,
    position: checkpoint.position,
    geometry: checkpoint.geometry,
    bytes,
  })).pipe(
    Effect.catchTag('CheckpointOverflow', (failure) =>
      Effect.succeed(unavailable(record.ref, checkpoint.position, 'budget', failure.message)),
    ),
  );
});
