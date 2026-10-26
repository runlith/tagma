import { Effect, Layer } from 'effect';
import { BootRefused } from '../boot';

const selected = Effect.suspend(() =>
  process.platform === 'darwin'
    ? Effect.tryPromise({
        try: () => import('./macos'),
        catch: (error) => new BootRefused({ detail: `the macOS adapter could not be loaded: ${String(error)}` }),
      })
    : Effect.fail(new BootRefused({ detail: `no host adapter for ${process.platform}/${process.arch}` })),
);

export const platformLayer = (path: string) => Layer.unwrap(Effect.map(selected, (system) => system.platformLayer(path)));
export const holderLayer = (path: string) => Layer.unwrap(Effect.map(selected, (system) => system.holderLayer(path)));
export const processLayer = (path: string) => Layer.unwrap(Effect.map(selected, (system) => system.processLayer(path)));
export const yieldAsker = (path: string) => Effect.flatMap(selected, (system) => system.yieldAsker(path));
