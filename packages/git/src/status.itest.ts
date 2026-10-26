import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { Git } from './Git.js';
import { git, onGit, release, tempRepo, tempRoot } from './testing/fixture.js';
import { refreshBranch, sequencerAt, statusAt } from './status.js';

afterAll(release);

const named = (entries: readonly { readonly path: string }[]): string[] => entries.map((entry) => entry.path).sort();

const answering = (stdout: string): Git['Service'] => ({
  run: () => Effect.succeed({ status: 0, stdout, stderr: '', overflow: false, messageOverflow: false }),
});

test('every area names its paths as they stand, a rename carries both names, and one path stands in two areas', async () => {
  const root = await tempRepo('git-status-');
  const odd = 'we\nird.txt';
  for (const name of [odd, 'old.txt', 'both.txt']) writeFileSync(join(root, name), 'born\n');
  await git(root, ['add', '--', odd, 'old.txt', 'both.txt']);
  await git(root, ['commit', '-qm', 'born']);

  writeFileSync(join(root, odd), 'changed\n');
  await git(root, ['add', '--', odd]);
  await git(root, ['mv', 'old.txt', 'new.txt']);
  writeFileSync(join(root, 'both.txt'), 'staged\n');
  await git(root, ['add', '--', 'both.txt']);
  writeFileSync(join(root, 'both.txt'), 'and changed again\n');
  writeFileSync(join(root, 'хорошо.txt'), 'unknown to the index\n');

  const seen = await onGit((service) => statusAt(service, root, { untracked: 'all' }));

  expect(named(seen.entries.staged)).toEqual(['both.txt', 'new.txt', odd].sort());
  expect(named(seen.entries.unstaged)).toEqual(['both.txt']);
  expect(named(seen.entries.untracked)).toEqual(['хорошо.txt']);
  expect(seen.entries.unmerged).toEqual([]);
  const moved = seen.entries.staged.find((entry) => entry.path === 'new.txt');
  expect(moved?.status).toBe('renamed');
  expect(moved?.oldPath).toBe('old.txt');
  expect(seen.entries.staged.find((entry) => entry.path === odd)?.modes).toEqual({
    head: '100644',
    index: '100644',
    worktree: '100644',
  });
  expect(seen.entries.unstaged[0]?.status).toBe('modified');
  expect(await onGit((service) => sequencerAt(service, root))).toBe('none');
  expect(seen.branch.ref).toBe('main');
}, 6_000);

test('the answer speaks for the coverage the options declared, and for no more of the tree', async () => {
  const root = await tempRepo('git-status-covered-');
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'above.txt'), 'outside the pathspec\n');
  writeFileSync(join(root, 'sub', 'inside.txt'), 'inside it\n');

  const whole = await onGit((service) => statusAt(service, root, { untracked: 'all' }));
  expect(named(whole.entries.untracked)).toEqual(['above.txt', 'sub/inside.txt']);
  expect(whole.coverage).toEqual({ untracked: 'all', paths: null });

  const scoped = await onGit((service) => statusAt(service, root, { untracked: 'all', paths: ['sub'] }));
  expect(named(scoped.entries.untracked)).toEqual(['sub/inside.txt']);
  expect(scoped.coverage).toEqual({ untracked: 'all', paths: ['sub'] });

  const tracked = await onGit((service) => statusAt(service, root, { untracked: 'no' }));
  expect(tracked.entries.untracked).toEqual([]);
  expect(tracked.coverage).toEqual({ untracked: 'no', paths: null });
}, 6_000);

test('a merge answers its unmerged entry and its operation, and a linked worktree answers its own', async () => {
  const main = await tempRepo('git-status-merge-');
  writeFileSync(join(main, 'f.txt'), 'base\n');
  await git(main, ['add', '--', 'f.txt']);
  await git(main, ['commit', '-qm', 'base']);
  await git(main, ['checkout', '-q', '-b', 'side']);
  writeFileSync(join(main, 'f.txt'), 'side\n');
  await git(main, ['commit', '-qam', 'side']);
  await git(main, ['checkout', '-q', 'main']);
  writeFileSync(join(main, 'f.txt'), 'main\n');
  await git(main, ['commit', '-qam', 'main']);
  const linked = join(tempRoot('git-status-merge-tree-'), 'other');
  await git(main, ['worktree', 'add', '-q', '-b', 'other', linked, 'main']);

  await onGit((service) => service.run(['-C', main, 'merge', 'side']));
  const conflicted = await onGit((service) => statusAt(service, main, { untracked: 'no' }));

  expect(named(conflicted.entries.unmerged)).toEqual(['f.txt']);
  expect(conflicted.entries.unmerged[0]?.status).toBe('unmerged');
  expect(conflicted.entries.unmerged[0]?.conflict?.kind).toBe('both-modified');
  expect(conflicted.entries.unmerged[0]?.conflict?.stage2).toBe('100644');
  expect(await onGit((service) => sequencerAt(service, main))).toBe('merge');

  expect(await onGit((service) => sequencerAt(service, linked))).toBe('none');
  await onGit((service) => service.run(['-C', linked, 'merge', 'side']));
  const here = await onGit((service) => statusAt(service, linked, { untracked: 'no' }));
  expect(await onGit((service) => sequencerAt(service, linked))).toBe('merge');
  expect(named(here.entries.unmerged)).toEqual(['f.txt']);
}, 10_000);

test('a stopped revert and a stopped am each name themselves, where none and rebase would both be lies', async () => {
  const reverting = await tempRepo('git-status-revert-');
  writeFileSync(join(reverting, 'f.txt'), 'one\n');
  await git(reverting, ['add', '--', 'f.txt']);
  await git(reverting, ['commit', '-qm', 'one']);
  writeFileSync(join(reverting, 'f.txt'), 'two\n');
  await git(reverting, ['commit', '-qam', 'two']);
  writeFileSync(join(reverting, 'f.txt'), 'three\n');
  await git(reverting, ['commit', '-qam', 'three']);

  await onGit((service) => service.run(['-C', reverting, 'revert', '--no-edit', 'HEAD~1']));
  const stopped = await onGit((service) => statusAt(service, reverting, { untracked: 'no' }));

  expect(await onGit((service) => sequencerAt(service, reverting))).toBe('revert');
  expect(named(stopped.entries.unmerged)).toEqual(['f.txt']);

  const applying = await tempRepo('git-status-am-');
  writeFileSync(join(applying, 'f.txt'), 'one\n');
  await git(applying, ['add', '--', 'f.txt']);
  await git(applying, ['commit', '-qm', 'one']);
  writeFileSync(join(applying, 'f.txt'), 'two\n');
  await git(applying, ['commit', '-qam', 'two']);
  const patches = tempRoot('git-status-am-patch-');
  await git(applying, ['format-patch', '-q', '-1', 'HEAD', '-o', patches]);
  await git(applying, ['checkout', '-q', '-b', 'side', 'HEAD~1']);
  writeFileSync(join(applying, 'f.txt'), 'something else\n');
  await git(applying, ['commit', '-qam', 'clashing']);
  const patch = join(patches, readdirSync(patches)[0] as string);

  await onGit((service) => service.run(['-C', applying, 'am', patch]));

  expect(await onGit((service) => sequencerAt(service, applying))).toBe('am');
}, 10_000);

test('the branch header names the commit, the branch and the distance to its upstream', async () => {
  const unborn = tempRoot('git-status-unborn-');
  await git(unborn, ['init', '-q', '-b', 'trunk']);

  const empty = await onGit((service) => statusAt(service, unborn, { untracked: 'no' }));
  expect(empty.branch).toEqual({ head: null, ref: 'trunk', upstream: null, ahead: null, behind: null });
  expect(await onGit((service) => refreshBranch(service, unborn, empty.branch))).toEqual(empty.branch);

  const origin = await tempRepo('git-status-origin-');
  const copy = join(tempRoot('git-status-clone-'), 'copy');
  await git(origin, ['clone', '-q', origin, copy]);
  await git(copy, ['config', 'user.email', 'git@test']);
  await git(copy, ['config', 'user.name', 'git']);
  await git(copy, ['commit', '-q', '--allow-empty', '-m', 'ours']);
  await git(origin, ['commit', '-q', '--allow-empty', '-m', 'theirs']);
  await git(copy, ['fetch', '-q']);

  const standing = await onGit((service) => statusAt(service, copy, { untracked: 'no' }));
  expect(standing.branch.head).toBe(await git(copy, ['rev-parse', 'HEAD']));
  expect(standing.branch.ref).toBe('main');
  expect(standing.branch.upstream).toBe('origin/main');
  expect(standing.branch.ahead).toBe(1);
  expect(standing.branch.behind).toBe(1);
  expect(await onGit((service) => refreshBranch(service, copy, standing.branch))).toEqual(standing.branch);

  await git(copy, ['update-ref', '-d', 'refs/remotes/origin/main']);
  const gone = await onGit((service) => statusAt(service, copy, { untracked: 'no' }));
  expect(gone.branch.upstream).toBe('origin/main');
  expect(await onGit((service) => refreshBranch(service, copy, standing.branch))).toEqual(gone.branch);

  await git(copy, ['checkout', '-q', '--detach', 'HEAD']);
  const loose = await onGit((service) => statusAt(service, copy, { untracked: 'no' }));
  expect(loose.branch.ref).toBe(null);
  expect(loose.branch.head).toBe(await git(copy, ['rev-parse', 'HEAD']));
  expect(loose.branch.upstream).toBe(null);
  expect(loose.branch.ahead).toBe(null);
  expect(loose.branch.behind).toBe(null);
  expect(await onGit((service) => refreshBranch(service, copy, gone.branch))).toEqual(loose.branch);
}, 10_000);

test('a repository whose path holds a newline still answers the operation standing in it', async () => {
  const home = tempRoot('git-status-odd-home-');
  const root = join(home, 'we\nird repo ');
  mkdirSync(root, { recursive: true });
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'git@test']);
  await git(root, ['config', 'user.name', 'git']);
  writeFileSync(join(root, 'f.txt'), 'base\n');
  await git(root, ['add', '--', 'f.txt']);
  await git(root, ['commit', '-qm', 'base']);
  await git(root, ['checkout', '-q', '-b', 'side']);
  writeFileSync(join(root, 'f.txt'), 'side\n');
  await git(root, ['commit', '-qam', 'side']);
  await git(root, ['checkout', '-q', 'main']);
  writeFileSync(join(root, 'f.txt'), 'main\n');
  await git(root, ['commit', '-qam', 'main']);
  await onGit((service) => service.run(['-C', root, 'merge', 'side']));

  const seen = await onGit((service) => statusAt(service, root, { untracked: 'no' }));

  expect(await onGit((service) => sequencerAt(service, root))).toBe('merge');
  expect(named(seen.entries.unmerged)).toEqual(['f.txt']);
  expect(seen.branch.ref).toBe('main');
}, 10_000);

test('a capture smaller than the listing answers incomplete rather than a listing one entry short', async () => {
  const root = await tempRepo('git-status-bounded-');
  for (const name of ['one.txt', 'two.txt', 'three.txt']) writeFileSync(join(root, name), 'x\n');

  const failure = await onGit((service) => Effect.flip(statusAt(service, root, { untracked: 'all', capture: 8 })));

  expect(failure._tag).toBe('GitAnswerInvalid');
}, 4_000);

test('a record with fewer fields than v2 prints is unreadable, never an entry missing from the list', async () => {
  const short = answering('1 M. N... 100644 100644 100644 abcabc\0');
  const originless = answering('2 R. N... 100644 100644 100644 abcabc defdef R100 new.txt\0');
  const unknown = answering('x what git never prints\0');

  const failed = (service: Git['Service']) => Effect.flip(statusAt(service, '/nowhere', { untracked: 'all' }));

  expect((await onGit(() => failed(short)))._tag).toBe('GitUnreadable');
  expect((await onGit(() => failed(originless)))._tag).toBe('GitUnreadable');
  expect((await onGit(() => failed(unknown)))._tag).toBe('GitUnreadable');
});
