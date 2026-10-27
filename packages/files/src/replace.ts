import { Effect, FileSystem, Option, type PlatformError } from 'effect';
import { basename, dirname, join } from 'node:path';

export type Standing = { readonly bytes: Uint8Array } | { readonly absent: true } | { readonly link: string };

export type Entry =
  | { readonly kind: 'link'; readonly target: string }
  | { readonly kind: 'file' | 'directory' | 'special'; readonly info: FileSystem.File.Info };

export function fileFailure(error: PlatformError.PlatformError): string {
  const cause: unknown = error.reason.cause;
  if (cause === null || typeof cause !== 'object') return error.message;
  const facts: string[] = [];
  for (const field of ['code', 'errno', 'syscall', 'path', 'message']) {
    if (!(field in cause)) continue;
    const value: unknown = Reflect.get(cause, field);
    if (typeof value === 'string' || typeof value === 'number') facts.push(`${field}=${value}`);
  }
  return facts.length === 0 ? error.message : `${error.message}; ${facts.join('; ')}`;
}

export const entryAt = Effect.fn('replace.entryAt')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readLink(path).pipe(
    Effect.map((target): Entry | undefined => ({ kind: 'link', target })),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(undefined)),
    Effect.catchIf(
      (error) =>
        error.reason.cause !== null &&
        typeof error.reason.cause === 'object' &&
        'code' in error.reason.cause &&
        error.reason.cause.code === 'EINVAL',
      () =>
        fs.stat(path).pipe(
          Effect.map((info): Entry | undefined => ({
            kind: info.type === 'Directory' ? 'directory' : info.type === 'File' ? 'file' : 'special',
            info,
          })),
          Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(undefined)),
        ),
    ),
  );
});

const sameIdentity = (left: FileSystem.File.Info, right: FileSystem.File.Info): boolean =>
  left.type === right.type && left.dev === right.dev && Option.getOrNull(left.ino) === Option.getOrNull(right.ino);

export function sameEntryVersion(expected: Entry, actual: Entry | undefined): boolean {
  if (actual === undefined || actual.kind !== expected.kind) return false;
  if (expected.kind === 'link') return actual.kind === 'link' && actual.target === expected.target;
  if (actual.kind === 'link' || !sameIdentity(expected.info, actual.info)) return false;
  return (
    expected.kind !== 'file' ||
    (actual.info.size === expected.info.size &&
      actual.info.mode === expected.info.mode &&
      Option.getOrNull(actual.info.mtime)?.getTime() === Option.getOrNull(expected.info.mtime)?.getTime() &&
      Option.getOrNull(actual.info.birthtime)?.getTime() === Option.getOrNull(expected.info.birthtime)?.getTime())
  );
}

export type ReplaceOptions = {
  readonly resource?: string;
  readonly executable?: boolean;
  readonly publishing?: () => () => void;
  readonly selected?: Entry;
};

export const resourcePath = Effect.fn('replace.resourcePath')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const resolveAt = (at: string): Effect.Effect<string, PlatformError.PlatformError> =>
    fs.realPath(at).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === 'NotFound',
        (error) => {
          const parent = dirname(at);
          return parent === at ? Effect.fail(error) : Effect.map(resolveAt(parent), (real) => join(real, basename(at)));
        },
      ),
    );
  return yield* resolveAt(path);
});

const STAGING_NAME = /^\..+\.[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.tagma$/su;

export const isStagingFile = (path: string): boolean => STAGING_NAME.test(basename(path));

const stagedBeside = (target: string): string => join(dirname(target), `.${basename(target)}.${crypto.randomUUID()}.tagma`);

const cleared = (fs: FileSystem.FileSystem, path: string): Effect.Effect<void> =>
  Effect.asVoid(Effect.exit(fs.remove(path, { force: true })));

const modeOf = (current: number, executable: boolean | undefined): number =>
  executable === undefined ? current : executable ? current | 0o111 : current & ~0o111;

const chmodded = (fs: FileSystem.FileSystem, path: string, mode: number | undefined) =>
  mode === undefined ? Effect.void : fs.chmod(path, mode);

const published = <A, E, R>(options: ReplaceOptions, write: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const withdraw = options.publishing?.();
    return write.pipe(Effect.tapError(() => Effect.sync(() => withdraw?.())));
  });

const viewOf = (bytes: Uint8Array): Buffer => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && viewOf(left).equals(viewOf(right));

export const stillStanding = Effect.fn('replace.stillStanding')(function* (path: string, standing: Standing) {
  const fs = yield* FileSystem.FileSystem;
  if ('link' in standing) {
    const target = yield* fs.readLink(path).pipe(Effect.option);
    return target._tag === 'Some' && target.value === standing.link;
  }
  const bytes = yield* fs.readFile(path).pipe(
    Effect.map((read): Uint8Array | null => read),
    Effect.catchIf(
      (error) => error.reason._tag === 'NotFound',
      () => Effect.succeed(null),
    ),
  );
  if ('absent' in standing) return bytes === null;
  return bytes !== null && sameBytes(bytes, standing.bytes);
});

export const sameEntry = Effect.fn('replace.sameEntry')(function* (one: string, other: string) {
  const fs = yield* FileSystem.FileSystem;
  const [left, right] = yield* Effect.all([fs.stat(one), fs.stat(other)]);
  const inode = Option.getOrNull(left.ino);
  return left.dev === right.dev && inode !== null && inode === Option.getOrNull(right.ino);
});

const created = Effect.fn('replace.created')(function* (path: string, bytes: Uint8Array, options: ReplaceOptions) {
  const fs = yield* FileSystem.FileSystem;
  const staged = stagedBeside(path);
  return yield* Effect.ensuring(
    Effect.gen(function* () {
      yield* fs.writeFile(staged, bytes, { flag: 'wx' });
      if (options.executable !== undefined) yield* fs.chmod(staged, options.executable ? 0o755 : 0o644);
      if (options.resource !== undefined && (yield* resourcePath(path)) !== options.resource) return false;
      const linked = yield* Effect.result(published(options, fs.link(staged, path)));
      if (linked._tag === 'Success') return true;
      if (linked.failure.reason._tag === 'AlreadyExists') return false;
      const exclusive = yield* Effect.result(
        published(
          options,
          fs.writeFile(path, bytes, {
            flag: 'wx',
            mode: options.executable === undefined ? undefined : options.executable ? 0o755 : 0o644,
          }),
        ),
      );
      if (exclusive._tag === 'Success') return true;
      if (exclusive.failure.reason._tag === 'AlreadyExists') return false;
      return yield* exclusive.failure;
    }),
    cleared(fs, staged),
  );
});

const standingTarget = Effect.fn('replace.standingTarget')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.realPath(path).pipe(
    Effect.flatMap((target) => Effect.map(fs.stat(target), (info) => ({ target, info }))),
    Effect.catchIf(
      (error) => error.reason._tag === 'NotFound',
      () => Effect.succeed(null),
    ),
  );
});

const overwritten = Effect.fn('replace.overwritten')(function* (
  path: string,
  standing: Standing,
  bytes: Uint8Array,
  options: ReplaceOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const found = yield* standingTarget(path);
  if (found === null || (options.resource !== undefined && found.target !== options.resource)) return false;
  const { target, info } = found;
  const shared = Option.getOrElse(info.nlink, () => 1) > 1 || Option.getOrNull(info.uid) !== (process.getuid?.() ?? null);
  if (shared) {
    if (!(yield* stillStanding(path, standing))) return false;
    yield* chmodded(fs, target, options.executable === undefined ? undefined : modeOf(info.mode & 0o7777, options.executable));
    yield* published(options, fs.writeFile(target, bytes));
    return true;
  }
  const staged = stagedBeside(target);
  return yield* Effect.ensuring(
    Effect.gen(function* () {
      yield* fs.writeFile(staged, bytes, { flag: 'wx', mode: info.mode & 0o777 });
      yield* fs.chmod(staged, modeOf(info.mode & 0o7777, options.executable));
      const owner = Option.getOrNull(info.uid);
      const group = Option.getOrNull(info.gid);
      if (owner !== null && group !== null && Option.getOrNull((yield* fs.stat(staged)).gid) !== group)
        yield* fs.chown(staged, owner, group);
      if (!(yield* stillStanding(path, standing))) return false;
      if ((yield* fs.realPath(path)) !== target) return false;
      yield* published(options, fs.rename(staged, target));
      return true;
    }),
    cleared(fs, staged),
  );
});

export const replaced = Effect.fn('replace.replaced')(function* (
  path: string,
  standing: Standing,
  after: string | Uint8Array | null,
  options: ReplaceOptions = {},
) {
  const fs = yield* FileSystem.FileSystem;
  if (after === null) {
    if (!(yield* stillStanding(path, standing))) return false;
    if (options.resource !== undefined && (yield* resourcePath(path)) !== options.resource) return false;
    if (options.selected !== undefined && !sameEntryVersion(options.selected, yield* entryAt(path))) return false;
    yield* published(options, fs.remove(path));
    return true;
  }
  const bytes = typeof after === 'string' ? new TextEncoder().encode(after) : after;
  return 'absent' in standing ? yield* created(path, bytes, options) : yield* overwritten(path, standing, bytes, options);
});
