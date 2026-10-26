import { Data, Effect, FileSystem, Layer } from 'effect';

const SERVE_LOG_CAP_BYTES = 256 * 1024 * 1024;
const SERVE_LOG_TAIL_BYTES = 32 * 1024 * 1024;
export const SERVE_LOG_KEPT = '.1';
const SERVE_LOG_CHECKED_EVERY = '1 minute';
const CHUNK_BYTES = 1024 * 1024;
const NEWLINE = 0x0a;

export type ServeLogKeep = {
  readonly cap: number;
  readonly tail: number;
};

export type ServeLogBound =
  | { readonly _tag: 'Absent' }
  | { readonly _tag: 'Kept'; readonly bytes: number }
  | { readonly _tag: 'Bound'; readonly was: number; readonly kept: number };

export class ServeLogUnbounded extends Data.TaggedError('ServeLogUnbounded')<{ readonly detail: string }> {
  override get message() {
    return this.detail;
  }
}

const keepTail = Effect.fn('composition.keepLogTail')(function* (path: string, size: number, tail: number) {
  const files = yield* FileSystem.FileSystem;
  const from = Math.max(0, size - tail);
  const source = yield* files.open(path, { flag: 'r' });
  const sink = yield* files.open(`${path}${SERVE_LOG_KEPT}`, { flag: 'w' });
  yield* source.seek(BigInt(from), 'start');
  const buffer = new Uint8Array(CHUNK_BYTES);
  let at = from;
  let written = 0;
  let aligned = from === 0;
  while (at < size) {
    const read = yield* source.read(buffer.subarray(0, Math.min(CHUNK_BYTES, size - at)));
    if (read === 0) break;
    let start = 0;
    if (!aligned) {
      aligned = true;
      const line = buffer.subarray(0, read).indexOf(NEWLINE);
      start = line >= 0 && line + 1 < read ? line + 1 : 0;
    }
    yield* sink.writeAll(buffer.subarray(start, read));
    written += read - start;
    at += read;
  }
  return written;
}, Effect.scoped);

export const boundServeLog = Effect.fn('composition.boundServeLog')(
  function* (path: string, keep: ServeLogKeep) {
    const files = yield* FileSystem.FileSystem;
    const size = yield* files.stat(path).pipe(
      Effect.map((info) => Number(info.size)),
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
    );
    if (size === null) return { _tag: 'Absent' } as const;
    if (size <= keep.cap) return { _tag: 'Kept', bytes: size } as const;
    const kept = yield* keepTail(path, size, keep.tail);
    yield* files.truncate(path, 0);
    return { _tag: 'Bound', was: size, kept } as const;
  },
  Effect.mapError((cause) => new ServeLogUnbounded({ detail: String(cause) })),
);

export const serveLogBounding = (serveLog: string) =>
  Layer.effectDiscard(
    Effect.forkScoped(
      Effect.forever(
        boundServeLog(serveLog, { cap: SERVE_LOG_CAP_BYTES, tail: SERVE_LOG_TAIL_BYTES }).pipe(
          Effect.flatMap((bound) =>
            bound._tag === 'Bound'
              ? Effect.logInfo('the serve log was bounded', { was: bound.was, kept: bound.kept, at: `${serveLog}${SERVE_LOG_KEPT}` })
              : Effect.void,
          ),
          Effect.catchTag('ServeLogUnbounded', (failure) =>
            Effect.logWarning('the serve log could not be bounded; it stands as it was', { reason: failure.detail }),
          ),
          Effect.andThen(Effect.sleep(SERVE_LOG_CHECKED_EVERY)),
        ),
      ),
    ),
  );
