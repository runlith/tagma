import { resolve } from 'node:path';
import { Effect, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { fileHolders, nativeLibrary, processLayer } from '@runlith/execution-host/composition/platform';
import { LockHolders } from '../contract/service/lockHolders.js';

export const testProcesses = Layer.orDie(
  Layer.unwrap(Effect.map(nativeLibrary(resolve(import.meta.dir, '../../../../../..', 'packages/execution-host')), processLayer)),
).pipe(Layer.provide(BunFileSystem.layer));

export const testLockHolders = Layer.succeed(LockHolders, {
  of: (file) =>
    fileHolders(file).pipe(
      Effect.catchTag('BootRefused', (refused) => Effect.succeed({ _tag: 'Unread', detail: refused.detail } as const)),
    ),
});
