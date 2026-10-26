import { afterAll, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { git, gitExit, onGit, release, tempRepo, tempRoot } from './testing/fixture.js';
import { abortAt, fetchAt, pullAt, pushAt } from './porcelain.js';
import { publishRemoteAt } from './repository.js';

afterAll(release);

async function remoteFor(root: string, prefix: string): Promise<string> {
  const bare = join(tempRoot(prefix), 'remote.git');
  await git(root, ['init', '-q', '--bare', '-b', 'main', bare]);
  await git(root, ['remote', 'add', 'origin', bare]);
  return bare;
}

test('a push moves the remote ref it names, and a push onto a moved remote refuses and moves nothing', async () => {
  const root = await tempRepo('git-push-');
  const bare = await remoteFor(root, 'git-push-remote-');

  const moved = await onGit((service) => pushAt(service, root, { target: { remote: 'origin', branch: 'main' }, setUpstream: true }));

  expect(moved).toEqual(['refs/heads/main']);
  expect(await git(bare, ['rev-parse', 'refs/heads/main'])).toBe(await git(root, ['rev-parse', 'HEAD']));

  expect(await onGit((service) => pushAt(service, root))).toEqual([]);

  const other = await cloneOf(bare, 'git-push-other-');
  await git(other, ['commit', '-q', '--allow-empty', '-m', 'theirs']);
  await git(other, ['push', '-q', 'origin', 'main']);
  const theirs = await git(bare, ['rev-parse', 'refs/heads/main']);
  await git(root, ['commit', '-q', '--allow-empty', '-m', 'ours']);

  const refused = await onGit((service) => Effect.flip(pushAt(service, root, { target: { remote: 'origin', branch: 'main' } })));

  expect(refused._tag).toBe('GitRefused');
  expect(refused._tag === 'GitRefused' && refused.message).not.toBe('');
  expect(await git(bare, ['rev-parse', 'refs/heads/main'])).toBe(theirs);
});

test('an abort ends the operation in progress, and a tree holding none refuses in git’s words', async () => {
  const root = await tempRepo('git-abort-');
  writeFileSync(join(root, 'f.txt'), 'base\n');
  await git(root, ['add', '--', 'f.txt']);
  await git(root, ['commit', '-qm', 'born']);
  await git(root, ['branch', 'theirs']);
  writeFileSync(join(root, 'f.txt'), 'ours\n');
  await git(root, ['commit', '-qam', 'ours']);
  await git(root, ['checkout', '-q', 'theirs']);
  writeFileSync(join(root, 'f.txt'), 'theirs\n');
  await git(root, ['commit', '-qam', 'theirs']);

  expect(await gitExit(root, ['merge', '--no-edit', 'main'])).not.toBe(0);
  expect((await git(root, ['rev-parse', '--verify', 'MERGE_HEAD'])).length).toBe(40);

  await onGit((service) => abortAt(service, root, 'merge'));

  expect(await gitExit(root, ['rev-parse', '--verify', 'MERGE_HEAD'])).not.toBe(0);
  expect(await git(root, ['show', 'HEAD:f.txt'])).toBe('theirs');
  expect(await git(root, ['status', '--porcelain'])).toBe('');

  const refused = await onGit((service) => Effect.flip(abortAt(service, root, 'merge')));
  expect(refused._tag).toBe('GitRefused');
  expect(refused.command).toContain('--abort');
});

async function cloneOf(bare: string, prefix: string): Promise<string> {
  const copy = join(tempRoot(prefix), 'copy');
  await git(bare, ['clone', '-q', bare, copy]);
  await git(copy, ['config', 'user.email', 'git@test']);
  await git(copy, ['config', 'user.name', 'git']);
  return copy;
}

test('a fetch brings the upstream in, and a pull fast-forwards a branch only behind whatever merge.ff says', async () => {
  const root = await tempRepo('git-pull-');
  const bare = await remoteFor(root, 'git-pull-remote-');
  await git(root, ['push', '-q', '-u', 'origin', 'main']);
  const other = await cloneOf(bare, 'git-pull-other-');
  await git(other, ['commit', '-q', '--allow-empty', '-m', 'theirs']);
  await git(other, ['push', '-q', 'origin', 'main']);
  await git(root, ['config', 'merge.ff', 'false']);

  expect(await git(root, ['rev-list', '--count', 'HEAD..@{u}'])).toBe('0');
  await onGit((service) => fetchAt(service, root));
  expect(await git(root, ['rev-list', '--count', 'HEAD..@{u}'])).toBe('1');

  const pulled = await onGit((service) => pullAt(service, root));

  expect(pulled).toEqual({ head: await git(bare, ['rev-parse', 'refs/heads/main']), moved: true, conflicts: [], merge: null });
  expect(await git(root, ['rev-list', '--count', 'HEAD'])).toBe('2');

  expect(await onGit((service) => pullAt(service, root))).toMatchObject({ moved: false, conflicts: [] });

  await git(other, ['checkout', '-q', '-b', 'side']);
  await git(other, ['commit', '-q', '--allow-empty', '-m', 'aside']);
  await git(other, ['checkout', '-q', 'main']);
  await git(other, ['merge', '-q', '--no-ff', '-m', 'their merge', 'side']);
  await git(other, ['push', '-q', 'origin', 'main']);
  expect(await onGit((service) => pullAt(service, root))).toEqual({
    head: await git(bare, ['rev-parse', 'refs/heads/main']),
    moved: true,
    conflicts: [],
    merge: null,
  });
});

test('a pull over diverged work answers the merged tree without touching the checkout whatever pull.ff says, and one that conflicts stops in the checkout with its conflicted paths', async () => {
  const root = await tempRepo('git-pull-merge-');
  writeFileSync(join(root, 'f.txt'), 'base\n');
  await git(root, ['add', '--', 'f.txt']);
  await git(root, ['commit', '-qm', 'base']);
  const bare = await remoteFor(root, 'git-pull-merge-remote-');
  await git(root, ['push', '-q', '-u', 'origin', 'main']);
  const other = await cloneOf(bare, 'git-pull-merge-other-');
  writeFileSync(join(other, 'g.txt'), 'theirs\n');
  await git(other, ['add', '--', 'g.txt']);
  await git(other, ['commit', '-qm', 'theirs']);
  await git(other, ['push', '-q', 'origin', 'main']);
  await git(root, ['commit', '-q', '--allow-empty', '-m', 'ours']);
  await git(root, ['config', 'pull.ff', 'only']);

  const ours = await git(root, ['rev-parse', 'HEAD']);
  const merged = await onGit((service) => pullAt(service, root));

  expect(merged).toMatchObject({
    head: ours,
    moved: false,
    conflicts: [],
    merge: { upstream: await git(bare, ['rev-parse', 'refs/heads/main']) },
  });
  expect(await git(root, ['ls-tree', '--name-only', merged.merge?.tree ?? '', 'g.txt'])).toBe('g.txt');
  expect(merged.merge?.message).toContain('Merge branch');
  expect(await git(root, ['status', '--porcelain'])).toBe('');
  expect(await gitExit(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).not.toBe(0);
  await git(root, ['merge', '-q', '--no-edit', '@{u}']);

  writeFileSync(join(other, 'f.txt'), 'theirs\n');
  await git(other, ['commit', '-qam', 'theirs again']);
  await git(other, ['push', '-q', 'origin', 'main']);
  writeFileSync(join(root, 'f.txt'), 'ours\n');
  await git(root, ['commit', '-qam', 'ours again']);
  const standing = await git(root, ['rev-parse', 'HEAD']);

  const conflicted = await onGit((service) => pullAt(service, root));

  expect(conflicted).toEqual({ head: standing, moved: false, conflicts: ['f.txt'], merge: null });
  expect((await git(root, ['rev-parse', '--verify', 'MERGE_HEAD'])).length).toBe(40);

  const again = await onGit((service) => Effect.flip(pullAt(service, root)));
  expect(again._tag).toBe('GitRefused');
});

test('a pull a local change would be overwritten by refuses and leaves the change in the tree, autostash or not', async () => {
  const root = await tempRepo('git-pull-dirty-');
  writeFileSync(join(root, 'f.txt'), 'base\n');
  await git(root, ['add', '--', 'f.txt']);
  await git(root, ['commit', '-qm', 'base']);
  const bare = await remoteFor(root, 'git-pull-dirty-remote-');
  await git(root, ['push', '-q', '-u', 'origin', 'main']);
  const other = await cloneOf(bare, 'git-pull-dirty-other-');
  writeFileSync(join(other, 'f.txt'), 'theirs\n');
  await git(other, ['commit', '-qam', 'theirs']);
  await git(other, ['push', '-q', 'origin', 'main']);
  await git(root, ['config', 'merge.autostash', 'true']);
  writeFileSync(join(root, 'f.txt'), 'a session is still writing this\n');

  const refused = await onGit((service) => Effect.flip(pullAt(service, root)));

  expect(refused._tag).toBe('GitRefused');
  expect(await git(root, ['stash', 'list'])).toBe('');
  expect(await git(root, ['diff', '--name-only'])).toBe('f.txt');
});

test('a pull with no upstream to read from refuses in git’s words and starts no merge', async () => {
  const root = await tempRepo('git-pull-none-');

  const refused = await onGit((service) => Effect.flip(pullAt(service, root)));

  expect(refused._tag).toBe('GitRefused');
  expect(await gitExit(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).not.toBe(0);
});

test('a branch publishes where its push remote, then the push default, names a remote that exists — else the only remote, else origin', async () => {
  const root = await tempRepo('git-publish-');
  const publishTo = () => onGit((service) => publishRemoteAt(service, root, 'Feature.x'));
  expect(await publishTo()).toBeNull();

  await git(root, ['remote', 'add', 'up.stream', join(tempRoot('git-publish-up-'), 'up.git')]);
  expect(await publishTo()).toBe('up.stream');

  await git(root, ['remote', 'add', 'fork', join(tempRoot('git-publish-fork-'), 'fork.git')]);
  expect(await publishTo()).toBeNull();

  await remoteFor(root, 'git-publish-remote-');
  expect(await publishTo()).toBe('origin');

  await git(root, ['config', 'remote.pushDefault', 'fork']);
  expect(await publishTo()).toBe('fork');

  await git(root, ['config', 'branch.Feature.x.pushRemote', 'up.stream']);
  expect(await publishTo()).toBe('up.stream');
  expect(await onGit((service) => publishRemoteAt(service, root, 'other'))).toBe('fork');

  await git(root, ['config', 'branch.Feature.x.pushRemote', 'nowhere']);
  expect(await publishTo()).toBeNull();

  const pushOnly = await tempRepo('git-publish-pushurl-');
  await git(pushOnly, ['config', 'remote.mirror.pushurl', join(tempRoot('git-publish-mirror-'), 'mirror.git')]);
  expect(await onGit((service) => publishRemoteAt(service, pushOnly, 'main'))).toBe('mirror');
});
