import { Effect } from 'effect';
import { HolderUnavailable } from '../../holder-client/Connection';
import type { FixtureSystem } from '../../posix/testing/System';

export const testSystem: Effect.Effect<FixtureSystem, HolderUnavailable> = Effect.suspend(() => {
  const loading =
    process.platform === 'darwin'
      ? () => import('../../posix/macos/testing/system').then((module) => module.system)
      : process.platform === 'linux'
        ? () => import('../../posix/linux/testing/system').then((module) => module.system)
        : undefined;
  return loading === undefined
    ? Effect.fail(new HolderUnavailable({ detail: `no fixture adapter for ${process.platform}` }))
    : Effect.tryPromise({ try: loading, catch: (error) => new HolderUnavailable({ detail: String(error) }) });
});
