import { afterAll, expect, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { git, onGit, release, tempRepo, tempRoot } from './testing/fixture.js';
import { commitTreeAt, mergeTreeAt, replayAt } from './merge.js';
import { fastForwardAt, mergeAt, mergingAt } from './porcelain.js';
import { deleteBranchAt, removeWorktreeAt } from './worktree.js';

afterAll(release);

const commitFile = async (dir: string, name: string, text: string, message: string): Promise<string> => {
  writeFileSync(join(dir, name), text);
  await git(dir, ['add', '--', name]);
  await git(dir, ['commit', '-q', '-m', message]);
  return await git(dir, ['rev-parse', 'HEAD']);
};

const forked = async (prefix: string) => {
  const main = await tempRepo(prefix);
  await commitFile(main, 'f.txt', 'a\nb\nc\n', 'base');
  const side = join(tempRoot(`${prefix}tree-`), 'side');
  await git(main, ['worktree', 'add', '-q', '-b', 'side', side]);
  return { main, side };
};

test('the merge check answers the merged tree, or every conflicted path, and writes no ref', async () => {
  const { main, side } = await forked('git-merge-tree-');
  await commitFile(side, 'f.txt', 'a\nB\nc\n', 'side');
  await commitFile(side, 'g.txt', 'new\n', 'side two');
  const clean = await onGit((service) => mergeTreeAt(service, main, 'main', 'side'));
  expect(clean.conflicts).toEqual([]);
  expect((await git(main, ['ls-tree', '--name-only', clean.tree])).split('\n').sort()).toEqual(['f.txt', 'g.txt']);

  await commitFile(main, 'f.txt', 'a\nX\nc\n', 'main');
  const refs = await git(main, ['for-each-ref']);
  const conflicted = await onGit((service) => mergeTreeAt(service, main, 'main', 'side'));
  expect(conflicted.conflicts).toEqual(['f.txt']);
  expect(await git(main, ['for-each-ref'])).toBe(refs);
  expect(await git(main, ['status', '--porcelain'])).toBe('');
});

test('a merge that conflicts leaves git mid-merge and answers the conflicted paths; a clean one lands a merge commit', async () => {
  const { main, side } = await forked('git-merge-');
  await commitFile(side, 'f.txt', 'a\nB\nc\n', 'side');
  const tip = await git(side, ['rev-parse', 'HEAD']);
  const landed = await onGit((service) => mergeAt(service, main, tip, { message: 'merge side' }));
  expect(landed.conflicts).toEqual([]);
  expect((await git(main, ['rev-list', '--parents', '-1', 'HEAD'])).split(' ')).toHaveLength(3);

  await commitFile(side, 'f.txt', 'a\nC\nc\n', 'side again');
  await commitFile(main, 'f.txt', 'a\nM\nc\n', 'main again');
  const stopped = await onGit((service) => mergeAt(service, main, 'side', { message: 'merge side again' }));
  expect(stopped.conflicts).toEqual(['f.txt']);
  expect(await onGit((service) => mergingAt(service, main))).toBe(true);
});

test('a replay moves the branch commits onto the new base with their authors, drops one already applied, and stops on a conflict', async () => {
  const { main, side } = await forked('git-replay-');
  await git(side, ['config', 'user.name', 'Author One']);
  await commitFile(side, 'g.txt', 'one\n', 'first');
  await commitFile(side, 'h.txt', 'two\n', 'second');
  await commitFile(main, 'h.txt', 'two\n', 'same change on main');
  await commitFile(main, 'k.txt', 'main\n', 'main moved');
  const onto = await git(main, ['rev-parse', 'HEAD']);
  const tip = await git(side, ['rev-parse', 'HEAD']);
  const replayed = await onGit((service) => replayAt(service, main, { onto, upstream: onto, tip }));
  if (replayed.head === null) throw new Error('the replay stopped');
  expect([replayed.applied, replayed.dropped]).toEqual([1, 1]);
  expect(await git(main, ['rev-parse', `${replayed.head}^`])).toBe(onto);
  expect(await git(main, ['log', '-1', '--format=%an%x00%s', replayed.head])).toBe('Author One\0first');

  await commitFile(side, 'k.txt', 'side\n', 'conflicting');
  const conflicting = await git(side, ['rev-parse', 'HEAD']);
  const stopped = await onGit((service) => replayAt(service, main, { onto, upstream: onto, tip: conflicting }));
  expect(stopped.head).toBeNull();
  expect(stopped.conflicts).toEqual(['k.txt']);
});

test('a squash is one commit on the base tip, and a fast-forward lands it beside staged work it does not touch', async () => {
  const { main, side } = await forked('git-squash-');
  await commitFile(side, 'g.txt', 'one\n', 'first');
  await commitFile(side, 'h.txt', 'two\n', 'second');
  const base = await git(main, ['rev-parse', 'HEAD']);
  const merged = await onGit((service) => mergeTreeAt(service, main, base, 'side'));
  const squashed = await onGit((service) => commitTreeAt(service, main, { tree: merged.tree, parents: [base], message: 'squash side' }));
  writeFileSync(join(main, 'staged.txt'), 'mine\n');
  await git(main, ['add', '--', 'staged.txt']);
  const head = await onGit((service) => fastForwardAt(service, main, squashed));
  expect(head).toBe(squashed);
  expect(await git(main, ['diff', '--cached', '--name-only'])).toBe('staged.txt');
  expect(existsSync(join(main, 'h.txt'))).toBe(true);
});

test('removing a worktree keeps its branch, and deleting an unmerged branch refuses', async () => {
  const { main, side } = await forked('git-remove-');
  await commitFile(side, 'g.txt', 'one\n', 'first');
  await onGit((service) => removeWorktreeAt(service, main, side));
  expect(existsSync(side)).toBe(false);
  expect(await git(main, ['rev-parse', '--verify', 'refs/heads/side'])).not.toBe('');
  const refused = await onGit((service) => Effect.flip(deleteBranchAt(service, main, 'side')));
  expect(refused._tag).toBe('GitRefused');
  await git(main, ['merge', '-q', '--no-edit', 'side']);
  await onGit((service) => deleteBranchAt(service, main, 'side'));
  await expect(git(main, ['rev-parse', '--verify', 'refs/heads/side'])).rejects.toThrow();
});
