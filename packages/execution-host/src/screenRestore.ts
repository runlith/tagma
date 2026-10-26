import { Effect, Exit, FileSystem, Path, Scope } from 'effect';
import type { TerminalColors } from '@runlith/executions/protocol/appearance';
import type { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { byteOffset, offsetValue, sameGeometry, type ByteOffset, type TerminalGeometry } from '@runlith/executions/protocol/record';
import { abandonCheckpoint, keepTaken, standingCheckpoint, type CheckpointStanding } from './checkpointFile';
import { RecordReadFailed, type ReadFailure, type SegmentRecord } from './ExecutionRecord';
import { makeInterpretation, InterpretationUnavailable, type Interpretation, type ReplySink, type RestorePoint } from './Interpretation';

const lost = (geometry: TerminalGeometry, parsedThrough: bigint, detail: string): RestorePoint => ({
  _tag: 'Lost',
  geometry,
  failure: new InterpretationUnavailable({ reason: 'checkpoint', parsedThrough: byteOffset(parsedThrough), detail }),
});

export const pointOf = (
  standing: CheckpointStanding,
  retainedFrom: bigint,
  durable: bigint,
  born: TerminalGeometry,
  frontier: ByteOffset,
): RestorePoint => {
  if (standing._tag === 'Abandoned') return { _tag: 'Lost', geometry: born, failure: standing.failure };
  if (standing._tag === 'Unreadable') return lost(born, retainedFrom, `the screen checkpoint could not be read: ${standing.detail}`);
  if (standing._tag === 'Absent') {
    if (retainedFrom > 0n)
      return lost(born, retainedFrom, `no screen checkpoint stands and the output before ${retainedFrom} is no longer retained`);
    return { _tag: 'Checkpoint', checkpoint: { position: byteOffset(0n), geometry: born, links: [], bytes: [] }, frontier };
  }
  const position = offsetValue(standing.checkpoint.position);
  if (position < retainedFrom) {
    return lost(born, retainedFrom, `the screen checkpoint at ${position} predates the retained output from ${retainedFrom}`);
  }
  if (position > durable) {
    return lost(born, retainedFrom, `the screen checkpoint at ${position} stands past the ${durable} bytes the record holds`);
  }
  return { _tag: 'Checkpoint', checkpoint: standing.checkpoint, frontier };
};

const acknowledged = (record: SegmentRecord, parsed: ByteOffset): Effect.Effect<void> =>
  record.acknowledgeParsed('pty', parsed).pipe(
    Effect.catchTag('FrontierRefused', () => Effect.void),
    Effect.orDie,
  );

const replay = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  record: SegmentRecord,
  interpretation: Interpretation,
  from: bigint,
  through: bigint,
  geometry: TerminalGeometry,
  chunkBytes: number,
): Effect.fn.Return<void, ReadFailure> {
  const abandoned = (failure: InterpretationUnavailable) =>
    Effect.andThen(
      record.abandonInterpretation(),
      Effect.flatMap(Effect.result(abandonCheckpoint(fs, path, record.directory, failure)), (kept) =>
        kept._tag === 'Failure' ? Effect.logWarning('the abandoned screen was not recorded beside its record', kept.failure) : Effect.void,
      ),
    );
  let standing = geometry;
  const laid = Effect.fnUntraced(function* (grid: TerminalGeometry | undefined, at: bigint) {
    if (grid === undefined || sameGeometry(grid, standing)) return true;
    standing = grid;
    const resized = yield* Effect.result(interpretation.resize(grid, byteOffset(at)));
    if (resized._tag === 'Success') return true;
    yield* abandoned(resized.failure);
    return false;
  });
  let offset = from;
  while (offset < through) {
    const read = yield* record.read(
      { ref: record.ref, stream: 'pty', offset: byteOffset(offset) },
      Math.min(chunkBytes, Number(through - offset)),
    );
    if (read.range.gap || read.bytes.length === 0) {
      return yield* new RecordReadFailed({
        stream: 'pty',
        act: 'missing',
        detail: `the record no longer carries the output from ${offset}`,
      });
    }
    if (!(yield* laid(read.range.grid, offset))) return;
    const fed = yield* Effect.result(interpretation.burst(read.bytes));
    if (fed._tag === 'Failure') return yield* abandoned(fed.failure);
    yield* acknowledged(record, fed.success.parsed);
    if (fed.success.checkpoint !== undefined) yield* keepTaken(fs, path, record.directory, fed.success.checkpoint);
    offset = offsetValue(read.range.next);
  }
  const settled = yield* record.standing('pty', through).pipe(Effect.orDie);
  yield* laid(settled.grid, through);
});

export const restoreScreen = Effect.fnUntraced(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  record: SegmentRecord,
  ref: ExecutionRef,
  limits: ExecutionLimits,
  colors: TerminalColors,
  reply: ReplySink,
  frontier: ByteOffset | undefined,
): Effect.fn.Return<Interpretation, InterpretationUnavailable, Scope.Scope> {
  const { positions, grid } = yield* record.standing('pty', 0n).pipe(Effect.orDie);
  const retainedFrom = offsetValue(positions.retainedFrom);
  const durable = offsetValue(positions.durableThrough);
  const born = grid ?? { rows: limits.geometry.rows, columns: limits.geometry.columns };
  const standing = yield* standingCheckpoint(fs, path, record.directory);
  const point = pointOf(standing, retainedFrom, durable, born, frontier ?? positions.durableThrough);
  if (point._tag === 'Lost') {
    yield* record.abandonInterpretation();
    return yield* makeInterpretation({ mode: 'restore', ref, limits, colors, reply, point });
  }
  const attempt = yield* Scope.fork(yield* Scope.Scope);
  const restored = yield* makeInterpretation({ mode: 'restore', ref, limits, colors, reply, point }).pipe(
    Scope.provide(attempt),
    Effect.tapError(() => Effect.andThen(Scope.close(attempt, Exit.void), record.abandonInterpretation())),
  );
  const { position: at, geometry } = point.checkpoint;
  yield* acknowledged(record, at);
  const replayed = yield* Effect.result(replay(fs, path, record, restored, offsetValue(at), durable, geometry, limits.read.chunkBytes));
  if (replayed._tag === 'Success') return restored;
  yield* Scope.close(attempt, Exit.void);
  yield* record.abandonInterpretation();
  return yield* makeInterpretation({
    mode: 'restore',
    ref,
    limits,
    colors,
    reply,
    point: lost(born, retainedFrom, `the retained output after the screen checkpoint could not be replayed: ${replayed.failure._tag}`),
  });
});
