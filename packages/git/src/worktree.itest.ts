import { afterAll, expect, test } from 'bun:test';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { git, onGit, release, tempRepo, tempRoot } from './testing/fixture.js';
import { locationsAt } from './repository.js';
import { addWorktree } from './worktree.js';

afterAll(release);

const owing = async (dir: string): Promise<number> =>
  (await git(dir, ['rev-list', '--objects', '--all', '--missing=print'])).split('\n').filter((line) => line.startsWith('?')).length;

test('a hook that fails after writing files answers nonzero over a checkout that stands', async () => {
  const main = await tempRepo('git-add-hook-');
  const hook = join(main, '.git', 'hooks', 'post-checkout');
  writeFileSync(hook, '#!/bin/sh\necho ran > "$PWD/hook.txt"\nexit 3\n');
  chmodSync(hook, 0o755);
  const path = join(tempRoot('git-add-hook-tree-'), 'side');

  const made = await onGit((service) =>
    addWorktree(service, join(main, '.git'), { mode: 'new-branch', path, branch: 'side', start: 'HEAD' }),
  );

  expect(made.status).toBe(3);
  expect(made.overflow).toBe(false);
  expect(readFileSync(join(path, 'hook.txt'), 'utf8')).toBe('ran\n');
  const here = await onGit((service) => locationsAt(service, path));
  expect(here.worktree).toBe(path);
  expect(here.commonDir).toBe(join(main, '.git'));
  expect(await git(main, ['rev-parse', 'refs/heads/side'])).toBe(await git(main, ['rev-parse', 'HEAD']));
}, 6_000);

test('each plan checks out what it names, and a branch already checked out refuses before any effect', async () => {
  const main = await tempRepo('git-add-plans-');
  const home = tempRoot('git-add-plans-tree-');
  const head = await git(main, ['rev-parse', 'HEAD']);
  const common = join(main, '.git');

  const born = await onGit((service) =>
    addWorktree(service, common, { mode: 'new-branch', path: join(home, 'born'), branch: 'side', start: head }),
  );
  const loose = await onGit((service) => addWorktree(service, common, { mode: 'detached', path: join(home, 'loose'), commit: head }));

  expect([born.status, loose.status]).toEqual([0, 0]);
  expect(await git(join(home, 'born'), ['symbolic-ref', 'HEAD'])).toBe('refs/heads/side');
  expect(await git(join(home, 'loose'), ['rev-parse', 'HEAD'])).toBe(head);
  await expect(git(join(home, 'loose'), ['symbolic-ref', 'HEAD'])).rejects.toThrow();

  const taken = await onGit((service) =>
    addWorktree(service, common, { mode: 'existing-branch', path: join(home, 'taken'), branch: 'side' }),
  );

  expect(taken.status).not.toBe(0);
  expect(taken.stderr).not.toBe('');
  expect(existsSync(join(home, 'taken'))).toBe(false);

  await git(main, ['worktree', 'remove', join(home, 'born')]);
  const moved = await onGit((service) =>
    addWorktree(service, common, { mode: 'existing-branch', path: join(home, 'moved'), branch: 'side' }),
  );

  expect(moved.status).toBe(0);
  expect(await git(join(home, 'moved'), ['symbolic-ref', 'HEAD'])).toBe('refs/heads/side');
}, 10_000);

test('a checkout missing promisor objects refuses without fetching them', async () => {
  const source = await tempRepo('git-promisor-');
  await git(source, ['config', 'uploadpack.allowFilter', 'true']);
  writeFileSync(join(source, 'big.txt'), 'x'.repeat(4096));
  await git(source, ['add', 'big.txt']);
  await git(source, ['-c', 'user.email=git@test', '-c', 'user.name=git', 'commit', '-q', '-m', 'blob']);
  const partial = join(tempRoot('git-promisor-clone-'), 'partial');
  await git(source, ['clone', '-q', '--filter=blob:none', '--no-checkout', `file://${source}`, partial]);
  expect(await owing(partial)).toBeGreaterThan(0);
  const before = await owing(partial);
  const path = join(tempRoot('git-promisor-tree-'), 'side');

  const refused = await onGit((service) => addWorktree(service, join(partial, '.git'), { mode: 'detached', path, commit: 'HEAD' }));

  expect(refused.status).not.toBe(0);
  expect(await owing(partial)).toBe(before);
  expect(existsSync(path)).toBe(false);
  expect((await git(partial, ['worktree', 'list', '--porcelain'])).includes('side')).toBe(false);

  const held = process.env.GIT_NO_LAZY_FETCH;
  process.env.GIT_NO_LAZY_FETCH = '0';
  try {
    const again = await onGit((service) =>
      addWorktree(service, join(partial, '.git'), {
        mode: 'detached',
        path: join(tempRoot('git-promisor-off-'), 'side'),
        commit: 'HEAD',
      }),
    );
    expect(again.status).not.toBe(0);
    expect(await owing(partial)).toBe(before);
  } finally {
    if (held === undefined) delete process.env.GIT_NO_LAZY_FETCH;
    else process.env.GIT_NO_LAZY_FETCH = held;
  }
}, 20_000);

test('a git that cannot be started is its own failure, told apart from a run that was lost', async () => {
  const main = await tempRepo('git-unstarted-');
  const path = join(tempRoot('git-unstarted-tree-'), 'side');

  const failure = await onGit((service) =>
    Effect.flip(
      addWorktree(
        { run: (args, options) => service.run(args, { ...options, env: { PATH: '/nonexistent' }, extendEnv: false }) },
        join(main, '.git'),
        { mode: 'detached', path, commit: 'HEAD' },
      ),
    ),
  );

  expect(failure._tag).toBe('GitUnavailable');
  expect(existsSync(path)).toBe(false);
}, 6_000);

test('a bare store creates, and a destination opening on a dash is the path it is', async () => {
  const main = await tempRepo('git-add-odd-');
  const home = tempRoot('git-add-odd-tree-');
  const bare = join(tempRoot('git-add-bare-'), 'mirror.git');
  await git(main, ['clone', '-q', '--bare', main, bare]);

  const dashed = join(home, '-dashed name:x');
  const odd = await onGit((service) =>
    addWorktree(service, join(main, '.git'), { mode: 'new-branch', path: dashed, branch: 'odd', start: 'HEAD' }),
  );
  expect(odd.status).toBe(0);
  expect(await git(dashed, ['symbolic-ref', 'HEAD'])).toBe('refs/heads/odd');

  const dashBranch = await onGit((service) =>
    addWorktree(service, join(main, '.git'), {
      mode: 'new-branch',
      path: join(home, 'dash-branch'),
      branch: '-dashy',
      start: 'HEAD',
    }),
  );
  expect(dashBranch.status).not.toBe(0);
  expect(existsSync(join(home, 'dash-branch'))).toBe(false);
  expect((await git(main, ['worktree', 'list', '--porcelain'])).includes('dash-branch')).toBe(false);

  const mirrored = await onGit((service) =>
    addWorktree(service, bare, { mode: 'detached', path: join(home, 'from-bare'), commit: 'HEAD' }),
  );
  expect(mirrored.status).toBe(0);
  const here = await onGit((service) => locationsAt(service, join(home, 'from-bare')));
  expect(here.commonDir).toBe(bare);
  expect(here.worktree).toBe(join(home, 'from-bare'));
}, 10_000);
