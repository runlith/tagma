import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { once, runKind } from '@runlith/testbed/worlds';
import { Cause, Data, Effect, FileSystem } from 'effect';
import { join } from 'node:path';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { REPO_ROOT } from './repoRoot.js';

export class SurfaceUnbuilt extends Data.TaggedError('SurfaceUnbuilt')<{ readonly message: string }> {}

const runBundle = runKind('testing/SurfaceBundle', (_params: null, directory: string) =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const app = join(REPO_ROOT, 'apps', 'tagma', 'app');
    const intermediate = join(app, '.svelte-kit');
    yield* files.makeDirectory(intermediate, { recursive: true });
    const work = yield* files.makeTempDirectoryScoped({ directory: intermediate, prefix: 'e2e-' });
    const root = join(directory, 'surface');
    const built = yield* spawnedEffect([process.execPath, 'run', 'build'], {
      cwd: app,
      env: { ...process.env, TAGMA_SURFACE_OUT: root, TAGMA_SURFACE_WORK: yield* files.realPath(work) },
      stdin: 'ignore',
    });
    if (!built.success)
      return yield* new SurfaceUnbuilt({
        message: `App build ended ${built.signalCode ?? built.exitCode}:\n${built.stderr.toString()}\n${built.stdout.toString()}`,
      });
    yield* files.stat(join(root, 'index.html'));
    return root;
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof SurfaceUnbuilt ? cause : new SurfaceUnbuilt({ message: Cause.pretty(Cause.fail(cause)) }),
    ),
    Effect.withSpan('testing.SurfaceBundle.build'),
    Effect.provide(BunFileSystem.layer),
  ),
);

export const surfaceBundleRoot: Effect.Effect<string, SurfaceUnbuilt> = Effect.map(once(runBundle, null), (made) => made.value);
