import { Effect, Layer } from 'effect';
import { BootRefused } from '../boot';
import { selected } from './selection';
import { nativeArtifact } from './artifact';
import { join } from 'node:path';

export const nativeLibrary = (checkout: string): Effect.Effect<string, BootRefused> =>
  Effect.suspend(() => {
    const artifact = nativeArtifact();
    return artifact === undefined
      ? Effect.fail(new BootRefused({ detail: `no host adapter for ${process.platform}/${process.arch}` }))
      : Effect.succeed(join(checkout, 'native', 'target', 'release', artifact.library));
  });

export const platformLayer = (path: string) => Layer.unwrap(Effect.map(selected, (system) => system.platformLayer(path)));
export const holderLayer = (path: string) => Layer.unwrap(Effect.map(selected, (system) => system.holderLayer(path)));
export const processLayer = (path: string) => Layer.unwrap(Effect.map(selected, (system) => system.processLayer(path)));
export const yieldAsker = (path: string) => Effect.flatMap(selected, (system) => system.yieldAsker(path));
export const fileHolders = (file: string) => Effect.flatMap(selected, (system) => system.fileHolders(file));
