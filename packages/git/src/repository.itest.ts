import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { Git, GitAnswer } from './Git.js';
import { git, onGit, release, tempRepo, tempRoot } from './testing/fixture.js';
import {
  run,
  commitOf,
  headAt,
  locationsAt,
  pathAt,
  pathsAt,
  repositoryAt,
  standingAt,
  storeAt,
  storeHeadAt,
  troubleOf,
} from './repository.js';
import { worktreesOf } from './worktree.js';

afterAll(release);

const failedWith = <A, E extends { readonly _tag: string }>(read: (service: Git['Service']) => Effect.Effect<A, E>): Promise<string> =>
  onGit((service) => Effect.catch(Effect.as(read(service), 'no failure'), (failure) => Effect.succeed(failure._tag)));

const answering = (answer: (args: readonly string[]) => Partial<GitAnswer>): Git['Service'] => ({
  run: (args) =>
    Effect.succeed({
      status: 0,
      stdout: '',
      stderr: '',
      overflow: false,
      messageOverflow: false,
      ...answer(args),
    }),
});

test('a linked worktree names its own git directory, its checkout root and the branch it stands on', async () => {
  const main = await tempRepo('git-linked-');
  const linked = join(tempRoot('git-linked-tree-'), 'side');
  await git(main, ['worktree', 'add', '-q', '-b', 'side', linked]);
  mkdirSync(join(linked, 'inner', 'deep'), { recursive: true });

  const here = await onGit((service) => repositoryAt(service, join(linked, 'inner', 'deep')));

  expect(here.commonDir).toBe(join(main, '.git'));
  expect(here.gitDir).toBe(join(main, '.git', 'worktrees', 'side'));
  expect(here.worktree).toBe(linked);
  expect(here.prefix).toBe('inner/deep');
  expect(here.bare).toBe(false);
  expect(here.head.ref).toBe('refs/heads/side');
  expect(here.head.commit).toBe(await git(main, ['rev-parse', 'HEAD']));
  const standing = await onGit((service) => standingAt(service, linked, ['index', 'MERGE_HEAD']));
  expect(standing.layout).toEqual({
    gitDir: join(main, '.git', 'worktrees', 'side'),
    commonDir: join(main, '.git'),
    paths: [join(main, '.git', 'worktrees', 'side', 'index'), join(main, '.git', 'worktrees', 'side', 'MERGE_HEAD')],
  });
  expect(standing.head.ref).toBe('refs/heads/side');
});

test('a bare repository, a detached HEAD and a branch with no commit are each named', async () => {
  const main = await tempRepo('git-states-');
  const bare = join(tempRoot('git-bare-'), 'mirror.git');
  await git(main, ['clone', '-q', '--bare', main, bare]);
  const unborn = tempRoot('git-unborn-');
  await git(unborn, ['init', '-q', '-b', 'trunk']);

  const mirror = await onGit((service) => repositoryAt(service, bare));
  expect(mirror.bare).toBe(true);
  expect(mirror.worktree).toBe(null);
  expect(mirror.head.commit).toBe(await git(main, ['rev-parse', 'HEAD']));

  await git(main, ['checkout', '-q', '--detach', 'HEAD']);
  const loose = await onGit((service) => repositoryAt(service, main));
  expect(loose.head.ref).toBe(null);
  expect(loose.head.commit).toBe(await git(main, ['rev-parse', 'HEAD']));

  const empty = await onGit((service) => repositoryAt(service, unborn));
  expect(empty.head.ref).toBe('refs/heads/trunk');
  expect(empty.head.commit).toBe(null);
  expect(empty.bare).toBe(false);
});

test('the store reads inside its own common directory, where the checkout probes refuse', async () => {
  const main = await tempRepo('git-store-');
  const linked = join(tempRoot('git-store-tree-'), 'side');
  await git(main, ['worktree', 'add', '-q', '-b', 'side', linked]);
  const common = join(main, '.git');

  const shared = await onGit((service) => storeAt(service, common));
  expect(shared).toEqual({ commonDir: common, bare: false });
  expect(await onGit((service) => storeAt(service, linked))).toEqual(shared);
  expect((await onGit((service) => headAt(service, common))).ref).toBe('refs/heads/main');
  expect(await failedWith((service) => locationsAt(service, common))).toBe('GitRefused');

  const bare = join(tempRoot('git-store-bare-'), 'mirror.git');
  await git(main, ['clone', '-q', '--bare', main, bare]);
  expect(await onGit((service) => storeAt(service, bare))).toEqual({ commonDir: bare, bare: true });

  const outside = tempRoot('git-store-outside-');
  expect(await failedWith((service) => storeAt(service, outside))).toBe('GitRefused');

  expect(await onGit((service) => storeHeadAt(service, common))).toEqual({
    store: shared,
    head: { ref: 'refs/heads/main', commit: await git(main, ['rev-parse', 'HEAD']) },
  });
  const unborn = tempRoot('git-store-unborn-');
  await git(unborn, ['init', '-q', '-b', 'trunk']);
  expect(await onGit((service) => storeHeadAt(service, unborn))).toEqual({
    store: { commonDir: join(unborn, '.git'), bare: false },
    head: null,
  });
  expect(await onGit((service) => Effect.flip(storeHeadAt(service, outside)))).toEqual(
    await onGit((service) => Effect.flip(storeAt(service, outside))),
  );
  expect(await onGit((service) => Effect.flip(pathsAt(service, outside, ['--git-common-dir', '--git-dir'], undefined)))).toEqual(
    await onGit((service) => Effect.flip(pathAt(service, outside, ['--git-common-dir'], undefined))),
  );
});

test('a place git will not read as a repository refuses, and is never an empty worktree list', async () => {
  const outside = tempRoot('git-outside-');

  expect(await failedWith((service) => worktreesOf(service, outside))).toBe('GitRefused');
  expect(await failedWith((service) => repositoryAt(service, outside))).toBe('GitRefused');
});

test('the worktree list holds a path with a newline in it, and names a registration git would prune', async () => {
  const main = await tempRepo('git-unusual-');
  const odd = join(tempRoot('git-unusual-tree-'), 'we\nird');
  await git(main, ['worktree', 'add', '-q', '-b', 'side', odd]);

  await git(main, ['worktree', 'lock', odd, '--reason', 'held for a test']);
  const standing = await onGit((service) => worktreesOf(service, main));

  expect(standing.map((worktree) => worktree.path)).toEqual([main, odd]);
  expect(standing[1]?.head?.ref).toBe('refs/heads/side');
  expect(standing[1]?.locked).toBe('held for a test');
  expect(standing.every((worktree) => worktree.prunable === null)).toBe(true);

  await git(main, ['worktree', 'unlock', odd]);
  rmSync(odd, { recursive: true, force: true });
  const stale = await onGit((service) => worktreesOf(service, main));

  expect(stale.map((worktree) => worktree.path)).toEqual([main, odd]);
  expect(stale[1]?.prunable).not.toBe(null);
});

test('the places of a repository come back spelled as they stand, newline and spaces included', async () => {
  const home = tempRoot('git-framing-');
  const root = join(home, 'we\nird repo ');
  mkdirSync(join(root, ' sp ace ', 'deep'), { recursive: true });
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'git@test']);
  await git(root, ['config', 'user.name', 'git']);
  await git(root, ['commit', '-q', '--allow-empty', '-m', 'born']);

  const here = await onGit((service) => repositoryAt(service, join(root, ' sp ace ', 'deep')));

  expect(here.worktree).toBe(root);
  expect(here.commonDir).toBe(join(root, '.git'));
  expect(here.gitDir).toBe(join(root, '.git'));
  expect(here.prefix).toBe(' sp ace /deep');
  expect(here.head.ref).toBe('refs/heads/main');
  expect(await onGit((service) => pathsAt(service, root, ['--git-common-dir', '--git-dir'], undefined))).toEqual([
    join(root, '.git'),
    join(root, '.git'),
  ]);
  expect(await onGit((service) => storeHeadAt(service, root))).toEqual({
    store: { commonDir: join(root, '.git'), bare: false },
    head: null,
  });
});

test('a HEAD probe git refuses is carried out as the refusal, never as a detached or unborn head', async () => {
  const root = await tempRepo('git-head-');
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/../../escape\n');

  expect(await failedWith((service) => repositoryAt(service, root))).toBe('GitRefused');
});

test('a record whose required field arrives empty or missing is unreadable, never a list one row short', async () => {
  const nameless = answering(() => ({ stdout: 'worktree /a\0HEAD 0000\0\0HEAD abcdef\0detached\0\0' }));
  const refless = answering(() => ({ stdout: 'worktree /a\0HEAD abcdef\0branch \0\0' }));

  expect(await failedWith(() => worktreesOf(nameless, '/a'))).toBe('GitUnreadable');
  expect(await failedWith(() => worktreesOf(refless, '/a'))).toBe('GitUnreadable');
});

test('a revision this repository does not hold answers none, where an unreadable place refuses', async () => {
  const main = await tempRepo('git-commit-');
  const common = join(main, '.git');
  const unborn = tempRoot('git-commit-unborn-');
  await git(unborn, ['init', '-q', '-b', 'trunk']);
  const head = await git(main, ['rev-parse', 'HEAD']);

  for (const revision of ['HEAD', 'main', 'refs/heads/main', head]) {
    expect(await onGit((service) => commitOf(service, common, revision))).toBe(head);
  }
  expect(await onGit((service) => commitOf(service, common, 'refs/heads/absent'))).toBe(null);
  expect(await onGit((service) => commitOf(service, unborn, 'refs/heads/trunk'))).toBe(null);
  expect(await failedWith((service) => commitOf(service, tempRoot('git-commit-outside-'), 'HEAD'))).toBe('GitRefused');
  rmSync(join(main, '.git', 'objects', head.slice(0, 2), head.slice(2)));
  expect(await failedWith((service) => commitOf(service, common, 'HEAD'))).toBe('GitRefused');
});

test('a refusal whose words passed the declared capture is still a refusal, and says they were cut', async () => {
  const root = await tempRepo('git-refusal-cut-');
  const loud = ['-c', "alias.loud=!head -c 4096 /dev/zero | tr '\\0' 'x' >&2; exit 3", 'loud'];

  const bounded = await onGit((service) => Effect.flip(run(service, root, loud, 32)));
  const whole = await onGit((service) => Effect.flip(run(service, root, loud, undefined)));

  expect(bounded._tag).toBe('GitRefused');
  expect(bounded._tag === 'GitRefused' && bounded.truncated).toBe(true);
  expect(bounded._tag === 'GitRefused' && bounded.message).toHaveLength(32);
  expect(whole._tag === 'GitRefused' && whole.truncated).toBe(false);
  expect(whole._tag === 'GitRefused' && whole.message).toHaveLength(4096);
  expect(troubleOf(bounded).startsWith('xxx')).toBe(true);
  expect(troubleOf(bounded).includes('(cut;')).toBe(true);
});

test('a capture smaller than the listing answers incomplete rather than a shorter list', async () => {
  const main = await tempRepo('git-bounded-');

  expect(await failedWith((service) => worktreesOf(service, main, { capture: 8 }))).toBe('GitAnswerInvalid');
});
