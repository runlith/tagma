import { access, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { gitAnswer, identityOf, OwnGitFailed, quietGit, type RunGitOptions, runGit, runGitBytes } from '../../platform/git/ownGit.js';
import { AGENT_PERSON } from '../../platform/contract/wire/commits.js';
import { unmergedPaths } from '../../platform/git/unmerged.js';
import { TREE_ORIGINS, TREE_SERVED, TREE_RETIRED } from '../contract/wire/storage.js';
import { STAGING_PATHSPEC } from './atomicFile.js';
import { gitdirOf, treeGitDir } from './batch.js';
import type { Birth, GraphSide } from '../contract/service/exchange.js';

export type ShadowCommit = {
  readonly commit: string;
  readonly author: string;
  readonly message: string;
};

export type ShadowMerge = {
  readonly merged: string | null;
  readonly conflicts: readonly string[];
};

const FORKS_FILE = 'tagma-forks.json';
const ORIGINS = TREE_ORIGINS;
const SERVED = TREE_SERVED;

const fsDone = <A>(work: () => Promise<A>): Effect.Effect<A> => Effect.promise(work);

const present = (path: string): Effect.Effect<boolean> =>
  fsDone(() =>
    access(path).then(
      () => true,
      () => false,
    ),
  );

export const canon = (path: string): Effect.Effect<string> => fsDone(() => realpath(path).catch(() => resolve(path)));

const mergeHeadAbsent = (treeRoot: string): Effect.Effect<boolean> =>
  fsDone(async () => {
    const gitDir = await treeGitDir(treeRoot).catch(() => null);
    if (gitDir === null) return false;
    return access(join(gitDir, 'MERGE_HEAD')).then(
      () => false,
      (cause: NodeJS.ErrnoException) => cause.code === 'ENOENT',
    );
  });

type Standing = { readonly path: string; readonly branch: string | null };

function worktreesIn(listing: string): Standing[] {
  const found: Standing[] = [];
  for (const record of listing.split('\0\0')) {
    let path: string | null = null;
    let branch: string | null = null;
    for (const attribute of record.split('\0')) {
      if (attribute.startsWith('worktree ')) path = attribute.slice('worktree '.length);
      else if (attribute.startsWith('branch refs/heads/')) branch = attribute.slice('branch refs/heads/'.length);
    }
    if (path !== null) found.push({ path, branch });
  }
  return found;
}

export const stagedSides = Effect.fnUntraced(function* (git: Git['Service'], root: string, path: string) {
  const sides = new Map<number, string>();
  const staged = yield* runGitBytes(git, 'staged-sides', ['--literal-pathspecs', '-C', root, 'ls-files', '-u', '-z', '--', path]);
  for (const entry of staged.split('\0')) {
    const [, sha, stage] = (entry.split('\t')[0] ?? '').split(' ');
    if (sha !== undefined && (stage === '2' || stage === '3'))
      sides.set(Number(stage), yield* runGitBytes(git, 'show-stage', ['-C', root, 'cat-file', 'blob', sha]));
  }
  return sides;
});

const shadowAt = (gitDir: string, git: Git['Service'], tracking: string | null) => {
  const run = (op: string, args: readonly string[], options?: RunGitOptions) => runGit(git, op, args, options);
  const worktreeOn = (branch: string) =>
    Effect.map(
      run('worktree-list', ['--git-dir', gitDir, 'worktree', 'list', '--porcelain', '-z']),
      (out) => worktreesIn(out).find((standing) => standing.branch === branch)?.path ?? null,
    );
  const recordOf = (kind: string, treeRoot: string) =>
    Effect.map(canon(treeRoot), (root) => join(gitDir, kind, Bun.hash(root).toString(16)));
  const readRecord = (path: string): Effect.Effect<string | null> =>
    fsDone(() => readFile(path, 'utf8').catch((cause: NodeJS.ErrnoException) => (cause.code === 'ENOENT' ? null : Promise.reject(cause))));
  const writeRecord = Effect.fnUntraced(function* (path: string, value: string) {
    if ((yield* readRecord(path)) === value) return;
    yield* fsDone(() => mkdir(dirname(path), { recursive: true }));
    yield* fsDone(() => writeFile(path, value));
  });
  const belongsTo = Effect.fnUntraced(function* (treeRoot: string, repository: string) {
    return (yield* readRecord(yield* recordOf(ORIGINS, treeRoot))) === (yield* canon(repository));
  });
  const heal = Effect.fnUntraced(function* (treeRoot: string, branch: string, marker: string, createFrom?: string) {
    const staging = `${treeRoot}.attach`;
    yield* fsDone(() => rm(staging, { recursive: true, force: true }));
    yield* fsDone(() => rm(marker, { force: true }));
    yield* run(
      'worktree-add',
      createFrom === undefined
        ? ['--git-dir', gitDir, 'worktree', 'add', staging, branch]
        : ['--git-dir', gitDir, 'worktree', 'add', '-b', branch, staging, createFrom],
    );
    yield* fsDone(() => rename(join(staging, '.git'), marker));
    yield* fsDone(() => rm(staging, { recursive: true, force: true }));
    yield* run('worktree-repair', ['--git-dir', gitDir, 'worktree', 'repair', treeRoot]);
  });
  const moveWorktree = (from: string, to: string) =>
    Effect.andThen(
      fsDone(() => mkdir(dirname(to), { recursive: true })),
      Effect.asVoid(run('worktree-move', ['--git-dir', gitDir, 'worktree', 'move', from, to])),
    );
  const attach = Effect.fnUntraced(
    function* (treeRoot: string, branch: string, options?: { readonly createFrom?: string; readonly unheld?: true }) {
      const marker = join(treeRoot, '.git');
      if (yield* present(marker)) {
        if ((yield* fsDone(() => stat(marker))).isDirectory()) {
          if ((yield* canon(marker)) === (yield* canon(gitDir))) return;
          return yield* new OwnGitFailed({ op: 'attach', message: `${treeRoot} carries a repository that is not this shadow`, ran: true });
        }
        const pointer = gitdirOf(yield* fsDone(() => readFile(marker, 'utf8')));
        if (pointer === null || !(yield* canon(pointer)).startsWith(yield* canon(gitDir))) {
          return yield* new OwnGitFailed({
            op: 'attach',
            message: `${treeRoot} carries a .git that does not point into this shadow`,
            ran: true,
          });
        }
        if (yield* present(pointer)) return;
        yield* heal(treeRoot, branch, marker);
        return;
      }
      const standing = options?.unheld === true ? null : yield* worktreeOn(branch);
      if (standing !== null && (yield* canon(standing)) !== (yield* canon(treeRoot))) {
        if (yield* present(standing)) {
          yield* moveWorktree(standing, treeRoot);
          return;
        }
        yield* run('worktree-prune', ['--git-dir', gitDir, 'worktree', 'prune']);
      }
      if (yield* present(treeRoot)) {
        yield* heal(treeRoot, branch, marker, options?.createFrom);
        return;
      }
      const args = options?.createFrom
        ? ['--git-dir', gitDir, 'worktree', 'add', '-b', branch, treeRoot, options.createFrom]
        : ['--git-dir', gitDir, 'worktree', 'add', treeRoot, branch];
      yield* run('worktree-add', args);
    },
    (effect, treeRoot) =>
      Effect.tap(effect, () => fsDone(() => rm(join(gitDir, TREE_RETIRED, Bun.hash(treeRoot).toString(16)), { force: true }))),
  );
  const forkPoints = (): Effect.Effect<ReadonlyMap<string, string>> =>
    fsDone(() =>
      readFile(join(gitDir, FORKS_FILE), 'utf8').then(
        (text) => new Map(Object.entries(JSON.parse(text) as Record<string, string>)),
        (cause: NodeJS.ErrnoException) => (cause.code === 'ENOENT' ? new Map<string, string>() : Promise.reject(cause)),
      ),
    );
  const writeForks = (forks: ReadonlyMap<string, string>) =>
    fsDone(() => writeFile(join(gitDir, FORKS_FILE), `${JSON.stringify(Object.fromEntries(forks), null, 2)}\n`));
  const recordFork = (branch: string, projectSha: string) =>
    Effect.flatMap(forkPoints(), (held) => writeForks(new Map(held).set(branch, projectSha)));
  const dropFork = (branch: string) =>
    Effect.flatMap(forkPoints(), (held) => {
      const forks = new Map(held);
      return forks.delete(branch) ? writeForks(forks) : Effect.void;
    });

  return {
    gitDir,
    tracking,
    run,
    unmergedPaths: (treeRoot: string) => unmergedPaths(git, treeRoot),
    attach,
    heldBranches: () =>
      Effect.map(
        run('worktree-list', ['--git-dir', gitDir, 'worktree', 'list', '--porcelain', '-z']),
        (out): ReadonlySet<string> => new Set(worktreesIn(out).flatMap((standing) => (standing.branch === null ? [] : [standing.branch]))),
      ),
    branchesAt: Effect.fnUntraced(function* (trees: readonly string[]) {
      const roots = new Set(yield* Effect.forEach(trees, canon));
      const copies = worktreesIn(yield* run('worktree-list', ['--git-dir', gitDir, 'worktree', 'list', '--porcelain', '-z']));
      const standing = yield* Effect.forEach(copies, (copy) => Effect.map(canon(copy.path), (path) => ({ path, branch: copy.branch })));
      return new Set(standing.flatMap((copy) => (copy.branch !== null && roots.has(copy.path) ? [copy.branch] : [])));
    }),
    checkouts: (projectWorktree: string) =>
      Effect.flatMap(run('checkouts', ['-C', projectWorktree, 'worktree', 'list', '--porcelain', '-z']), (out) => {
        const [main, ...linked] = worktreesIn(out).map((standing) => standing.path);
        return main === undefined
          ? Effect.fail(new OwnGitFailed({ op: 'checkouts', message: `${projectWorktree} listed no checkout`, ran: true }))
          : Effect.succeed<[string, ...string[]]>([main, ...linked]);
      }),
    recordCheckout: Effect.fnUntraced(function* (treeRoot: string, repository: string, checkout: string) {
      yield* writeRecord(yield* recordOf(ORIGINS, treeRoot), yield* canon(repository));
      yield* writeRecord(yield* recordOf(SERVED, treeRoot), yield* canon(checkout));
    }),
    belongsTo,
    servedCheckout: (treeRoot: string) => Effect.flatMap(recordOf(SERVED, treeRoot), readRecord),
    retire: Effect.fnUntraced(function* (treeRoot: string) {
      const records = [yield* recordOf(ORIGINS, treeRoot), yield* recordOf(SERVED, treeRoot)];
      yield* run('tree-retire', ['--git-dir', gitDir, 'worktree', 'remove', treeRoot]);
      yield* writeRecord(join(gitDir, TREE_RETIRED, Bun.hash(treeRoot).toString(16)), treeRoot);
      yield* Effect.forEach(records, (record) => fsDone(() => rm(record, { force: true })), { discard: true });
    }),
    free: Effect.fnUntraced(function* (branch: string, trees: readonly string[], repository: string) {
      const holder = yield* worktreeOn(branch);
      if (holder === null) return 'unheld' as const;
      if (!(yield* present(holder))) {
        yield* run('worktree-prune', ['--git-dir', gitDir, 'worktree', 'prune']);
        return 'pruned' as const;
      }
      const held = yield* canon(holder);
      const named = yield* Effect.forEach(trees, canon);
      if (!named.includes(held) && !(yield* belongsTo(holder, repository))) return 'kept' as const;
      yield* run('free', ['-C', holder, 'switch', '--detach']).pipe(
        Effect.mapError(
          (failure) =>
            new OwnGitFailed({
              op: 'free',
              message: `${holder} still holds ${branch}, and its checkout left it, but it could not let go: ${failure.message}`,
              ran: failure.ran,
            }),
        ),
      );
      return 'freed' as const;
    }),
    moveWorktree,
    restore: Effect.fnUntraced(function* (treeRoot: string, branch: string) {
      yield* run('worktree-prune', ['--git-dir', gitDir, 'worktree', 'prune']);
      yield* attach(treeRoot, branch);
    }),
    commitAct: Effect.fnUntraced(function* (treeRoot: string, message: string) {
      yield* run('add', ['-C', treeRoot, 'add', '-A', '--', '.', STAGING_PATHSPEC]);
      const staged = yield* run('staged', ['-C', treeRoot, 'diff', '--cached', '--name-only']);
      if (staged === '') return null;
      yield* run('commit', ['-C', treeRoot, 'commit', '-m', message], { env: identityOf(AGENT_PERSON) });
      return yield* run('rev-parse', ['-C', treeRoot, 'rev-parse', 'HEAD']);
    }),
    branch: (name: string, from: string) => Effect.asVoid(run('branch', ['--git-dir', gitDir, 'branch', name, from])),
    renameBranch: Effect.fnUntraced(function* (from: string, to: string) {
      const held = yield* run('twin', ['--git-dir', gitDir, 'for-each-ref', '--format=%(refname:short)', `refs/heads/${from}`]);
      if (held === '') return false;
      yield* run('twin-rename', ['--git-dir', gitDir, 'branch', '-m', '--end-of-options', from, to]);
      const fork = (yield* forkPoints()).get(from);
      if (fork !== undefined) {
        yield* dropFork(from);
        yield* recordFork(to, fork);
      }
      return true;
    }),
    forkPoints,
    recordFork,
    dropFork,
    merge: Effect.fnUntraced(function* (treeRoot: string, branch: string, message: string) {
      const attempt = yield* gitAnswer(git, 'merge', ['-C', treeRoot, 'merge', '--no-ff', '-m', message, branch], {
        env: identityOf(AGENT_PERSON),
      });
      if (attempt.status === 0) {
        const merged = yield* run('rev-parse', ['-C', treeRoot, 'rev-parse', 'HEAD']);
        return { merged, conflicts: [] };
      }
      const conflicts = yield* unmergedPaths(git, treeRoot);
      if (conflicts.length === 0) {
        return yield* new OwnGitFailed({ op: 'merge', message: attempt.stderr.trim() || attempt.stdout.trim(), ran: true });
      }
      return { merged: null, conflicts };
    }),
    quiet: (op: string, args: readonly string[]) => quietGit(git, op, args),
    mergeInProgress: (treeRoot: string) =>
      Effect.flatMap(mergeHeadAbsent(treeRoot), (absent) =>
        absent
          ? Effect.succeed(false)
          : Effect.map(
              gitAnswer(git, 'merge-state', ['-C', treeRoot, 'rev-parse', '-q', '--verify', 'MERGE_HEAD']),
              (answer) => answer.status === 0,
            ),
      ),
    stagedSides: (treeRoot: string, path: string) => stagedSides(git, treeRoot, path),
    stagePath: (treeRoot: string, path: string) => Effect.asVoid(run('add-path', ['-C', treeRoot, 'add', '--', path])),
    concludeMerge: Effect.fnUntraced(function* (treeRoot: string) {
      yield* run('add', ['-C', treeRoot, 'add', '-A', '--', '.', STAGING_PATHSPEC]);
      yield* run('commit', ['-C', treeRoot, 'commit', '--no-edit'], { env: identityOf(AGENT_PERSON) });
      return yield* run('rev-parse', ['-C', treeRoot, 'rev-parse', 'HEAD']);
    }),
    log: (treeRoot: string, path?: string) =>
      Effect.map(
        run('log', ['-C', treeRoot, 'log', '--format=%H%x1f%an%x1f%s', ...(path === undefined ? [] : ['--follow', '--', path])]),
        (out): ShadowCommit[] =>
          out === ''
            ? []
            : out.split('\n').map((line) => {
                const [commit = '', author = '', message = ''] = line.split('\x1f');
                return { commit, author, message };
              }),
      ),
  };
};

export type ShadowGit = ReturnType<typeof shadowAt>;

const bornEmpty = Effect.fnUntraced(function* (gitDir: string, git: Git['Service']) {
  const tree = yield* runGit(git, 'mktree', ['--git-dir', gitDir, 'mktree'], { stdin: '' });
  const commit = yield* runGit(
    git,
    'commit-tree',
    ['--git-dir', gitDir, 'commit-tree', tree, '-m', 'graph born', '-m', `graph ${crypto.randomUUID()}`],
    {
      env: identityOf(AGENT_PERSON),
    },
  );
  yield* runGit(git, 'update-ref', ['--git-dir', gitDir, 'update-ref', 'refs/heads/main', commit]);
});

const bornBy = Effect.fnUntraced(function* (gitDir: string, git: Git['Service'], birth: Birth) {
  const draft = `${gitDir}.born-${crypto.randomUUID()}`;
  yield* Effect.gen(function* () {
    yield* runGit(git, 'init', ['init', '--bare', '--initial-branch=main', draft]);
    if (!(yield* birth(draft))) yield* bornEmpty(draft, git);
    const placed = yield* fsDone(() =>
      rename(draft, gitDir).then(
        () => true,
        (cause: NodeJS.ErrnoException) => (cause.code === 'ENOTEMPTY' || cause.code === 'EEXIST' ? false : Promise.reject(cause)),
      ),
    );
    if (!placed) yield* fsDone(() => rm(draft, { recursive: true, force: true }));
  }).pipe(Effect.onError(() => fsDone(() => rm(draft, { recursive: true, force: true }))));
});

export const ShadowGit = {
  open: Effect.fnUntraced(function* (gitDir: string, git: Git['Service'], side: GraphSide) {
    if (!(yield* present(gitDir))) {
      if (side.birth !== null) yield* bornBy(gitDir, git, side.birth);
      else {
        yield* runGit(git, 'init', ['init', '--bare', '--initial-branch=main', gitDir]);
        yield* bornEmpty(gitDir, git);
      }
    }
    return shadowAt(gitDir, git, side.tracking);
  }, Effect.uninterruptible),
  openInPlace: Effect.fnUntraced(function* (treeRoot: string, git: Git['Service']) {
    if (!(yield* present(join(treeRoot, '.git')))) {
      yield* fsDone(() => mkdir(treeRoot, { recursive: true }));
      yield* runGit(git, 'init', ['init', '-b', 'main', treeRoot]);
    }
    return shadowAt(join(treeRoot, '.git'), git, null);
  }, Effect.uninterruptible),
};
