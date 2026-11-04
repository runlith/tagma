import { Effect } from 'effect';
import { BootRefused } from '../boot';

export const selected = Effect.suspend(() =>
  process.platform === 'darwin'
    ? Effect.tryPromise({
        try: () => import('./macos'),
        catch: (error) => new BootRefused({ detail: `the macOS adapter could not be loaded: ${String(error)}` }),
      })
    : Effect.fail(new BootRefused({ detail: `no host adapter for ${process.platform}/${process.arch}` })),
);
