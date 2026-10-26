import { constants } from 'node:fs';
import { type FileHandle, chmod, copyFile, mkdir, open, rename, stat, statfs, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Data, Effect } from 'effect';
import { type Flushed, flushDescriptor } from './flush.js';
import { UnitOpen } from '../store/transaction.js';
import { SpaceShort } from './space.js';

export type Durability = Flushed;

export type DurableStep = 'probe' | 'temporary' | 'write' | 'flush' | 'rename' | 'directory' | 'space';

export class DurableWriteFailed extends Data.TaggedError('DurableWriteFailed')<{
  readonly path: string;
  readonly step: DurableStep;
  readonly reason: string;
  readonly needed?: number;
}> {}

export class DurableWriteRefused extends Data.TaggedError('DurableWriteRefused')<{ readonly path: string; readonly reason: 'unit-open' }> {}

export type DurableFile = { readonly path: string; readonly bytes: string | Uint8Array; readonly mode?: number };

const volumes = new Map<number, Durability>();

const failed = (path: string, step: DurableStep) => (cause: unknown) =>
  cause instanceof SpaceShort
    ? new DurableWriteFailed({ path, step: 'space', reason: cause.message, needed: cause.needed })
    : new DurableWriteFailed({ path, step, reason: cause instanceof Error ? cause.message : String(cause) });

const outsideUnit = (path: string): Effect.Effect<void> =>
  Effect.flatMap(UnitOpen, (open) => (open ? Effect.die(new DurableWriteRefused({ path, reason: 'unit-open' })) : Effect.void));

const flushed = (handle: FileHandle, path: string, step: DurableStep): Effect.Effect<Durability, DurableWriteFailed> =>
  flushDescriptor(handle).pipe(Effect.mapError(failed(path, step)), Effect.uninterruptible);

const flushDirectory = (directory: string): Effect.Effect<void, DurableWriteFailed> =>
  process.platform === 'win32'
    ? Effect.void
    : Effect.acquireUseRelease(
        Effect.tryPromise({ try: () => open(directory, 'r'), catch: failed(directory, 'directory') }),
        (handle) => Effect.asVoid(flushed(handle, directory, 'directory')),
        (handle) => Effect.promise(() => handle.close()),
      );

const temporaryOf = (path: string): string =>
  join(dirname(path), `${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);

const writeTemporary = (
  file: DurableFile,
): Effect.Effect<{ readonly temporary: string; readonly flushed: Durability }, DurableWriteFailed> => {
  const temporary = temporaryOf(file.path);
  return Effect.acquireUseRelease(
    Effect.tryPromise({ try: () => open(temporary, 'wx', file.mode ?? 0o600), catch: failed(file.path, 'temporary') }),
    (handle) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({ try: () => handle.writeFile(file.bytes), catch: failed(file.path, 'write') });
        return { temporary, flushed: yield* flushed(handle, file.path, 'flush') };
      }),
    (handle) => Effect.promise(() => handle.close()),
  ).pipe(Effect.tapError(() => Effect.promise(() => unlink(temporary).catch(() => undefined))));
};

export const volumeDurability = Effect.fn('platform.durable.volume')(function* (directory: string) {
  const volume = (yield* Effect.tryPromise({ try: () => stat(directory), catch: failed(directory, 'probe') })).dev;
  const known = volumes.get(volume);
  if (known !== undefined) return known;
  const probe = yield* writeTemporary({ path: join(directory, '.tagma-durability-probe'), bytes: '\n' });
  yield* Effect.promise(() => unlink(probe.temporary).catch(() => undefined));
  volumes.set(volume, probe.flushed);
  if (probe.flushed === 'degraded') {
    yield* Effect.logWarning(`the volume holding ${directory} refuses a full flush: durability is degraded there`);
  }
  return probe.flushed;
});

export const replaceFile = (path: string, bytes: string | Uint8Array, mode?: number): Effect.Effect<Durability, DurableWriteFailed> =>
  batchFiles([{ path, bytes, mode }]);

export const makeDirectory = Effect.fnUntraced(function* (path: string) {
  yield* outsideUnit(path);
  const directory = resolve(path);
  const first = yield* Effect.tryPromise({
    try: () => mkdir(directory, { recursive: true, mode: 0o700 }),
    catch: failed(path, 'directory'),
  });
  if (first === undefined) return;
  for (let at = directory; ; at = dirname(at)) {
    yield* flushDirectory(at);
    if (at === dirname(first)) break;
  }
});

const checkSpace = async (path: string, bytes: number): Promise<void> => {
  if (!Number.isFinite(bytes) || bytes < 0) throw new Error(`invalid requested size ${bytes}`);
  const disk = await statfs(dirname(path));
  const required = Math.ceil(bytes / disk.bsize) * disk.bsize;
  const free = disk.bsize * disk.bavail;
  if (free < required) throw new SpaceShort(required, free);
};

export const requireSpace = (path: string, bytes: number): Effect.Effect<void, DurableWriteFailed> =>
  Effect.tryPromise({ try: () => checkSpace(path, bytes), catch: failed(path, 'write') });

export const cloneFile = Effect.fnUntraced(function* (from: string, to: string, options?: { readonly length?: number }) {
  yield* outsideUnit(to);
  yield* makeDirectory(dirname(to));
  yield* Effect.tryPromise({
    try: async () => {
      try {
        await copyFile(from, to, constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL);
      } catch (cause) {
        if (!['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EINVAL'].includes((cause as NodeJS.ErrnoException).code ?? '')) throw cause;
        await checkSpace(to, (await stat(from)).size);
        await copyFile(from, to, constants.COPYFILE_EXCL);
      }
      await chmod(to, 0o600);
    },
    catch: failed(to, 'write'),
  });
  const durability = yield* Effect.acquireUseRelease(
    Effect.tryPromise({ try: () => open(to, options?.length === undefined ? 'r' : 'r+'), catch: failed(to, 'flush') }),
    (file) =>
      Effect.gen(function* () {
        if (options?.length !== undefined)
          yield* Effect.tryPromise({ try: () => file.truncate(options.length), catch: failed(to, 'write') });
        return yield* flushed(file, to, 'flush');
      }),
    (file) => Effect.promise(() => file.close()),
  );
  yield* flushDirectory(dirname(to));
  return durability;
});

export const flushFile = Effect.fnUntraced(function* (path: string) {
  yield* outsideUnit(path);
  const durability = yield* Effect.acquireUseRelease(
    Effect.tryPromise({ try: () => open(path, 'r'), catch: failed(path, 'flush') }),
    (file) => flushed(file, path, 'flush'),
    (file) => Effect.promise(() => file.close()),
  );
  yield* flushDirectory(dirname(path));
  return durability;
});

export const moveFile = Effect.fnUntraced(function* (from: string, to: string) {
  yield* outsideUnit(to);
  const durability = yield* Effect.acquireUseRelease(
    Effect.tryPromise({ try: () => open(from, 'r'), catch: failed(from, 'flush') }),
    (file) => flushed(file, from, 'flush'),
    (file) => Effect.promise(() => file.close()),
  );
  yield* Effect.tryPromise({ try: () => rename(from, to), catch: failed(to, 'rename') });
  for (const path of new Set([dirname(from), dirname(to)])) yield* flushDirectory(path);
  return durability;
});

export const removeFile = Effect.fnUntraced(function* (path: string) {
  yield* outsideUnit(path);
  yield* Effect.tryPromise({
    try: () =>
      unlink(path).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code !== 'ENOENT') throw cause;
      }),
    catch: failed(path, 'directory'),
  });
  yield* flushDirectory(dirname(path));
});

export const batchFiles = Effect.fnUntraced(function* (files: readonly DurableFile[]) {
  for (const file of files) yield* outsideUnit(file.path);
  const written = yield* Effect.forEach(files, writeTemporary);
  for (const [index, file] of files.entries()) {
    const temporary = written[index]!.temporary;
    yield* Effect.tryPromise({ try: () => rename(temporary, file.path), catch: failed(file.path, 'rename') });
  }
  for (const directory of new Set(files.map((file) => dirname(file.path)))) yield* flushDirectory(directory);
  return written.some((file) => file.flushed === 'degraded') ? ('degraded' as const) : ('full' as const);
});
