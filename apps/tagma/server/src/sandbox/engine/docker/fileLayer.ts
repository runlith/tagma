import { ByteSize, Effect, FileSystem, Layer, Option, PlatformError, Stream } from 'effect';
import { kindOf, LANES, stands, type Entries, type Listed, type Read } from '@runlith/files/entries';
import { sameEntryVersion, type Entry } from '@runlith/files/replace';
import type { GuestChannel } from './channel.js';
import { brokenAsFailure, guestFailure, type GuestRequest } from './wire.js';

function fileInfo(said: Record<string, unknown>): FileSystem.File.Info {
  const info = said as Record<string, number | string>;
  const when = (name: string): Option.Option<Date> => {
    const value = info[name];
    return typeof value === 'number' ? Option.some(new Date(value)) : Option.none();
  };
  const count = (name: string): Option.Option<number> => {
    const value = info[name];
    return typeof value === 'number' ? Option.some(value) : Option.none();
  };
  return {
    type: (info.type as FileSystem.File.Type | undefined) ?? 'Unknown',
    mtime: when('mtime'),
    atime: when('atime'),
    birthtime: when('birthtime'),
    dev: typeof info.dev === 'number' ? info.dev : 0,
    ino: count('ino'),
    mode: typeof info.mode === 'number' ? info.mode : 0,
    nlink: count('nlink'),
    uid: count('uid'),
    gid: count('gid'),
    rdev: count('rdev'),
    size: ByteSize.bytes(typeof info.size === 'number' ? info.size : 0),
    blksize: Option.map(count('blksize'), (value) => ByteSize.bytes(value)),
    blocks: count('blocks'),
  };
}

const asking =
  (channel: GuestChannel) =>
  (
    method: string,
    path: string | undefined,
    request: GuestRequest,
    payload?: Uint8Array,
  ): Effect.Effect<{ readonly value: Record<string, unknown>; readonly payload: Uint8Array }, PlatformError.PlatformError> =>
    channel.call(request, payload).pipe(
      Effect.mapError((broken) => brokenAsFailure(method, broken)),
      Effect.flatMap((frame) =>
        frame.ok
          ? Effect.succeed({ value: frame.value, payload: frame.payload })
          : Effect.fail(guestFailure(method, path, (frame.value.error ?? {}) as Record<string, unknown>)),
      ),
    );

const LISTED_KINDS = new Set(['file', 'directory', 'link', 'special']);

const absentFailure = (failure: PlatformError.PlatformError): boolean => {
  const code = (failure.reason.cause as { readonly code?: unknown } | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

export const guestEntries = (channel: GuestChannel): Entries => {
  const ask = asking(channel);
  const orNull = <A>(work: Effect.Effect<A, PlatformError.PlatformError>) =>
    work.pipe(
      Effect.map((value): A | null => value),
      Effect.catchIf(absentFailure, () => Effect.succeed(null)),
    );
  const at = (path: string) =>
    ask('lstat', path, { op: 'entry', path }).pipe(
      Effect.map((said): Entry => {
        if (typeof said.value.link === 'string') return { kind: 'link', target: said.value.link };
        const info = fileInfo(said.value.info as Record<string, unknown>);
        return { kind: kindOf(info.type), info };
      }),
      Effect.catchIf(absentFailure, () => Effect.succeed(undefined)),
    );
  const read = (path: string) => orNull(Effect.map(ask('readFile', path, { op: 'readFile', path }), (said) => said.payload));
  const unlink = (path: string) => Effect.asVoid(ask('unlink', path, { op: 'unlink', path }));
  const rmdir = (path: string) => Effect.asVoid(ask('rmdir', path, { op: 'rmdir', path }));
  return {
    list: (directory) =>
      ask('readDirectory', directory, { op: 'list', path: directory }).pipe(
        Effect.map((said) =>
          ((said.value.entries as { readonly name: string; readonly kind: unknown }[] | undefined) ?? []).map((one): Listed => ({
            name: one.name,
            kind: LISTED_KINDS.has(String(one.kind)) ? (one.kind as Listed['kind']) : null,
          })),
        ),
      ),
    at,
    unlink,
    rmdir,
    readAll: (paths, whole) =>
      Effect.forEach(
        paths,
        (path) =>
          Effect.result(
            Effect.flatMap(at(path), (entry): Effect.Effect<Read, PlatformError.PlatformError> =>
              entry?.kind !== 'file' || entry.info.size > ByteSize.bytes(whole)
                ? Effect.succeed({ entry, bytes: null })
                : Effect.map(read(path), (bytes) => ({ entry, bytes })),
            ),
          ),
        { concurrency: LANES },
      ),
    removeAll: (removals) =>
      Effect.forEach(
        removals,
        ({ path, selected, kept }) =>
          Effect.result(
            Effect.gen(function* () {
              const now =
                kept === null
                  ? null
                  : 'link' in kept
                    ? yield* orNull(Effect.map(ask('readLink', path, { op: 'readLink', path }), (said) => String(said.value.target)))
                    : yield* read(path);
              if (!stands(kept, now)) return 'changed' as const;
              const actual = yield* at(path);
              if (actual === undefined) return 'absent' as const;
              if (!sameEntryVersion(selected, actual)) return 'changed' as const;
              yield* selected.kind === 'directory' ? rmdir(path) : unlink(path);
              return 'removed' as const;
            }),
          ),
        { concurrency: LANES },
      ),
    unlinkAll: (paths) => Effect.forEach(paths, (path) => Effect.result(unlink(path)), { concurrency: LANES }),
  };
};

export const guestFileLayer = (channel: GuestChannel): Layer.Layer<FileSystem.FileSystem> => {
  const ask = asking(channel);

  const done = (method: string, path: string | undefined, request: GuestRequest): Effect.Effect<void, PlatformError.PlatformError> =>
    Effect.asVoid(ask(method, path, request));

  const makeTempDirectory = (
    method: string,
    options?: { readonly directory?: string | undefined; readonly prefix?: string | undefined },
  ): Effect.Effect<string, PlatformError.PlatformError> =>
    ask(method, options?.directory, {
      op: 'makeTempDirectory',
      directory: options?.directory,
      prefix: options?.prefix,
    }).pipe(Effect.map((said) => String(said.value.path)));

  const remove = (
    method: string,
    path: string,
    options?: { readonly recursive?: boolean | undefined; readonly force?: boolean | undefined },
  ): Effect.Effect<void, PlatformError.PlatformError> =>
    done(method, path, { op: 'remove', path, recursive: options?.recursive === true, force: options?.force === true });

  const writeFile = (
    path: string,
    data: Uint8Array,
    options?: { readonly flag?: FileSystem.OpenFlag | undefined; readonly mode?: number | undefined },
  ): Effect.Effect<void, PlatformError.PlatformError> =>
    Effect.asVoid(
      ask(
        'writeFile',
        path,
        {
          op: 'writeFile',
          path,
          flag: options?.flag ?? 'w',
          mode: options?.mode,
        },
        data,
      ),
    );

  const openFile = (
    path: string,
    options?: { readonly flag?: FileSystem.OpenFlag | undefined; readonly mode?: number | undefined },
  ): Effect.Effect<FileSystem.File, PlatformError.PlatformError, import('effect').Scope.Scope> => {
    const flag = options?.flag ?? 'r';
    return Effect.acquireRelease(
      ask('open', path, {
        op: 'open',
        path,
        flag,
        mode: options?.mode,
      }).pipe(Effect.map((said) => Number(said.value.handle))),
      (handle) => Effect.ignore(done('close', path, { op: 'close', handle })),
    ).pipe(Effect.map((handle) => guestFile(handle, path, flag.startsWith('a'))));
  };

  const guestFile = (handle: number, path: string, append: boolean): FileSystem.File => {
    let position = BigInt(0);
    const read = (method: string, length: number): Effect.Effect<Uint8Array, PlatformError.PlatformError> =>
      Effect.suspend(() =>
        ask(method, path, { op: 'fread', handle, position: Number(position), length }).pipe(
          Effect.map((said) => {
            position += BigInt(said.payload.length);
            return said.payload;
          }),
        ),
      );
    const write = (method: string, buffer: Uint8Array): Effect.Effect<number, PlatformError.PlatformError> =>
      Effect.suspend(() =>
        ask(method, path, { op: 'fwrite', handle, position: append ? null : Number(position) }, buffer).pipe(
          Effect.map((said) => {
            const written = Number(said.value.written);
            if (!append) position += BigInt(written);
            return written;
          }),
        ),
      );
    const writeAll = (buffer: Uint8Array): Effect.Effect<void, PlatformError.PlatformError> =>
      write('writeAll', buffer).pipe(
        Effect.flatMap((written) =>
          written === 0
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: 'WriteZero',
                  module: 'FileSystem',
                  method: 'writeAll',
                  pathOrDescriptor: path,
                  description: 'the guest wrote no bytes',
                }),
              )
            : written < buffer.length
              ? writeAll(buffer.subarray(written))
              : Effect.void,
        ),
      );
    return {
      [FileSystem.FileTypeId]: FileSystem.FileTypeId,
      stat: ask('stat', path, { op: 'fstat', handle }).pipe(Effect.map((said) => fileInfo(said.value.info as Record<string, unknown>))),
      seek: (offset, from) =>
        Effect.sync(() => {
          position = from === 'start' ? offset : position + offset;
          return position;
        }),
      sync: done('sync', path, { op: 'fsync', handle }),
      read: (buffer) =>
        read('read', buffer.length).pipe(
          Effect.map((bytes) => {
            buffer.set(bytes.subarray(0, buffer.length));
            return bytes.length;
          }),
        ),
      readAlloc: (size) =>
        read('readAlloc', Number(size)).pipe(Effect.map((bytes) => (bytes.length === 0 ? Option.none<Uint8Array>() : Option.some(bytes)))),
      truncate: (length) =>
        done('truncate', path, { op: 'ftruncate', handle, length: Number(length ?? 0) }).pipe(
          Effect.map(() => {
            if (append) return;
            const cut = BigInt(length ?? 0);
            if (position > cut) position = cut;
          }),
        ),
      write: (buffer) => write('write', buffer),
      writeAll,
    };
  };

  return Layer.succeed(
    FileSystem.FileSystem,
    FileSystem.make({
      access: (path, options) =>
        done('access', path, {
          op: 'access',
          path,
          readable: options?.readable === true,
          writable: options?.writable === true,
        }),
      copy: (fromPath, toPath, options) =>
        done('copy', fromPath, {
          op: 'copy',
          from: fromPath,
          to: toPath,
          overwrite: options?.overwrite === true,
          preserveTimestamps: options?.preserveTimestamps === true,
        }),
      copyFile: (fromPath, toPath) => done('copyFile', fromPath, { op: 'copyFile', from: fromPath, to: toPath }),
      chmod: (path, mode) => done('chmod', path, { op: 'chmod', path, mode }),
      chown: (path, uid, gid) => done('chown', path, { op: 'chown', path, uid, gid }),
      glob: (pattern, options) =>
        ask('glob', options?.root, {
          op: 'glob',
          pattern,
          root: options?.root,
          exclude: options?.exclude === undefined ? undefined : [...options.exclude],
        }).pipe(Effect.map((said) => (said.value.names as string[] | undefined) ?? [])),
      link: (fromPath, toPath) => done('link', fromPath, { op: 'link', from: fromPath, to: toPath }),
      makeDirectory: (path, options) =>
        done('makeDirectory', path, {
          op: 'makeDirectory',
          path,
          recursive: options?.recursive === true,
          mode: options?.mode,
        }),
      makeTempDirectory: (options) => makeTempDirectory('makeTempDirectory', options),
      makeTempDirectoryScoped: (options) =>
        Effect.acquireRelease(makeTempDirectory('makeTempDirectoryScoped', options), (made) =>
          Effect.ignore(remove('makeTempDirectoryScoped', made, { recursive: true })),
        ),
      makeTempFile: (options) => makeTempFile('makeTempFile', options),
      makeTempFileScoped: (options) =>
        Effect.acquireRelease(makeTempFile('makeTempFileScoped', options), (made) =>
          Effect.ignore(remove('makeTempFileScoped', made, { recursive: true })),
        ),
      open: openFile,
      readDirectory: (path, options) =>
        ask('readDirectory', path, { op: 'readDirectory', path, recursive: options?.recursive === true }).pipe(
          Effect.map((said) => (said.value.entries as string[] | undefined) ?? []),
        ),
      readFile: (path) => ask('readFile', path, { op: 'readFile', path }).pipe(Effect.map((said) => said.payload)),
      readLink: (path) => ask('readLink', path, { op: 'readLink', path }).pipe(Effect.map((said) => String(said.value.target))),
      realPath: (path) => ask('realPath', path, { op: 'realPath', path }).pipe(Effect.map((said) => String(said.value.path))),
      remove: (path, options) => remove('remove', path, options),
      rename: (oldPath, newPath) => done('rename', oldPath, { op: 'rename', from: oldPath, to: newPath }),
      stat: (path) =>
        ask('stat', path, { op: 'stat', path }).pipe(Effect.map((said) => fileInfo(said.value.info as Record<string, unknown>))),
      symlink: (fromPath, toPath) => done('symlink', fromPath, { op: 'symlink', from: fromPath, to: toPath }),
      truncate: (path, length) => done('truncate', path, { op: 'truncate', path, length: Number(length ?? 0) }),
      utimes: (path, atime, mtime) =>
        done('utimes', path, {
          op: 'utimes',
          path,
          atime: atime instanceof Date ? atime.getTime() : atime,
          mtime: mtime instanceof Date ? mtime.getTime() : mtime,
        }),
      watch: (path) =>
        Stream.fail(
          PlatformError.systemError({
            _tag: 'Unknown',
            module: 'FileSystem',
            method: 'watch',
            pathOrDescriptor: path,
            description: 'a guest filesystem is not watched',
          }),
        ),
      writeFile,
    }),
  );

  function makeTempFile(
    method: string,
    options?: {
      readonly directory?: string | undefined;
      readonly prefix?: string | undefined;
      readonly suffix?: string | undefined;
    },
  ): Effect.Effect<string, PlatformError.PlatformError> {
    return makeTempDirectory(method, options).pipe(
      Effect.flatMap((directory) => {
        const name = `${directory}/${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}${options?.suffix ?? ''}`;
        return Effect.as(writeFile(name, new Uint8Array(0)), name);
      }),
    );
  }
};
