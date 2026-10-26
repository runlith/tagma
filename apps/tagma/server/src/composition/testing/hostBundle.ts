import { join } from 'node:path';
import { Data, Effect } from 'effect';
import { once, runKind } from '@runlith/testbed/worlds';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { EXECUTION_HOST_ROOT } from './repoRoot.js';

export class BundleUnbuilt extends Data.TaggedError('BundleUnbuilt')<{ readonly detail: string }> {
  override get message() {
    return this.detail;
  }
}

const runBundle = runKind('testing/HostBundle', (_params: null, directory: string) =>
  Effect.gen(function* () {
    const root = join(directory, 'bundle');
    const built = yield* Effect.orDie(
      spawnedEffect([process.execPath, join(EXECUTION_HOST_ROOT, 'src/buildArtifact.ts'), root, 'host-tests'], { stdin: 'ignore' }),
    );
    if (!built.success)
      return yield* new BundleUnbuilt({
        detail: `Host bundle build ended ${built.signalCode ?? built.exitCode}: ${built.stderr.toString().slice(0, 2000)}`,
      });
    return root;
  }),
);

export const hostBundleRoot: Effect.Effect<string, BundleUnbuilt> = Effect.map(once(runBundle, null), (made) => made.value);
