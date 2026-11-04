import { Effect } from 'effect';
import { BootRefused } from '../boot';

export const selected = Effect.suspend(() => {
  const loading =
    process.platform === 'darwin'
      ? () => import('./macos').then((module) => module.system)
      : process.platform === 'linux'
        ? () => import('./linux').then((module) => module.system)
        : undefined;
  return loading === undefined
    ? Effect.fail(new BootRefused({ detail: `no host adapter for ${process.platform}/${process.arch}` }))
    : Effect.tryPromise({
        try: loading,
        catch: (error) => new BootRefused({ detail: `the host adapter could not be loaded: ${String(error)}` }),
      });
});
