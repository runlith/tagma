import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { cpSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, Layer } from 'effect';
import { Git, gitLayer } from '@runlith/git/Git';
import { marked } from '../../projects/identity.js';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { checkoutAt, checkoutsOf, registeredCheckoutsOf } from './git.js';

const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const git = Effect.fnUntraced(function* (cwd: string, ...args: string[]) {
  const out = yield* spawnedEffect(['git', '-c', 'user.name=op', '-c', 'user.email=op@x', ...args], { cwd });
  if (out.exitCode !== 0) return yield* Effect.die(new Error(`git ${args.join(' ')}: ${out.stderr.toString()}`));
  return out.stdout.toString().trim();
});
const located = (cwd: string) =>
  Effect.flatMap(Git, (service) => checkoutAt(service, cwd)).pipe(Effect.provide(gitLayer.pipe(Layer.provide(host))));
it.live(
  'a checkout carries its repository’s project mark in every worktree, and a copy carries none while its source holds the mark',
  Effect.fnUntraced(function* () {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'checkout-key-')));
    try {
      const repo = join(base, 'repo');
      yield* git(base, 'init', '-q', '-b', 'main', repo);
      writeFileSync(join(repo, 'a.md'), 'a\n');
      yield* git(repo, 'add', '-A');
      yield* git(repo, 'commit', '-qm', 'first');
      expect(yield* located(repo)).toEqual({ key: null, path: '.', toplevel: repo, gitDir: join(repo, '.git'), mainWorktree: repo });
      yield* marked(join(repo, '.git'), 'k1');
      const orphan = join(base, 'orphan');
      yield* git(repo, 'worktree', 'add', '-q', '--orphan', '-b', 'fresh', orphan);
      writeFileSync(join(orphan, 'c.md'), 'c\n');
      yield* git(orphan, 'add', '-A');
      yield* git(orphan, 'commit', '-qm', 'another history');
      expect(yield* located(orphan)).toMatchObject({ key: 'k1', toplevel: orphan, mainWorktree: repo });
      const catalog = Effect.flatMap(Git, (service) =>
        Effect.all({ registered: registeredCheckoutsOf(service, repo), present: checkoutsOf(service, repo) }),
      ).pipe(Effect.provide(gitLayer.pipe(Layer.provide(host))));
      expect((yield* catalog).registered.find((entry) => entry.path === orphan)).toEqual({ path: orphan, branch: 'fresh', prunable: null });
      rmSync(orphan, { recursive: true });
      const missing = yield* catalog;
      expect(missing.registered.find((entry) => entry.path === orphan)?.prunable).toBeString();
      expect(missing.present.map((entry) => entry.path)).toEqual([repo]);
      const copy = join(base, 'copy');
      cpSync(repo, copy, { recursive: true });
      expect((yield* located(copy))?.key).toBeNull();
      const moved = join(base, 'moved');
      renameSync(repo, moved);
      expect((yield* located(moved))?.key).toBe('k1');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }),
);
