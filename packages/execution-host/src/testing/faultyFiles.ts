import { Deferred, Effect, FileSystem, PlatformError } from 'effect';

export type Fault = {
  readonly whenPathHas: string;
  readonly act?: 'writeAll' | 'sync' | 'read';
  readonly onCall: number;
  readonly landed?: number;
  readonly fails?: boolean;
  readonly held?: Deferred.Deferred<void>;
  readonly entered?: Deferred.Deferred<void>;
  readonly landsAfterCut?: boolean;
  readonly heldThroughInterrupt?: boolean;
  readonly truncateFails?: boolean;
};

const refused = (path: string, method: 'writeAll' | 'truncate'): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: 'Unknown',
    module: 'FileSystem',
    method,
    description: 'the device stopped taking bytes',
    pathOrDescriptor: path,
  });

export const faulty = (real: FileSystem.FileSystem, fault: Fault): FileSystem.FileSystem => {
  let seen = 0;
  return {
    ...real,
    open: (path, options) =>
      Effect.map(real.open(path, options), (file): FileSystem.File => {
        if (!path.includes(fault.whenPathHas)) return file;
        let cut: Uint8Array | undefined;
        return {
          [FileSystem.FileTypeId]: FileSystem.FileTypeId,
          stat: file.stat,
          sync:
            fault.act === 'sync'
              ? Effect.gen(function* () {
                  seen += 1;
                  if (seen !== fault.onCall) return yield* file.sync;
                  if (fault.entered !== undefined) yield* Deferred.succeed(fault.entered, undefined);
                  if (fault.held !== undefined) yield* Deferred.await(fault.held);
                  return yield* file.sync;
                })
              : file.sync,
          seek: (offset, from) => file.seek(offset, from),
          read: (buffer) =>
            fault.act === 'read'
              ? Effect.gen(function* () {
                  seen += 1;
                  if (seen !== fault.onCall) return yield* file.read(buffer);
                  if (fault.entered !== undefined) yield* Deferred.succeed(fault.entered, undefined);
                  if (fault.held !== undefined) yield* Deferred.await(fault.held);
                  return yield* file.read(buffer);
                })
              : file.read(buffer),
          readAlloc: (size) => file.readAlloc(size),
          truncate: (length) =>
            fault.truncateFails === true
              ? Effect.fail(refused(path, 'truncate'))
              : Effect.andThen(
                  file.truncate(length),
                  Effect.suspend(() => {
                    const late = cut;
                    cut = undefined;
                    return late === undefined ? Effect.void : file.writeAll(late);
                  }),
                ),
          write: (buffer) => file.write(buffer),
          writeAll: Effect.fnUntraced(function* (buffer) {
            if (fault.act === 'sync' || fault.act === 'read') return yield* file.writeAll(buffer);
            seen += 1;
            if (seen !== fault.onCall) return yield* file.writeAll(buffer);
            if (fault.entered !== undefined) yield* Deferred.succeed(fault.entered, undefined);
            if (fault.held !== undefined && fault.heldThroughInterrupt === true) yield* Effect.uninterruptible(Deferred.await(fault.held));
            else if (fault.held !== undefined)
              yield* Deferred.await(fault.held).pipe(
                Effect.onInterrupt(() =>
                  Effect.sync(() => {
                    if (fault.landsAfterCut === true) cut = buffer;
                  }),
                ),
              );
            if (fault.landed !== undefined) yield* file.writeAll(buffer.subarray(0, fault.landed));
            if (fault.fails === true) return yield* Effect.fail(refused(path, 'writeAll'));
            if (fault.landed !== undefined) return;
            return yield* file.writeAll(buffer);
          }),
        };
      }),
  };
};
