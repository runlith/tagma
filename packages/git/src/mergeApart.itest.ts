import { afterAll, expect, test } from 'bun:test';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { git, onGit, release, tempRepo, tempRoot } from './testing/fixture.js';
import { mergeTreeAt } from './merge.js';
import { type MergeDriver, mergeTreeApart } from './apart.js';

afterAll(release);

const commitFile = async (dir: string, name: string, text: string, message: string): Promise<void> => {
  writeFileSync(join(dir, name), text);
  await git(dir, ['add', '--', name]);
  await git(dir, ['commit', '-q', '-m', message]);
};

const zeroed = (text: string): string => text.replace(/^count: .*$/gm, 'count: 0');

const driver: MergeDriver = {
  name: 'probe',
  sides: (sides) => Effect.succeed(sides.map((one) => ({ base: zeroed(one.base), ours: zeroed(one.ours), theirs: zeroed(one.theirs) }))),
};

test("a merge apart runs the named driver's rewrite in process and answers the tree git's driver run answers, leaving nothing in the checkout", async () => {
  const main = await tempRepo('git-merge-apart-');
  const runs = join(tempRoot('git-merge-apart-runs-'), 'runs');
  writeFileSync(runs, '');
  const script = join(main, '.git', 'probe-driver');
  writeFileSync(
    script,
    [
      `echo run >> '${runs}'`,
      'for f in "$1" "$2" "$3"; do sed "s/^count: .*/count: 0/" "$f" > "$f.t" && mv "$f.t" "$f"; done',
      'git merge-file -q "$2" "$1" "$3"',
      '',
    ].join('\n'),
  );
  writeFileSync(join(main, '.git', 'info', 'attributes'), '*.md merge=probe\n');
  await git(main, ['config', 'merge.probe.driver', `sh '${script}' %O %A %B`]);
  await commitFile(main, 'debt.md', 'title\ncount: 3\nbody\n', 'base debt');
  await commitFile(main, 'notes.md', 'one\ntwo\nthree\nfour\nfive\n', 'base notes');
  const side = join(tempRoot('git-merge-apart-tree-'), 'side');
  await git(main, ['worktree', 'add', '-q', '-b', 'side', side]);
  await commitFile(side, 'debt.md', 'title\ncount: 1\nbody\n', 'side lowers');
  await commitFile(side, 'notes.md', 'ONE\ntwo\nthree\nfour\nfive\n', 'side notes');
  await commitFile(side, 'g.txt', 'new\n', 'side file');
  await commitFile(main, 'debt.md', 'title\ncount: 2\nbody\n', 'main lowers');
  await commitFile(main, 'notes.md', 'one\ntwo\nthree\nfour\nFIVE\n', 'main notes');

  const driven = await onGit((service) => mergeTreeAt(service, side, 'main', 'side'));
  expect(driven.conflicts).toEqual([]);
  expect(
    readFileSync(runs, 'utf8')
      .split('\n')
      .filter((line) => line !== ''),
  ).toHaveLength(2);

  const apart = await onGit((service) => mergeTreeApart(service, side, 'main', 'side', { driver }));
  expect(apart).toEqual(driven);
  expect(
    readFileSync(runs, 'utf8')
      .split('\n')
      .filter((line) => line !== ''),
  ).toHaveLength(2);
  expect(readdirSync(side).filter((name) => name.startsWith('.merge_file_'))).toEqual([]);
  expect(await git(side, ['status', '--porcelain'])).toBe('');
});

test("a driven path both sides changed on one line conflicts apart as under git's driver, whatever merge the repository gives every other path", async () => {
  const main = await tempRepo('git-merge-apart-union-');
  writeFileSync(join(main, '.git', 'info', 'attributes'), '* merge=union\n*.md merge=probe\n');
  await git(main, ['config', 'merge.probe.driver', 'git merge-file -q %A %O %B']);
  await commitFile(main, 'notes.md', 'one\ntwo\nthree\n', 'base');
  await git(main, ['branch', 'side']);
  await commitFile(main, 'notes.md', 'one\nMAIN\nthree\n', 'main');
  await git(main, ['checkout', '-q', 'side']);
  await commitFile(main, 'notes.md', 'one\nSIDE\nthree\n', 'side');
  await git(main, ['checkout', '-q', 'main']);

  const driven = await onGit((service) => mergeTreeAt(service, main, 'main', 'side'));
  const apart = await onGit((service) => mergeTreeApart(service, main, 'main', 'side', { driver }));

  expect(driven.conflicts).toEqual(['notes.md']);
  expect(apart.conflicts).toEqual(['notes.md']);
});
