import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { chain } from './chain.js';
import { seedDatabase } from './seed.js';

const folder = new URL('../../../drizzle', import.meta.url).pathname;

it.effect('a seed made on one shelf is never answered for another shelf of the same chain', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped();
    const applied = (path: string) => Effect.orDie(Effect.as(files.writeFileString(path, ''), chain({ folder }).length));
    yield* seedDatabase({ folder, seeds: join(root, 'first') }, applied);
    yield* files.remove(join(root, 'first'), { recursive: true });
    const second = yield* seedDatabase({ folder, seeds: join(root, 'second') }, applied);
    expect(second.startsWith(join(root, 'second'))).toBe(true);
    expect(yield* files.exists(second)).toBe(true);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
