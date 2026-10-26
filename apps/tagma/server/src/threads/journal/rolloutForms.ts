import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import type { Duplex } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createZstdCompress, createZstdDecompress } from 'node:zlib';
import { Effect } from 'effect';
import { RolloutUnreadable, fileSize, rolloutStream } from './rolloutFile.js';
import { RolloutReads, type ReadRollout } from '../contract/service/rolloutReads.js';
import type { RolloutFiles } from '../contract/service/rested.js';

export const ROLLOUT_SUFFIX = '.jsonl';
export const COMPRESSED_ROLLOUT_SUFFIX = '.zst';
export const TRANSCRIPT_SUFFIX = '.entries';

export function transcriptOf(path: string): string {
  return `${path}${TRANSCRIPT_SUFFIX}`;
}

export function rolloutFiles(path: string): RolloutFiles {
  return { path, packed: compressedRollout(path), transcript: transcriptOf(path) };
}

export type RolloutState = {
  readonly form: 'plain' | 'compressed';
  readonly path: string;
  readonly bytes: number;
};

export function compressedRollout(path: string): string {
  return `${path}${COMPRESSED_ROLLOUT_SUFFIX}`;
}

export function rolloutThreadId(file: string): string | null {
  const packed = `${ROLLOUT_SUFFIX}${COMPRESSED_ROLLOUT_SUFFIX}`;
  if (file.endsWith(packed)) return file.slice(0, -packed.length);
  if (file.endsWith(ROLLOUT_SUFFIX)) return file.slice(0, -ROLLOUT_SUFFIX.length);
  return null;
}

export function rolloutStateOf(path: string): Effect.Effect<RolloutState | null> {
  return Effect.promise(async () => {
    const plain = await fileSize(path);
    if (plain !== null) return { form: 'plain', path, bytes: plain };
    const packed = compressedRollout(path);
    const compressed = await fileSize(packed);
    return compressed === null ? null : { form: 'compressed', path: packed, bytes: compressed };
  });
}

export const compressRollout = Effect.fnUntraced(function* (path: string, replaced: Effect.Effect<void, RolloutUnreadable> = Effect.void) {
  if ((yield* rolloutStateOf(path))?.form !== 'plain') return;
  const packed = compressedRollout(path);
  yield* streamed(path, `${packed}.partial`, createZstdCompress());
  yield* replaced;
  yield* onDisk(path, async () => {
    await rename(`${packed}.partial`, packed);
    await rm(path, { force: true });
  });
});

export const openRollout = Effect.fnUntraced(function* (path: string, replaced: Effect.Effect<void, RolloutUnreadable> = Effect.void) {
  const packed = compressedRollout(path);
  if ((yield* rolloutStateOf(path))?.form === 'plain') {
    if ((yield* Effect.promise(() => fileSize(packed))) !== null) yield* onDisk(path, () => rm(packed, { force: true }));
    return;
  }
  if ((yield* Effect.promise(() => fileSize(packed))) === null) return;
  yield* streamed(packed, `${path}.opening`, createZstdDecompress());
  yield* replaced;
  yield* onDisk(path, async () => {
    await rename(`${path}.opening`, path);
    await rm(packed, { force: true });
  });
});

export async function streamedRollout(path: string, read: ReadRollout): Promise<AsyncIterable<Buffer> | null> {
  if ((await fileSize(path)) !== null) return rolloutStream(path, read);
  const packed = compressedRollout(path);
  if ((await fileSize(packed)) === null) return null;
  const source = rolloutStream(packed, read);
  const opened = createZstdDecompress();
  source.on('error', (error) => opened.destroy(error));
  opened.on('close', () => source.destroy());
  return source.pipe(opened);
}

export function releaseRollout(path: string): Effect.Effect<void> {
  return Effect.promise(async () => {
    await rm(path, { force: true });
    await rm(compressedRollout(path), { force: true });
    await rm(transcriptOf(path), { force: true });
  });
}

function streamed(from: string, to: string, codec: Duplex): Effect.Effect<void, RolloutUnreadable> {
  return Effect.flatMap(RolloutReads, (read) =>
    Effect.tryPromise({
      try: () => pipeline(rolloutStream(from, read), codec, createWriteStream(to)),
      catch: (error) => failed(from, error),
    }),
  ).pipe(Effect.tapError(() => Effect.promise(() => rm(to, { force: true }))));
}

function onDisk(path: string, act: () => Promise<void>): Effect.Effect<void, RolloutUnreadable> {
  return Effect.tryPromise({ try: act, catch: (error) => failed(path, error) });
}

function failed(path: string, error: unknown): RolloutUnreadable {
  return new RolloutUnreadable({ reason: 'io', path, message: error instanceof Error ? error.message : String(error) });
}
