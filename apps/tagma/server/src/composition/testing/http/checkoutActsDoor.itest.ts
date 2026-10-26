import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import type { CheckoutPulled } from '../../../landing/contract/wire/checkoutCommits.js';
import type { CheckoutState } from '../../../workspace/contract/wire/checkout.js';
import type { CheckoutAborted } from '../../../workspace/contract/wire/checkoutActs.js';
import type { RefusalBody } from '../../../platform/contract/wire/refusal.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { doorFixture, DoorFixture } from '../doorFixture.js';

const git = Effect.fnUntraced(function* (cwd: string, ...args: readonly string[]) {
  const ran = yield* spawnedEffect(['git', '-c', 'user.name=suite', '-c', 'user.email=suite@tagma', ...args], { cwd });
  if (!ran.success) return yield* Effect.die(new Error(`git ${args.join(' ')} in ${cwd}: ${ran.stderr.toString()}`));
  return ran.stdout.toString().trim();
});

layer(Layer.merge(doorFixture(), BunFileSystem.layer), { excludeTestServices: true })('checkout pull HTTP door', (it) => {
  it.effect(
    'a diverged pull merges in the commit tree with its hook preserving unstaged work, and an abort ends only the merge the checkout row names',
    () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const files = yield* FileSystem.FileSystem;
        const root = yield* files.realPath(yield* world.directory('pull-checkout'));
        const remote = yield* files.realPath(yield* world.directory('pull-remote'));
        yield* git(remote, 'init', '-q', '--bare', '-b', 'main');
        const projectId = yield* world.stealthProject(root);
        yield* files.writeFileString(join(root, 'theirs.txt'), 'base\n');
        yield* git(root, 'add', '--', 'theirs.txt');
        yield* git(root, 'commit', '-q', '-m', 'base');
        yield* git(root, 'remote', 'add', 'origin', remote);
        yield* git(root, 'push', '-q', '-u', 'origin', 'main');
        const coverage = yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
        const covered = coverage.roots.find((row) => row.path === root);
        if (covered === undefined) return yield* Effect.die(new Error(`project ${projectId} covers no root at ${root}`));
        const other = yield* files.realPath(yield* world.directory('pull-other'));
        yield* git(other, 'clone', '-q', remote, 'copy');
        const copy = join(other, 'copy');
        yield* files.writeFileString(join(copy, 'up.txt'), 'upstream\n');
        yield* git(copy, 'add', '--', 'up.txt');
        yield* git(copy, 'commit', '-q', '-m', 'upstream');
        yield* git(copy, 'push', '-q', 'origin', 'main');
        yield* git(root, 'commit', '-q', '--allow-empty', '-m', 'ours');
        yield* files.writeFileString(join(root, 'theirs.txt'), 'another session is still writing this\n');
        const hook = join(root, '.git', 'hooks', 'pre-merge-commit');
        yield* files.writeFileString(hook, "#!/bin/sh\ngit checkout -- . || exit 1\nprintf 'hooked\\n' > added.txt\ngit add added.txt\n");
        yield* files.chmod(hook, 0o755);
        const pulled = yield* world.op('pull_checkout', { rootId: covered.rootId }, `project=${projectId}`);
        expect(pulled.status).toBe(200);
        const made = pulled.body as CheckoutPulled;
        expect(made.merge).toMatch(/^[0-9a-f]{40}$/);
        expect(yield* git(root, 'rev-parse', 'HEAD')).toBe(made.merge ?? '');
        expect((yield* git(root, 'rev-list', '--parents', '-n', '1', 'HEAD')).split(' ')).toHaveLength(3);
        expect(yield* git(root, 'show', 'HEAD:added.txt')).toBe('hooked');
        expect(yield* files.readFileString(join(root, 'theirs.txt'))).toBe('another session is still writing this\n');
        expect(yield* files.readFileString(join(root, 'up.txt'))).toBe('upstream\n');
        expect(yield* files.readFileString(join(root, 'added.txt'))).toBe('hooked\n');
        expect(yield* git(root, 'status', '--porcelain')).toBe('M theirs.txt');

        const op = (id: string, input: unknown) => world.op(id, input, `project=${projectId}`);
        const read = () =>
          Effect.map(op('read_checkout', { root: covered.rootId }), (answer) => (answer.body as { checkout: CheckoutState }).checkout);
        yield* files.writeFileString(join(root, 'kept.txt'), 'base\n');
        yield* git(root, 'add', '--', 'kept.txt');
        yield* git(root, 'commit', '-q', '-m', 'base');
        yield* git(root, 'branch', 'side');
        yield* files.writeFileString(join(root, 'kept.txt'), 'ours\n');
        yield* git(root, 'commit', '-q', '-m', 'ours', '--', 'kept.txt');
        yield* git(root, 'checkout', '-q', 'side');
        yield* files.writeFileString(join(root, 'kept.txt'), 'side\n');
        yield* git(root, 'commit', '-q', '-m', 'side', '--', 'kept.txt');
        const clean = yield* op('abort_checkout', { rootId: covered.rootId });
        expect(clean.status).toBe(409);
        expect((clean.body as RefusalBody).code).toBe('no-operation');
        const conflicted = yield* spawnedEffect(['git', 'merge', '--no-edit', 'main'], { cwd: root });
        expect(conflicted.success).toBe(false);
        const standing = yield* read();
        expect(standing.operation).toBe('merge');
        expect(standing.entries.unmerged.entries.map((entry) => entry.path)).toEqual(['kept.txt']);
        const aborted = yield* op('abort_checkout', { rootId: covered.rootId });
        expect(aborted.status).toBe(200);
        const ended = aborted.body as CheckoutAborted;
        expect(ended.operation).toBe('merge');
        expect(ended.paths).toEqual(['kept.txt']);
        const after = yield* read();
        expect(after.operation).toBe('none');
        expect(after.entries.unmerged.entries).toEqual([]);
        expect(yield* files.readFileString(join(root, 'theirs.txt'))).toBe('another session is still writing this\n');
      }),
  );
});
