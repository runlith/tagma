import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { HolderRefused, type HeldLaunch } from '../holder/Holder';
import type { Descriptors } from './native';

const refused = (detail: string, reason: HolderRefused['reason'] = 'invalid') => new HolderRefused({ act: 'launch', reason, detail });

const executable = (path: string) =>
  Effect.tryPromise({
    try: () => access(path, constants.X_OK),
    catch: (cause) => cause as NodeJS.ErrnoException,
  }).pipe(
    Effect.matchEffect({
      onSuccess: () => Effect.succeed(true),
      onFailure: (error) =>
        error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EACCES'
          ? Effect.succeed(false)
          : Effect.fail(refused(String(error), error.code === 'EPERM' ? 'denied' : 'invalid')),
    }),
  );

export const prepareLaunch = Effect.fn('posix.prepareLaunch')(
  function* (spec: HeldLaunch, native: Descriptors) {
    const files = yield* FileSystem.FileSystem;
    for (const { name, value } of spec.env)
      if (name.length === 0 || name.includes('=') || name.includes('\0') || value.includes('\0'))
        return yield* refused(`Error: environment entry ${name} cannot be passed to a process`);
    let cwd = spec.cwd ?? spec.env.find(({ name }) => name === 'HOME')?.value;
    if (cwd === undefined) {
      const home = native.home();
      if ('refusal' in home) return yield* refused(`Error: ${home.detail}`);
      cwd = home.path;
    }
    if (cwd.length === 0) return yield* refused('Error: the launch names an empty cwd');
    if (!isAbsolute(cwd)) return yield* refused(`Error: cwd ${cwd} is not an absolute path`);
    if ((yield* files.stat(cwd)).type !== 'Directory') return yield* refused(`Error: cwd ${cwd} is not a directory`);
    if (spec.path.includes('/')) return { ...spec, path: resolve(cwd, spec.path), cwd };
    const path = spec.env.find(({ name }) => name === 'PATH')?.value;
    if (path === undefined) return yield* refused(`Executable not found: ${spec.path}; the launch environment names no PATH`, 'not-found');
    for (const entry of path.split(':')) {
      const candidate = resolve(cwd, entry, spec.path);
      const info = yield* files.stat(candidate).pipe(
        Effect.catchReasons('PlatformError', {
          NotFound: () => Effect.succeed(undefined),
          PermissionDenied: (reason, error) =>
            (reason.cause as NodeJS.ErrnoException | undefined)?.code === 'EACCES' ? Effect.succeed(undefined) : Effect.fail(error),
          BadResource: (reason, error) =>
            (reason.cause as NodeJS.ErrnoException | undefined)?.code === 'ENOTDIR' ? Effect.succeed(undefined) : Effect.fail(error),
        }),
      );
      if (info?.type === 'File' && (yield* executable(candidate))) return { ...spec, path: candidate, cwd };
    }
    return yield* refused(`Executable not found: ${spec.path}`, 'not-found');
  },
  Effect.catchReasons(
    'PlatformError',
    {
      NotFound: (_reason, error) => Effect.fail(refused(String(error), 'not-found')),
      PermissionDenied: (_reason, error) => Effect.fail(refused(String(error), 'denied')),
    },
    (_reason, error) => Effect.fail(refused(String(error))),
  ),
);
