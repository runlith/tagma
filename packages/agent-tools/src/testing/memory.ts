import { make } from '@runlith/testbed/memory';
import { Effect, FileSystem, Layer } from 'effect';
import type { World } from '../world';

export const memoryFixture = Effect.gen(function* () {
  const files = yield* make;
  const root = '/work';
  yield* files.makeDirectory(root, { recursive: true });
  const world = {
    files: Layer.succeed(FileSystem.FileSystem, files),
    environment: {
      platform: 'linux',
      shell: '/bin/sh',
      tmp: '/tmp',
      executables: { ripgrep: Effect.die('this fixture serves file tools without a search process') },
    },
  } satisfies World;
  return { root, files, world };
});
