import { Effect } from 'effect';
import { HolderUnavailable } from '../../holder-client/Connection';
import type { FixtureSystem } from '../../posix/testing/System';

export const testSystem: Effect.Effect<FixtureSystem, HolderUnavailable> = Effect.suspend(() =>
  process.platform === 'darwin'
    ? Effect.tryPromise({
        try: () => import('../../posix/macos/testing/system').then((module) => module.system),
        catch: (error) => new HolderUnavailable({ detail: String(error) }),
      })
    : Effect.fail(new HolderUnavailable({ detail: `no fixture adapter for ${process.platform}` })),
);
