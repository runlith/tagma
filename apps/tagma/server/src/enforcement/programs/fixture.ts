import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { gitLayer } from '@runlith/git/Git';
import { Effect, Layer } from 'effect';

export const scratchTemp = (prefix: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const held = process.env.TMPDIR;
      const temp = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
      process.env.TMPDIR = temp;
      return { held, temp };
    }),
    ({ held, temp }) =>
      Effect.sync(() => {
        if (held === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = held;
        rmSync(temp, { recursive: true, force: true });
      }),
  );

export const testGit = gitLayer.pipe(
  Layer.provide(BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))),
);

export const committed = (root: string, paths: readonly string[] = ['.']): string => {
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root })
      .toString()
      .trim();
  git('init', '-q');
  git('add', '--', ...paths);
  git('commit', '-qm', 'checkout');
  return git('rev-parse', 'HEAD');
};
