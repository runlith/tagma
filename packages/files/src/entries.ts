import type { BigIntStats, Dirent } from 'node:fs';
import { lstat, open, readdir, readFile, readlink, rmdir, unlink } from 'node:fs/promises';
import { ByteSize, Effect, FileSystem, Option, PlatformError, Result } from 'effect';
import { type Entry, sameBytes, sameEntryVersion } from './replace';

export type Listed = { readonly name: string; readonly kind: Entry['kind'] | null };

export type Kept = { readonly bytes: Uint8Array } | { readonly link: string } | { readonly prefix: Uint8Array } | null;

export type Read = { readonly entry: Entry | undefined; readonly bytes: Uint8Array | null };

export type Removal = { readonly path: string; readonly selected: Entry; readonly kept: Kept };

export type Gone = 'removed' | 'changed' | 'absent';

export type Each<A> = readonly Result.Result<A, PlatformError.PlatformError>[];

export type Entries = {
  readonly list: (directory: string) => Effect.Effect<readonly Listed[], PlatformError.PlatformError>;
  readonly at: (path: string) => Effect.Effect<Entry | undefined, PlatformError.PlatformError>;
  readonly unlink: (path: string) => Effect.Effect<void, PlatformError.PlatformError>;
  readonly rmdir: (path: string) => Effect.Effect<void, PlatformError.PlatformError>;
  readonly readAll: (paths: readonly string[], whole: number) => Effect.Effect<Each<Read>>;
  readonly removeAll: (removals: readonly Removal[]) => Effect.Effect<Each<Gone>>;
  readonly unlinkAll: (paths: readonly string[]) => Effect.Effect<Each<void>>;
};

export const LANES = 8;

export const stands = (kept: Kept, now: Uint8Array | string | null): boolean => {
  if (kept === null) return true;
  if (now === null) return false;
  if ('link' in kept) return now === kept.link;
  if (typeof now === 'string') return false;
  return sameBytes('bytes' in kept ? now : now.subarray(0, kept.prefix.byteLength), 'bytes' in kept ? kept.bytes : kept.prefix);
};

const REASONS: Readonly<Record<string, PlatformError.SystemErrorTag>> = {
  ENOENT: 'NotFound',
  EACCES: 'PermissionDenied',
  EPERM: 'PermissionDenied',
  EEXIST: 'AlreadyExists',
  EISDIR: 'BadResource',
  ENOTDIR: 'BadResource',
  ENOTEMPTY: 'BadResource',
  ELOOP: 'BadResource',
  EBUSY: 'Busy',
};

const failure = (method: string, path: string) => (cause: unknown) => {
  const code = cause !== null && typeof cause === 'object' && 'code' in cause ? String(cause.code) : undefined;
  return PlatformError.systemError({
    _tag: (code === undefined ? undefined : REASONS[code]) ?? 'Unknown',
    module: 'FileSystem',
    method,
    pathOrDescriptor: path,
    cause,
    description: cause instanceof Error ? cause.message : String(cause),
  });
};

const absent = (cause: unknown): boolean => {
  const code = cause !== null && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

const typeOf = (info: BigIntStats): FileSystem.File.Type =>
  info.isFile()
    ? 'File'
    : info.isDirectory()
      ? 'Directory'
      : info.isSymbolicLink()
        ? 'SymbolicLink'
        : info.isBlockDevice()
          ? 'BlockDevice'
          : info.isCharacterDevice()
            ? 'CharacterDevice'
            : info.isFIFO()
              ? 'FIFO'
              : info.isSocket()
                ? 'Socket'
                : 'Unknown';

const counted = (value: bigint): Option.Option<number> => Option.some(Number(value));

export const infoOf = (info: BigIntStats): FileSystem.File.Info => ({
  type: typeOf(info),
  mtime: Option.fromNullishOr(info.mtime),
  atime: Option.fromNullishOr(info.atime),
  birthtime: Option.fromNullishOr(info.birthtime),
  dev: Number(info.dev),
  rdev: counted(info.rdev),
  ino: counted(info.ino),
  mode: Number(info.mode),
  nlink: counted(info.nlink),
  uid: counted(info.uid),
  gid: counted(info.gid),
  size: ByteSize.bytes(info.size),
  blksize: Option.some(ByteSize.bytes(info.blksize)),
  blocks: counted(info.blocks),
});

export const kindOf = (type: FileSystem.File.Type): Exclude<Entry['kind'], 'link'> =>
  type === 'Directory' ? 'directory' : type === 'File' ? 'file' : 'special';

const listedKind = (entry: Dirent): Entry['kind'] | null =>
  entry.isDirectory()
    ? 'directory'
    : entry.isFile()
      ? 'file'
      : entry.isSymbolicLink()
        ? 'link'
        : entry.isFIFO() || entry.isSocket() || entry.isBlockDevice() || entry.isCharacterDevice()
          ? 'special'
          : null;

const orNull = <A>(work: Promise<A>): Promise<A | null> => work.catch((cause: unknown) => (absent(cause) ? null : Promise.reject(cause)));

const entryOf = async (path: string): Promise<Entry | undefined> => {
  const info = await orNull(lstat(path, { bigint: true }));
  if (info === null) return undefined;
  if (!info.isSymbolicLink()) return { kind: kindOf(typeOf(info)), info: infoOf(info) };
  const target = await orNull(readlink(path));
  return target === null ? undefined : { kind: 'link', target };
};

const prefixOf = async (path: string, length: number): Promise<Uint8Array | null> => {
  const handle = await orNull(open(path, 'r'));
  if (handle === null) return null;
  try {
    const bytes = new Uint8Array(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await handle.read(bytes, read, length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return bytes.subarray(0, read);
  } finally {
    await handle.close();
  }
};

const nowOf = (path: string, kept: Kept): Promise<Uint8Array | string | null> =>
  kept === null
    ? Promise.resolve(null)
    : 'link' in kept
      ? orNull(readlink(path))
      : 'bytes' in kept
        ? orNull(readFile(path))
        : prefixOf(path, kept.prefix.byteLength);

const pooled = async <T, A>(items: readonly T[], run: (item: T) => Promise<A>): Promise<A[]> => {
  const done: A[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const at = next++;
      done[at] = await run(items[at]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LANES, items.length) }, lane));
  return done;
};

const each = <T, A>(items: readonly T[], method: string, pathOf: (item: T) => string, run: (item: T) => Promise<A>) =>
  Effect.promise(() =>
    pooled(items, (item) =>
      run(item).then(
        (value) => Result.succeed(value),
        (cause: unknown) => Result.fail(failure(method, pathOf(item))(cause)),
      ),
    ),
  );

export const machineEntries: Entries = {
  list: (directory) =>
    Effect.tryPromise({
      try: async () => (await readdir(directory, { withFileTypes: true })).map((one) => ({ name: one.name, kind: listedKind(one) })),
      catch: failure('readDirectory', directory),
    }),
  at: (path) => Effect.tryPromise({ try: () => entryOf(path), catch: failure('lstat', path) }),
  unlink: (path) => Effect.tryPromise({ try: () => unlink(path), catch: failure('unlink', path) }),
  rmdir: (path) => Effect.tryPromise({ try: () => rmdir(path), catch: failure('rmdir', path) }),
  readAll: (paths, whole) =>
    each(
      paths,
      'readFile',
      (path) => path,
      async (path): Promise<Read> => {
        const entry = await entryOf(path);
        if (entry?.kind !== 'file' || entry.info.size > ByteSize.bytes(whole)) return { entry, bytes: null };
        return { entry, bytes: await orNull(readFile(path)) };
      },
    ),
  removeAll: (removals) =>
    each(
      removals,
      'unlink',
      (one) => one.path,
      async ({ path, selected, kept }): Promise<Gone> => {
        if (!stands(kept, await nowOf(path, kept))) return 'changed';
        const actual = await entryOf(path);
        if (actual === undefined) return 'absent';
        if (!sameEntryVersion(selected, actual)) return 'changed';
        await (selected.kind === 'directory' ? rmdir(path) : unlink(path));
        return 'removed';
      },
    ),
  unlinkAll: (paths) =>
    each(
      paths,
      'unlink',
      (path) => path,
      (path) => unlink(path),
    ),
};
