import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { copyFile, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Git } from '@runlith/git/Git';
import { Effect, Result } from 'effect';
import { generatedAmong } from '../../platform/git/generated.js';
import { runGit, OwnGitFailed } from '../../platform/git/ownGit.js';
import type { JudgedTree } from '../contract/wire/checks.js';

const placed = (root: string, spelled: string): string => (isAbsolute(spelled) ? spelled : join(root, spelled));

const HEADS = 'refs/heads/';

const branchOf = (ref: string): string | null => (ref.startsWith(HEADS) ? ref.slice(HEADS.length) : null);

const headOf = (git: Git['Service'], root: string): Effect.Effect<string | null, OwnGitFailed> =>
  Effect.catch(runGit(git, 'staged-head', ['-C', root, 'rev-parse', '--verify', '-q', 'HEAD']), (failure) =>
    failure.ran && failure.message === '' ? Effect.succeed(null) : Effect.fail(failure),
  );

const emptyTree = (git: Git['Service'], root: string) =>
  runGit(git, 'staged-empty-tree', ['-C', root, 'hash-object', '-t', 'tree', '-w', '--stdin'], { stdin: '' });

const changed = (git: Git['Service'], root: string, base: string, built: string) =>
  Effect.map(
    runGit(git, 'staged-paths', ['-C', root, 'diff-tree', '-r', '-z', '--name-only', '--no-renames', '--end-of-options', base, built]),
    (listed) => listed.split('\0').filter((path) => path !== ''),
  );

const copied = (from: string, to: string): Effect.Effect<void, OwnGitFailed> =>
  Effect.tryPromise({
    try: () => copyFile(from, to).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? undefined : Promise.reject(error))),
    catch: (cause) =>
      new OwnGitFailed({ op: 'staged-copy', message: `the index could not be copied to judge it: ${String(cause)}`, ran: false }),
  });

const mergingIn = (path: string): Effect.Effect<readonly string[], OwnGitFailed> =>
  Effect.tryPromise({
    try: () =>
      readFile(path, 'utf8').then(
        (text) => text.split('\n').filter((line) => line.trim() !== ''),
        (error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? [] : Promise.reject(error)),
      ),
    catch: (cause) =>
      new OwnGitFailed({
        op: 'staged-merge-heads',
        message: `the heads an open merge brings could not be read: ${String(cause)}`,
        ran: false,
      }),
  });

export type BuiltTree = Omit<JudgedTree, 'paths'> & { readonly commonDir: string };

export const withoutGenerated = Effect.fn('enforcement.withoutGenerated')(function* <T extends JudgedTree>(tree: T) {
  const generated = yield* generatedAmong(yield* Git, tree.root, tree.paths, tree.built);
  return generated.size === 0 ? tree : { ...tree, paths: tree.paths.filter((path) => !generated.has(path)) };
});

export const pathsOf = Effect.fn('enforcement.pathsOf')(function* (tree: Omit<JudgedTree, 'paths'>) {
  return { ...tree, paths: yield* changed(yield* Git, tree.root, tree.base, tree.built) } satisfies JudgedTree;
});

const within = (path: string, dir: string): boolean => {
  const at = relative(dir, path);
  return at !== '' && at !== '..' && !at.startsWith(`..${sep}`) && !isAbsolute(at);
};

export const stagedTree = Effect.fn('enforcement.stagedTree')(function* (projectId: number, root: string, index: string | undefined) {
  const git = yield* Git;
  const places = [
    '-C',
    root,
    'rev-parse',
    '--show-toplevel',
    '--absolute-git-dir',
    '--git-common-dir',
    '--git-path',
    'index',
    '--git-path',
    `tagma-staged-${randomUUID()}.index`,
    '--git-path',
    'MERGE_HEAD',
  ];
  const born = yield* Effect.catch(
    Effect.map(runGit(git, 'staged-places', [...places, 'HEAD', '--symbolic-full-name', 'HEAD']), (out) => out.split('\n')),
    (failure) => (failure.ran ? Effect.succeed(null) : Effect.fail(failure)),
  );
  const [top = '', dir = '', common = '', own = '', spare = '', merging = '', sha = '', ref = ''] =
    born ?? (yield* runGit(git, 'staged-places', places)).split('\n');
  const named = index === undefined ? placed(root, own) : resolve(root, index);
  if (!within(named, dir) && !within(named, resolve(root, common))) {
    return yield* new OwnGitFailed({
      op: 'staged-index',
      message: `${named} is not an index of this checkout's git directory`,
      ran: false,
    });
  }
  const copy = placed(root, spare);
  const head = born === null ? yield* headOf(git, top) : sha;
  const branch = born === null ? undefined : branchOf(ref);
  const merged = head === null ? [] : yield* mergingIn(placed(root, merging));
  return yield* Effect.gen(function* () {
    yield* copied(named, copy);
    const built = yield* runGit(git, 'staged-tree', ['-C', top, 'write-tree'], { env: { GIT_INDEX_FILE: copy } });
    const base = head ?? (yield* emptyTree(git, top));
    return { projectId, root: top, commonDir: resolve(root, common), base, built, merged, branch } satisfies BuiltTree;
  }).pipe(Effect.ensuring(Effect.promise(() => Promise.all([rm(copy, { force: true }), rm(`${copy}.lock`, { force: true })]))));
});

export const landedTree = Effect.fn('enforcement.landedTree')(function* (projectId: number, root: string, commit: string) {
  const git = yield* Git;
  const [top = '', common = '', head = '', ref = ''] = (yield* runGit(git, 'landed-top', [
    '-C',
    root,
    'rev-parse',
    '--show-toplevel',
    '--git-common-dir',
    'HEAD',
    '--symbolic-full-name',
    'HEAD',
  ])).split('\n');
  const logged = yield* Effect.result(
    runGit(git, 'landed-commit', ['-C', top, 'log', '-1', '--format=%H%x00%T%x00%P', '--end-of-options', commit, '--']),
  );
  if (Result.isFailure(logged)) {
    const held = yield* Effect.result(runGit(git, 'landed-held', ['-C', top, 'cat-file', '-e', commit]));
    if (Result.isFailure(held) && held.failure.ran && held.failure.message === '') {
      return yield* new OwnGitFailed({ op: 'landed-missing', message: `${commit} is not a commit ${top} holds`, ran: true });
    }
    return yield* logged.failure;
  }
  const [landed = '', built = '', parents = ''] = logged.success.split('\0');
  const [parent = '', ...merged] = parents.split(' ').filter((one) => one !== '');
  const carried =
    landed === head ||
    (yield* Effect.catch(
      Effect.as(runGit(git, 'landed-carried', ['-C', top, 'merge-base', '--is-ancestor', landed, 'HEAD']), true),
      (failure) => (failure.ran && failure.message === '' ? Effect.succeed(false) : Effect.fail(failure)),
    ));
  if (!carried) {
    return yield* new OwnGitFailed({
      op: 'landed-head',
      message: `${commit} is not a commit HEAD stands on or past in ${top}, and only a commit this checkout carries is recorded`,
      ran: true,
    });
  }
  const base = parent || (yield* emptyTree(git, top));
  return {
    projectId,
    root: top,
    commonDir: resolve(root, common),
    base,
    built,
    merged,
    branch: branchOf(ref),
  } satisfies BuiltTree;
});

const nul = (paths: readonly string[]): string => paths.map((path) => `${path}\0`).join('');

export const fileTree = Effect.fn('enforcement.fileTree')(function* (root: string, paths: readonly string[]) {
  const git = yield* Git;
  const head = yield* runGit(git, 'check-file-head', ['-C', root, 'rev-parse', '--verify', 'HEAD^{tree}']);
  const spelled = yield* runGit(git, 'check-file-index', ['-C', root, 'rev-parse', '--git-path', `tagma-check-${randomUUID()}.index`]);
  const index = isAbsolute(spelled) ? spelled : join(root, spelled);
  const env = { GIT_INDEX_FILE: index };
  return yield* Effect.gen(function* () {
    yield* runGit(git, 'check-file-read', ['-C', root, 'read-tree', head], { env });
    yield* runGit(git, 'check-file-stage', ['-C', root, 'update-index', '--add', '--remove', '-z', '--stdin'], { env, stdin: nul(paths) });
    const built = yield* runGit(git, 'check-file-tree', ['-C', root, 'write-tree'], { env });
    return { base: head, built };
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        rmSync(index, { force: true });
        rmSync(`${index}.lock`, { force: true });
      }),
    ),
  );
});
