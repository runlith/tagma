import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { spawnedEffect } from '../testing/spawn.js';
import { type TreeShift, watchTree } from './tree.js';

layer(BunFileSystem.layer, { excludeTestServices: true })('watch polling fallback', (it) => {
  it.effect('an absent watcher returns polling when the configured excludes parent does not exist', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const tree = yield* files.makeTempDirectoryScoped({ prefix: 'watch-no-port-' });
      for (const args of [
        ['init', '-q'],
        ['config', 'core.excludesFile', join(tree, 'missing', 'ignore')],
      ]) {
        const ran = yield* spawnedEffect(['git', ...args], { cwd: tree });
        expect(ran.exitCode).toBe(0);
      }
      const heard: TreeShift[] = [];
      const watching = yield* Effect.acquireRelease(
        watchTree({ tree, gitDir: join(tree, '.git'), commonDir: join(tree, '.git') }, (shift) => heard.push(shift)),
        (held) => Effect.sync(() => held.close()),
      );
      expect(watching.mode()).toBe('polling');
      expect(heard).toContainEqual({ movement: 'ignore', rescan: 'polling', paths: [join(tree, 'missing', 'ignore')] });
    }),
  );
});
