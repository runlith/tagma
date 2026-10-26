import { mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Clock, Data, Duration, Effect } from 'effect';
import { declare } from '@runlith/held/Held';
import { HoldCut, HoldStalled } from '@runlith/held/failures';
import { type LockHold, proveHold, withFileLock } from '@runlith/file-lock/FileLock';
import { CredentialFileFailed, type CredentialFileFault, CredentialFileInvalid, credentialLockFailure } from './failure.js';
import { causeReason, closeQuietly, type FileStamp, isNodeError, sameStamp, statPath } from './fileFacts.js';

export const CREDENTIAL_LOCK_WAIT_MS = 15_000;

const TEMPORARY_SUFFIX = '.tmp';

const COARSE_TIMESTAMP_MS = 2_000;

export type DocumentCodec<Doc> = {
  readonly empty: () => Doc;
  readonly decode: (
    path: string,
    parsed: unknown,
    modifiedAt: number,
  ) => Effect.Effect<{ readonly value: Doc; readonly needsWrite: boolean }, CredentialFileInvalid>;
};

export type CredentialFile<Doc> = {
  readonly read: () => Effect.Effect<Doc, CredentialFileFault>;
  readonly readFresh: () => Effect.Effect<Doc, CredentialFileFault>;
  readonly update: <E>(change: (current: Doc) => Effect.Effect<Doc, E>) => Effect.Effect<void, CredentialFileFault | E>;
};

type CacheEntry<Doc> = { readonly stamp: FileStamp | null; readonly directory: FileStamp | null; readonly value: Doc };

type Snapshot<Doc> = {
  readonly value: Doc;
  readonly needsWrite: boolean;
  readonly adopted: ReadonlyArray<string>;
};

type Adopted<Doc> = { readonly value: Doc; readonly modifiedAt: number; readonly path: string };

class OrphanTorn extends Data.TaggedError('OrphanTorn') {}

class DirectoryUnflushable extends Data.TaggedError('DirectoryUnflushable') {}

const UNFLUSHABLE_DIRECTORY_CODES: ReadonlySet<string> = new Set(['EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM']);

const unflushableDirectory = (cause: unknown): boolean =>
  isNodeError(cause) && cause.code !== undefined && UNFLUSHABLE_DIRECTORY_CODES.has(cause.code);

class DirectoryReadFailed extends Data.TaggedError('DirectoryReadFailed')<{
  readonly code?: string;
  readonly reason: string;
}> {}

class FileRemoveFailed extends Data.TaggedError('FileRemoveFailed')<{
  readonly code?: string;
  readonly reason: string;
}> {}

export const makeCredentialFile = <Doc>({
  path,
  codec,
  lockWaitMs = CREDENTIAL_LOCK_WAIT_MS,
}: {
  readonly path: string;
  readonly codec: DocumentCodec<Doc>;
  readonly lockWaitMs?: number;
}): CredentialFile<Doc> => {
  let cache: CacheEntry<Doc> | null = null;
  const writes = declare<string>({
    name: 'credential-file-write',
    owner: 'credential-file',
    rank: 223,
    key: (key) => key,
    concurrency: 1,
    threshold: Duration.seconds(5),
    ceilings: {
      hold: Duration.minutes(15),
      wait: Duration.minutes(15),
      leaves: 'the replacement may already be published; read the file before retrying',
    },
    external: 'none',
  });
  const lockPath = `${path}.lock`;
  const directory = dirname(path);

  const guarded = <A, E>(body: (hold: LockHold) => Effect.Effect<A, E>): Effect.Effect<A, E | CredentialFileFailed> =>
    writes
      .hold(
        'write',
        withFileLock(lockPath, lockWaitMs, (hold) =>
          Effect.sync(() => {
            cache = null;
          }).pipe(Effect.flatMap(() => body(hold))),
        ).pipe(Effect.mapError(credentialLockFailure<E>)),
      )
      .pipe(Effect.mapError(holdFailure<E>));

  const stamp = () =>
    statPath(path).pipe(
      Effect.mapError(
        (failure) =>
          new CredentialFileFailed({
            kind: 'read',
            reason: `Cannot stat credential file ${path}: ${failure.reason}`,
          }),
      ),
    );

  const directoryStamp = () =>
    statPath(directory).pipe(
      Effect.mapError(
        (failure) =>
          new CredentialFileFailed({
            kind: 'read',
            reason: `Cannot stat credential file directory ${directory}: ${failure.reason}`,
          }),
      ),
    );

  const removeFile = (at: string, what: string) =>
    Effect.tryPromise({
      try: () => unlink(at),
      catch: (cause) => new FileRemoveFailed({ code: isNodeError(cause) ? cause.code : undefined, reason: causeReason(cause) }),
    }).pipe(
      Effect.asVoid,
      Effect.catchIf(
        (failure) => failure.code === 'ENOENT',
        () => Effect.void,
      ),
      Effect.mapError((failure) => new CredentialFileFailed({ kind: 'write', reason: `${what}: ${failure.reason}` })),
      Effect.withSpan('CredentialFile.removeFile'),
    );

  const temporaryPaths = Effect.fn('CredentialFile.temporaryPaths')(function* () {
    const prefix = `${basename(path)}.`;
    const names = yield* Effect.tryPromise({
      try: () => readdir(directory),
      catch: (cause) =>
        new DirectoryReadFailed({
          code: isNodeError(cause) ? cause.code : undefined,
          reason: causeReason(cause),
        }),
    }).pipe(
      Effect.catchIf(
        (failure) => failure.code === 'ENOENT',
        () => Effect.succeed<string[]>([]),
      ),
      Effect.mapError(
        (failure) =>
          new CredentialFileFailed({
            kind: 'read',
            reason: `Cannot list the credential file directory ${directory}: ${failure.reason}`,
          }),
      ),
    );
    return names.filter((name) => name.startsWith(prefix) && name.endsWith(TEMPORARY_SUFFIX)).map((name) => join(directory, name));
  });

  const decodeLive = Effect.fn('CredentialFile.decodeLive')(function* (currentStamp: FileStamp) {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(path, 'utf8'),
      catch: (cause) =>
        new CredentialFileFailed({
          kind: 'read',
          reason: `Cannot read credential file ${path}: ${causeReason(cause)}`,
        }),
    });
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) => new CredentialFileInvalid({ path, reason: causeReason(cause) }),
    });
    return yield* codec.decode(path, parsed, currentStamp.modifiedAt);
  });

  const readTemporary = Effect.fn('CredentialFile.readTemporary')(
    function* (at: string, modifiedAt: number) {
      const raw = yield* Effect.tryPromise({
        try: () => readFile(at, 'utf8'),
        catch: (cause) =>
          isNodeError(cause) && cause.code === 'ENOENT'
            ? new OrphanTorn()
            : new CredentialFileFailed({ kind: 'read', reason: `Cannot read credential file temporary file ${at}: ${causeReason(cause)}` }),
      });
      const parsed = yield* Effect.try({ try: () => JSON.parse(raw) as unknown, catch: () => new OrphanTorn() });
      return (yield* codec.decode(path, parsed, modifiedAt).pipe(Effect.mapError(() => new OrphanTorn()))).value;
    },
    Effect.catchTag('OrphanTorn', () => Effect.succeed(null)),
  );

  const reconcileTemporaries = Effect.fn('CredentialFile.reconcileTemporaries')(function* (live: FileStamp | null) {
    const paths = yield* temporaryPaths();
    let adopted: Adopted<Doc> | null = null;
    for (const at of paths) {
      const found = yield* statPath(at).pipe(
        Effect.mapError(
          (failure) =>
            new CredentialFileFailed({
              kind: 'read',
              reason: `Cannot inspect credential file temporary file ${at}: ${failure.reason}`,
            }),
        ),
      );
      if (found !== null && (live === null || found.modifiedAt > live.modifiedAt)) {
        const value = yield* readTemporary(at, found.modifiedAt);
        if (value !== null && (adopted === null || found.modifiedAt > adopted.modifiedAt)) {
          adopted = { value, modifiedAt: found.modifiedAt, path: at };
        }
      }
    }
    for (const at of paths) {
      if (adopted === null || at !== adopted.path) {
        yield* removeFile(at, `Cannot remove credential file temporary file ${at}`);
      }
    }
    return adopted;
  });

  const snapshot = Effect.fn('CredentialFile.snapshot')(function* (): Effect.fn.Return<Snapshot<Doc>, CredentialFileFault> {
    const parent = yield* directoryStamp();
    const currentStamp = yield* stamp();
    if (cache && sameStamp(cache.stamp, currentStamp) && sameStamp(cache.directory, parent)) {
      return { value: cache.value, needsWrite: false, adopted: [] };
    }
    const live = currentStamp === null ? null : yield* decodeLive(currentStamp);
    const adopted = yield* reconcileTemporaries(currentStamp);
    if (adopted !== null) return { value: adopted.value, needsWrite: true, adopted: [adopted.path] };
    if (live === null) {
      const value = codec.empty();
      cache = { stamp: null, directory: parent, value };
      return { value, needsWrite: false, adopted: [] };
    }
    if (!live.needsWrite) cache = { stamp: currentStamp, directory: parent, value: live.value };
    return { ...live, adopted: [] };
  });

  const syncDirectory = () =>
    Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => open(directory, 'r'),
        catch: (cause) =>
          unflushableDirectory(cause) ? new DirectoryUnflushable() : writeFailed('Cannot open the credential file directory', cause),
      }),
      (handle) =>
        Effect.tryPromise({
          try: () => handle.sync(),
          catch: (cause) =>
            unflushableDirectory(cause) ? new DirectoryUnflushable() : writeFailed('Cannot flush the credential file directory', cause),
        }),
      closeQuietly,
    ).pipe(
      Effect.asVoid,
      Effect.catchTag('DirectoryUnflushable', () => Effect.void),
      Effect.withSpan('CredentialFile.syncDirectory'),
    );

  const replace = Effect.fn('CredentialFile.replace')(function* (next: Doc, hold: LockHold, adopted: ReadonlyArray<string>) {
    yield* proveHold(hold).pipe(Effect.mapError(credentialLockFailure<never>));
    yield* Effect.tryPromise({
      try: () => mkdir(directory, { recursive: true }),
      catch: (cause) => writeFailed('Cannot create credential file directory', cause),
    });
    const claimed = `${path}.${process.pid}${TEMPORARY_SUFFIX}`;
    const temporary = adopted.includes(claimed) ? `${path}.${process.pid}.${alternateSuffix()}${TEMPORARY_SUFFIX}` : claimed;
    if (temporary === claimed) {
      yield* removeFile(temporary, `Cannot remove stale credential file temporary file ${temporary}`);
    }
    const body = `${JSON.stringify(next, null, 2)}\n`;
    yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => open(temporary, 'wx', 0o600),
        catch: (cause) => writeFailed('Cannot open the credential file temporary file', cause),
      }),
      (handle) =>
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: () => handle.writeFile(body),
            catch: (cause) => writeFailed('Cannot write credential file', cause),
          });
          yield* Effect.tryPromise({
            try: () => handle.sync(),
            catch: (cause) => writeFailed('Cannot flush the credential file temporary file', cause),
          });
        }),
      closeQuietly,
    );
    yield* Effect.tryPromise({
      try: () => rename(temporary, path),
      catch: (cause) => writeFailed('Cannot replace credential file', cause),
    });
    yield* syncDirectory();
    const currentStamp = yield* stamp();
    cache = { stamp: currentStamp, directory: yield* directoryStamp(), value: next };
  });

  const removeAdopted = (paths: ReadonlyArray<string>) =>
    Effect.forEach(paths, (at) => removeFile(at, `Cannot remove credential file temporary file ${at}`), { discard: true });

  const read = Effect.fn('CredentialFile.read')(function* () {
    const parent = yield* directoryStamp();
    const currentStamp = yield* stamp();
    const held = cache;
    const unchanged = held !== null && sameStamp(held.stamp, currentStamp);
    const racy = parent !== null && (yield* Clock.currentTimeMillis) - parent.modifiedAt < COARSE_TIMESTAMP_MS;
    if (held !== null && unchanged && sameStamp(held.directory, parent) && !racy) return held.value;
    if ((held !== null && unchanged) || currentStamp === null) {
      if ((yield* temporaryPaths()).length === 0) {
        if (held !== null && unchanged) {
          cache = { ...held, directory: parent };
          return held.value;
        }
        const value = codec.empty();
        cache = { stamp: null, directory: parent, value };
        return value;
      }
    }

    return yield* guarded((hold) =>
      Effect.gen(function* () {
        const decoded = yield* snapshot();
        if (decoded.needsWrite) {
          yield* replace(decoded.value, hold, decoded.adopted);
          yield* removeAdopted(decoded.adopted);
        }
        return decoded.value;
      }),
    );
  });

  return {
    read,
    readFresh: () =>
      Effect.sync(() => {
        cache = null;
      }).pipe(Effect.flatMap(read)),
    update: <E>(change: (current: Doc) => Effect.Effect<Doc, E>) =>
      guarded((hold) =>
        Effect.gen(function* () {
          const decoded = yield* snapshot();
          const next = yield* change(decoded.value);
          if (next !== decoded.value) {
            yield* replace(next, hold, decoded.adopted);
            yield* removeAdopted(decoded.adopted);
          }
        }),
      ).pipe(Effect.withSpan('CredentialFile.update')),
  };
};

export const directoryStamp = (directory: string): Effect.Effect<number, CredentialFileFailed> =>
  statPath(directory).pipe(
    Effect.map((stamp) => stamp?.modifiedAt ?? 0),
    Effect.mapError(
      (failure) => new CredentialFileFailed({ kind: 'read', reason: `Cannot stat credential directory ${directory}: ${failure.reason}` }),
    ),
  );

function writeFailed(what: string, cause: unknown): CredentialFileFailed {
  return new CredentialFileFailed({ kind: 'write', reason: `${what}: ${causeReason(cause)}` });
}

function holdFailure<E>(failure: E | CredentialFileFailed | HoldStalled | HoldCut): E | CredentialFileFailed {
  if (failure instanceof HoldStalled) {
    return new CredentialFileFailed({
      kind: 'locked',
      reason: `The credential file gate admitted no writer within ${failure.waitedMs}ms; the write did not happen`,
    });
  }
  if (failure instanceof HoldCut) {
    return new CredentialFileFailed({
      kind: 'locked',
      reason: `The credential file gate stayed held for ${failure.heldMs}ms; ${failure.leaves}`,
    });
  }
  return failure;
}

function alternateSuffix(): string {
  return Math.random().toString(36).slice(2);
}
