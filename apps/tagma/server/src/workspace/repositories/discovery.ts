import { dirname, join } from 'node:path';
import { Data, Effect, type FileSystem } from 'effect';
import type { PlatformError } from 'effect/PlatformError';

const GIT_LINK = '.git';
const BARE_LAYOUT = ['HEAD', 'objects', 'refs'] as const;

export class DiscoveryUnreadable extends Data.TaggedError('DiscoveryUnreadable')<{
  readonly path: string;
  readonly error: PlatformError;
}> {}

const at = <A>(work: Effect.Effect<A, PlatformError>, path: string): Effect.Effect<A, DiscoveryUnreadable> =>
  Effect.mapError(work, (error) => new DiscoveryUnreadable({ path, error }));

const holds = (files: FileSystem.FileSystem, directory: string, name: string): Effect.Effect<boolean, DiscoveryUnreadable> => {
  const path = join(directory, name);
  const link = Effect.as(files.readLink(path), true).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(false)));
  return at(
    Effect.flatMap(files.exists(path), (there) => (there ? Effect.succeed(true) : link)),
    path,
  );
};

export const outsideRepository = Effect.fn('Repositories.absent')(function* (
  files: FileSystem.FileSystem,
  path: string,
): Effect.fn.Return<boolean, DiscoveryUnreadable> {
  let here = yield* at(files.realPath(path), path);
  while (true) {
    if (yield* holds(files, here, GIT_LINK)) return false;
    let layout = true;
    for (const name of BARE_LAYOUT) {
      if (!(yield* holds(files, here, name))) {
        layout = false;
        break;
      }
    }
    if (layout) return false;
    const up = dirname(here);
    if (up === here) return true;
    here = up;
  }
});
