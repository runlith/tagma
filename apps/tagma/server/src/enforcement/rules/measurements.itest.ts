import { expect, spyOn } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as disk from 'node:fs/promises';
import { join } from 'node:path';
import { Git } from '@runlith/git/Git';
import { Effect, Fiber, FileSystem, Layer } from 'effect';
import { liveGitLayer } from '../../composition/testing/liveGit.js';
import type { Measurement } from '../contract/wire/enforcement.js';
import { keepMeasurement, measurementsOf } from './measurements.js';

layer(Layer.merge(BunFileSystem.layer, liveGitLayer))('checkout observations', (it) => {
  it.effect('concurrent publications at the same time preserve complete measurements in a linked checkout', () =>
    Effect.gen(function* () {
      const git = yield* Git;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'measurements-' });
      const run = (...args: string[]) =>
        git
          .run(['-C', root, '-c', 'user.name=suite', '-c', 'user.email=suite@test', ...args])
          .pipe(Effect.flatMap((answer) => (answer.status === 0 ? Effect.void : Effect.die(answer.stderr))));
      yield* run('init', '-q', '-b', 'main');
      yield* run('commit', '--allow-empty', '-qm', 'seed');
      const checkout = join(root, 'checkout');
      yield* run('worktree', 'add', '-qb', 'branch', checkout);
      const old: Measurement = { commit: 'a'.repeat(40), at: '2026-01-01T00:00:00.000Z', ms: 1 };
      const first: Measurement = { ...old, ms: 2, sources: { first: 'first.ts' } };
      const second: Measurement = { ...old, ms: 3, sources: { second: 'second.ts' } };
      yield* keepMeasurement(checkout, 'rule', old);
      const written = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const writeFile = disk.writeFile;
      let writes = 0;
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          spyOn(disk, 'writeFile').mockImplementation(async (...args) => {
            await writeFile(...args);
            if (String(args[0]).includes('/tagma/measured/')) {
              if (++writes === 2) written.resolve();
              await release.promise;
            }
          }),
        ),
        (spy) =>
          Effect.sync(() => {
            release.resolve();
            spy.mockRestore();
          }),
      );
      const publishing = yield* Effect.forEach([first, second], (measurement) => keepMeasurement(checkout, 'rule', measurement), {
        concurrency: 2,
      }).pipe(Effect.forkScoped);
      yield* Effect.promise(() => written.promise);
      expect((yield* measurementsOf(checkout, ['rule'])).get('rule')).toEqual(old);
      release.resolve();
      yield* Fiber.join(publishing);
      expect([first, second]).toContainEqual((yield* measurementsOf(checkout, ['rule'])).get('rule')!);
      expect((yield* measurementsOf(root, ['rule'])).size).toBe(0);
    }),
  );
});
