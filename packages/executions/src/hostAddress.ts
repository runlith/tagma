import { Data, Effect, FileSystem, Path, type PlatformError, Schema } from 'effect';
import { InstallationId } from './protocol/execution';
import type { Digest } from './protocol/artifact';

export class HostAddressInvalid extends Data.TaggedError('HostAddressInvalid')<{
  readonly state: string;
  readonly detail: string;
}> {}

export type HostAddress = {
  readonly state: string;
  readonly installation: InstallationId;
  readonly digest?: Digest | null;
};

const readInstallation = Schema.decodeUnknownEffect(InstallationId);

const invalid = (state: string, detail: string) => Effect.fail(new HostAddressInvalid({ state, detail }));

export const hostAddress = Effect.fn('executions.hostAddress')(function* (
  state: string,
  installation: string,
  options: { readonly provision?: boolean } = {},
) {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const identity = yield* readInstallation(installation).pipe(
    Effect.mapError(() => new HostAddressInvalid({ state, detail: 'the installation identity is empty' })),
  );
  if (!path.isAbsolute(state)) return yield* invalid(state, 'a state directory must be an absolute path');

  if (options.provision === true) {
    yield* files
      .makeDirectory(state, { recursive: true, mode: 0o700 })
      .pipe(
        Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
          invalid(state, `the state directory could not be created: ${error.reason._tag}`),
        ),
      );
  }

  const canonical = yield* anchored(files, path, state);
  if (canonical === undefined) return yield* invalid(state, 'no ancestor of the state path exists');

  const info = yield* files.stat(canonical).pipe(
    Effect.map((held) => held.type),
    Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
      error.reason._tag === 'NotFound'
        ? Effect.succeed(undefined)
        : invalid(state, `the state directory could not be read: ${error.reason._tag}`),
    ),
  );
  if (info !== undefined && info !== 'Directory') return yield* invalid(state, 'the state path is not a directory');

  return { state: canonical, installation: identity };
});

const anchored = Effect.fnUntraced(function* (files: FileSystem.FileSystem, path: Path.Path, state: string) {
  const missing: Array<string> = [];
  let standing = state;
  while (true) {
    const resolved = yield* files.realPath(standing).pipe(
      Effect.map((held): string | undefined => held),
      Effect.catchTag('PlatformError', (error: PlatformError.PlatformError) =>
        error.reason._tag === 'NotFound'
          ? Effect.succeed(undefined)
          : invalid(state, `the state path could not be resolved: ${error.reason._tag}`),
      ),
    );
    if (resolved !== undefined) return path.join(resolved, ...missing.reverse());
    const parent = path.dirname(standing);
    if (parent === standing) return undefined;
    missing.push(path.basename(standing));
    standing = parent;
  }
});
