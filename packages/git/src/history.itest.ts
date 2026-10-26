import { afterAll, expect, test } from 'bun:test';
import { statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { Git } from './Git.js';
import { ancestorAt, commitFilesAt, commitsAt, compareAt, divergenceAt, logAt, numstatAt, unpushedAt } from './history.js';
import { git, onGit, release, tempRepo } from './testing/fixture.js';

afterAll(release);

const answering = (stdout: string): Git['Service'] => ({
  run: () => Effect.succeed({ status: 0, stdout, stderr: '', overflow: false, messageOverflow: false }),
});

test('the line counts come back per path, a pairing names both of its paths, and a binary file is counted by nobody', async () => {
  const root = await tempRepo('git-numstat-');
  const odd = 'we\nird.txt';
  writeFileSync(join(root, 'keep.txt'), 'a\nb\nc\n');
  writeFileSync(join(root, odd), 'moved\n');
  writeFileSync(join(root, 'blob.bin'), new Uint8Array([0, 1, 2, 3]));
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'born']);

  writeFileSync(join(root, 'keep.txt'), 'a\nB\nc\nd\n');
  await git(root, ['mv', '--', odd, 'renamed.txt']);
  writeFileSync(join(root, 'blob.bin'), new Uint8Array([0, 9, 9, 9, 9]));
  await git(root, ['add', '-A']);
  writeFileSync(join(root, 'keep.txt'), 'a\nB\nc\nd\ne\n');

  const staged = await onGit((service) => numstatAt(service, root, { cached: true }));
  const moved = staged.find((stat) => stat.path === 'renamed.txt');
  expect(moved?.oldPath).toBe(odd);
  expect(moved?.lines).toEqual({ added: 0, removed: 0 });
  expect(staged.find((stat) => stat.path === 'keep.txt')?.lines).toEqual({ added: 2, removed: 1 });
  expect(staged.find((stat) => stat.path === 'blob.bin')?.lines).toBe('binary');

  const working = await onGit((service) => numstatAt(service, root));
  expect(working.map((stat) => stat.path)).toEqual(['keep.txt']);
  expect(working[0]?.lines).toEqual({ added: 1, removed: 0 });

  const narrowed = await onGit((service) => numstatAt(service, root, { cached: true, paths: ['blob.bin'] }));
  expect(narrowed.map((stat) => stat.path)).toEqual(['blob.bin']);
}, 8_000);

test('the working tree reading weighs what a diff weighs, and the index it read stands untouched', async () => {
  const root = await tempRepo('git-numstat-index-');
  writeFileSync(join(root, 'keep.txt'), 'a\nb\nc\n');
  writeFileSync(join(root, 'clean.txt'), 'untouched\n');
  writeFileSync(join(root, 'blob.bin'), new Uint8Array([0, 1, 2, 3]));
  const odd = 'we\nird.txt';
  writeFileSync(join(root, odd), 'one\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'born']);
  await git(root, ['status', '--porcelain=v2']);
  writeFileSync(join(root, 'keep.txt'), 'a\nB\nc\nd\n');
  writeFileSync(join(root, 'blob.bin'), new Uint8Array([0, 9, 9, 9, 9]));
  writeFileSync(join(root, odd), 'two\n');
  utimesSync(join(root, 'clean.txt'), new Date(Date.now() + 2_000), new Date(Date.now() + 2_000));

  const index = join(root, '.git', 'index');
  const before = statSync(index);
  const weighed = await onGit((service) => numstatAt(service, root));
  const after = statSync(index);

  expect(weighed.map((stat) => stat.path).sort()).toEqual(['blob.bin', 'keep.txt', odd].sort());
  expect(weighed.find((stat) => stat.path === 'keep.txt')?.lines).toEqual({ added: 2, removed: 1 });
  expect(weighed.find((stat) => stat.path === 'blob.bin')?.lines).toBe('binary');
  expect(weighed.some((stat) => stat.path === 'clean.txt')).toBe(false);
  expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
}, 8_000);

test('a comparison is measured from the base the two revisions share, and two roots answer no merge base', async () => {
  const root = await tempRepo('git-compare-');
  writeFileSync(join(root, 'a.txt'), 'one\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'base']);
  const base = await git(root, ['rev-parse', 'HEAD']);

  await git(root, ['checkout', '-q', '-b', 'side']);
  writeFileSync(join(root, 'b.txt'), 'first\nsecond\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'add b']);
  writeFileSync(join(root, 'a.txt'), 'ONE\n');
  await git(root, ['commit', '-qam', 'edit a']);

  await git(root, ['checkout', '-q', 'main']);
  writeFileSync(join(root, 'c.txt'), 'only on main\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'add c']);

  const seen = await onGit((service) => compareAt(service, root, 'main', 'side'));

  expect(seen.outcome).toBe('compared');
  if (seen.outcome !== 'compared') throw new Error(seen.outcome);
  expect(seen.mergeBase).toBe(base);
  expect(seen.entries.map((entry) => [entry.path, entry.status])).toEqual([
    ['a.txt', 'modified'],
    ['b.txt', 'added'],
  ]);
  expect(seen.entries[0]?.lines).toEqual({ added: 1, removed: 1 });
  expect(seen.added).toBe(3);
  expect(seen.removed).toBe(1);

  await git(root, ['checkout', '-q', '--orphan', 'lonely']);
  await git(root, ['commit', '-q', '--allow-empty', '-m', 'no shared history']);
  const apart = await onGit((service) => compareAt(service, root, 'main', 'lonely'));

  expect(apart.outcome).toBe('no-merge-base');
}, 10_000);

test('the log answers no more than the max it was given, and every field of a record survives its framing', async () => {
  const root = await tempRepo('git-log-');
  writeFileSync(join(root, 'f.txt'), 'one\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', `weird${String.fromCharCode(0x1f)}subject`]);
  writeFileSync(join(root, 'f.txt'), 'two\n');
  await git(root, ['commit', '-qam', 'second']);

  const bounded = await onGit((service) => logAt(service, root, { range: 'HEAD', max: 1 }));
  expect(bounded.map((commit) => commit.subject)).toEqual(['second']);

  const whole = await onGit((service) => logAt(service, root, { range: 'HEAD', max: 10 }));
  expect(whole).toHaveLength(3);
  expect(whole[0]?.sha).toBe(await git(root, ['rev-parse', 'HEAD']));
  expect(whole[0]?.parents).toEqual([await git(root, ['rev-parse', 'HEAD~1'])]);
  expect(whole[0]?.author).toBe('git');
  expect(whole[0]?.date.startsWith('20')).toBe(true);
  expect(whole[1]?.subject).toBe(`weird${String.fromCharCode(0x1f)}subject`);
  expect(whole[2]?.parents).toEqual([]);
}, 6_000);

test('a subject exclusion judges the subject alone: a body line matching it keeps the commit, in the log and in the unpushed count', async () => {
  const root = await tempRepo('git-log-subject-');
  writeFileSync(join(root, 'f.txt'), 'base\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'base']);
  const base = await git(root, ['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'f.txt'), 'work\n');
  await git(root, ['commit', '-qam', 'user work', '-m', 'graph: 7 (amber-fox)']);
  writeFileSync(join(root, 'f.txt'), 'graph\n');
  await git(root, ['commit', '-qam', 'graph: 8']);
  const pattern = '^graph: [0-9]+( \\(.*\\))?$';

  const log = await onGit((service) => logAt(service, root, { range: `${base}..HEAD`, max: 1, excludeSubject: pattern }));
  expect(log.map((commit) => commit.subject)).toEqual(['user work']);
  expect(await onGit((service) => unpushedAt(service, root, 'HEAD', [base], { excludeSubject: pattern }))).toBe(1);
}, 6_000);

test('a path narrows the log to the commits that touched it, and a name git would quote survives', async () => {
  const root = await tempRepo('git-log-path-');
  const odd = 'we"ird.txt';
  writeFileSync(join(root, 'kept.txt'), 'one\n');
  writeFileSync(join(root, odd), 'alpha\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'born']);
  writeFileSync(join(root, 'kept.txt'), 'two\n');
  await git(root, ['commit', '-qam', 'only kept']);
  writeFileSync(join(root, odd), 'beta\n');
  await git(root, ['commit', '-qam', 'only the odd one']);

  const kept = await onGit((service) => logAt(service, root, { range: 'HEAD', max: 10, paths: ['kept.txt'] }));
  expect(kept.map((commit) => commit.subject)).toEqual(['only kept', 'born']);

  const quoted = await onGit((service) => logAt(service, root, { range: 'HEAD', max: 10, paths: [odd] }));
  expect(quoted.map((commit) => commit.subject)).toEqual(['only the odd one', 'born']);

  const one = await onGit((service) => logAt(service, root, { range: 'HEAD', max: 1, paths: ['kept.txt'] }));
  expect(one.map((commit) => commit.subject)).toEqual(['only kept']);

  const never = await onGit((service) => logAt(service, root, { range: 'HEAD', max: 10, paths: ['absent.txt'] }));
  expect(never).toEqual([]);
}, 8_000);

test("a commit's files are read from its first parent, a root commit against nothing, and a rename is paired", async () => {
  const root = await tempRepo('git-commit-files-');
  writeFileSync(join(root, 'a.txt'), 'one\ntwo\n');
  writeFileSync(join(root, 'blob.bin'), new Uint8Array([0, 1, 2]));
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'born']);
  const born = await git(root, ['rev-parse', 'HEAD']);
  await git(root, ['checkout', '-q', '-b', 'side']);
  writeFileSync(join(root, 'side.txt'), 'side\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'side']);
  await git(root, ['checkout', '-q', 'main']);
  await git(root, ['mv', 'a.txt', 'b.txt']);
  writeFileSync(join(root, 'c.txt'), 'x\ny\nz\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'moved']);
  const moved = await git(root, ['rev-parse', 'HEAD']);
  await git(root, ['merge', '-q', '--no-ff', '-m', 'joined', 'side']);
  const joined = await git(root, ['rev-parse', 'HEAD']);

  const first = await onGit((service) => commitFilesAt(service, root, { sha: born, parents: [] }));
  expect(first.entries.map((entry) => [entry.status, entry.path, entry.lines])).toEqual([
    ['added', 'a.txt', { added: 2, removed: 0 }],
    ['added', 'blob.bin', 'binary'],
  ]);
  expect([first.added, first.removed]).toEqual([2, 0]);

  const second = await onGit((service) => commitFilesAt(service, root, { sha: moved, parents: [born] }));
  expect(second.entries.map((entry) => [entry.status, entry.path, entry.oldPath])).toEqual([
    ['renamed', 'b.txt', 'a.txt'],
    ['added', 'c.txt', undefined],
  ]);
  expect([second.added, second.removed]).toEqual([3, 0]);
  expect(await onGit((service) => commitFilesAt(service, root, { sha: moved, parents: [born] }, { capture: 64 }))).toEqual(second);

  const merge = await onGit((service) => commitsAt(service, root, [joined]));
  const parents = merge.get(joined)?.parents ?? [];
  const third = await onGit((service) => commitFilesAt(service, root, { sha: joined, parents }));
  expect(third.entries.map((entry) => entry.path)).toEqual(['side.txt']);
}, 10_000);

test('commits are read by id with the author email, an id git does not hold is absent, and ancestry answers both ways', async () => {
  const root = await tempRepo('git-commits-');
  writeFileSync(join(root, 'f.txt'), 'one\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'first']);
  writeFileSync(join(root, 'f.txt'), 'two\n');
  await git(root, ['commit', '-qam', 'second']);
  const second = await git(root, ['rev-parse', 'HEAD']);
  await git(root, ['commit', '-q', '--amend', '-m', 'second, amended']);
  const amended = await git(root, ['rev-parse', 'HEAD']);
  const nowhere = 'deadbeef'.repeat(5);

  const read = await onGit((service) => commitsAt(service, root, [amended, nowhere, second]));
  expect([...read.keys()].sort()).toEqual([amended, second].sort());
  expect(read.get(amended)?.subject).toBe('second, amended');
  expect(read.get(amended)?.email).toBe(await git(root, ['config', 'user.email']));

  expect(await onGit((service) => ancestorAt(service, root, amended, 'HEAD'))).toBe(true);
  expect(await onGit((service) => ancestorAt(service, root, second, 'HEAD'))).toBe(false);
}, 8_000);

test('divergence counts what each side holds that the other lacks', async () => {
  const root = await tempRepo('git-divergence-');
  writeFileSync(join(root, 'f.txt'), 'one\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'first']);
  const start = await git(root, ['rev-parse', 'HEAD']);
  await git(root, ['checkout', '-qb', 'side']);
  writeFileSync(join(root, 'g.txt'), 'side\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'side one']);
  writeFileSync(join(root, 'g.txt'), 'side two\n');
  await git(root, ['commit', '-qam', 'side two']);
  await git(root, ['checkout', '-q', start]);
  writeFileSync(join(root, 'f.txt'), 'base moved\n');
  await git(root, ['commit', '-qam', 'base']);
  const base = await git(root, ['rev-parse', 'HEAD']);

  expect(await onGit((service) => divergenceAt(service, root, base, 'side'))).toEqual({ ahead: 2, behind: 1 });
  expect(await onGit((service) => divergenceAt(service, root, start, start))).toEqual({ ahead: 0, behind: 0 });
}, 8_000);

test('a numstat record this reader cannot frame is unreadable, never a path weighing nothing', async () => {
  const halved = answering('3\tkeep.txt\0');
  const mixed = answering('-\t4\tkeep.txt\0');
  const originless = answering('0\t0\t\0only-one-name.txt\0');

  const failed = (service: Git['Service']) => Effect.flip(numstatAt(service, '/nowhere'));

  expect((await onGit(() => failed(halved)))._tag).toBe('GitUnreadable');
  expect((await onGit(() => failed(mixed)))._tag).toBe('GitUnreadable');
  expect((await onGit(() => failed(originless)))._tag).toBe('GitUnreadable');
});
