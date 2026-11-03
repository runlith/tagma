import { closeSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { Effect, FileSystem, Option } from 'effect';
import type { PlatformError } from 'effect/PlatformError';

// eslint-disable-next-line no-control-regex
const ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|\r/g;

type TailWindow = { readonly lines: number; readonly bytes: number };

const unreachable = (what: string, path: string) => (failure: PlatformError) =>
  Effect.logWarning(`the log ${path} could not be ${what}: ${failure.message}`);

export const logLine = Effect.fnUntraced(
  function* (path: string, line: string) {
    const files = yield* FileSystem.FileSystem;
    yield* files.makeDirectory(dirname(path), { recursive: true });
    yield* files.writeFileString(path, `${line}\n`, { flag: 'a' });
  },
  (effect, path) => Effect.matchEffect(effect, { onSuccess: () => Effect.void, onFailure: unreachable('written', path) }),
);

export const logSink = Effect.fnUntraced(function* (path: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(dirname(path), { recursive: true });
  return yield* Effect.acquireRelease(
    Effect.sync(() => openSync(path, 'a')),
    (fd) => Effect.sync(() => closeSync(fd)),
  );
});

export const sizeOf = Effect.fnUntraced(
  function* (path: string) {
    const files = yield* FileSystem.FileSystem;
    return Number((yield* files.stat(path)).size);
  },
  (effect, path) =>
    effect.pipe(
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(0)),
      Effect.matchEffect({ onSuccess: Effect.succeed, onFailure: (failure) => Effect.as(unreachable('measured', path)(failure), 0) }),
    ),
);

const tailOf = (path: string, from: number, window: TailWindow): Effect.Effect<string[], PlatformError, FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const file = yield* files.open(path, { flag: 'r' });
      const size = Number((yield* file.stat).size);
      const start = Math.max(from, size - window.bytes);
      if (start >= size) return [];
      yield* file.seek(BigInt(start), 'start');
      const bytes = Option.getOrElse(yield* file.readAlloc(size - start), () => new Uint8Array());
      return new TextDecoder()
        .decode(bytes)
        .replace(ESCAPES, '')
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0)
        .slice(-window.lines);
    }),
  ).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed([])));

export const shownTail = (path: string, from: number, window: TailWindow): Effect.Effect<string[], never, FileSystem.FileSystem> =>
  Effect.matchEffect(tailOf(path, from, window), {
    onSuccess: Effect.succeed,
    onFailure: (failure) => Effect.as(unreachable('read for its tail', path)(failure), []),
  });
