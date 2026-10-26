import { Effect, type FileSystem, Stream } from 'effect';
import { BINARY_PROBE, looksBinary } from '@runlith/files/content';
import type { PlatformError } from 'effect/PlatformError';
import type { CheckoutLines } from '../contract/wire/checkout.js';

export const READING_CAPTURE = 4_000_000;

const NEWLINE = 0x0a;

const countOf = (bytes: Uint8Array): CheckoutLines => {
  if (looksBinary(bytes)) return 'binary';
  if (bytes.length === 0) return { added: 0, removed: 0 };
  let added = 0;
  for (let at = 0; at < bytes.length; at += 1) if (bytes[at] === NEWLINE) added += 1;
  if (bytes[bytes.length - 1] !== NEWLINE) added += 1;
  return { added, removed: 0 };
};

export const opensBinary = (files: FileSystem.FileSystem, at: string): Effect.Effect<boolean, PlatformError> =>
  Stream.runFold(
    files.stream(at, { bytesToRead: BINARY_PROBE, chunkSize: BINARY_PROBE }),
    () => false,
    (seen, chunk) => seen || looksBinary(chunk),
  );

export const untrackedWeight = Effect.fn('checkouts.untrackedWeight')(
  function* (files: FileSystem.FileSystem, dir: string, path: string): Effect.fn.Return<CheckoutLines, PlatformError> {
    const at = `${dir}/${path}`;
    const info = yield* files.stat(at);
    if (info.size > BigInt(READING_CAPTURE)) return (yield* opensBinary(files, at)) ? 'binary' : 'unweighed';
    return countOf(yield* files.readFile(at));
  },
  (effect, _files, dir, path) =>
    effect.pipe(
      Effect.catchTag('PlatformError', (failure) =>
        Effect.as(Effect.logDebug('an untracked file could not be weighed', { dir, path, reason: failure.message }), 'unweighed' as const),
      ),
    ),
);
