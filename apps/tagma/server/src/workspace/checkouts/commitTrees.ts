import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';
import { lane } from '@runlith/held/Lane';
import { CEILINGS } from '../../platform/contract/service/deadlines.js';
import { excludesFileAt } from '../../platform/git/excludes.js';
import { configuredGit, OwnGitFailed, quietGit, runGit } from '../../platform/git/ownGit.js';
import type { CommitTrees, TreePlace, TreeReach } from '../contract/service/commitTrees.js';

const TREE = 'tree';
const INDEX = 'index';
const TAKEN = 'taken-index';
const CHECKOUT = 'checkout';
const LINKS = 'links';
const EXCLUDE = 'exclude';
const SHAPE = 'shape';

type Standing = 'fresh' | 'legacy' | 'sparse' | 'full';

const failed = (op: string) => (cause: unknown) =>
  new OwnGitFailed({ op, message: cause instanceof Error ? cause.message : String(cause), ran: false });

const files = <A>(op: string, act: () => Promise<A>): Effect.Effect<A, OwnGitFailed> => Effect.tryPromise({ try: act, catch: failed(op) });

const named = (listed: string): readonly string[] => listed.split('\0').filter((entry) => entry !== '');

const missing =
  <A>(fallback: A) =>
  (cause: NodeJS.ErrnoException): A => {
    if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR' || cause.code === 'EISDIR') return fallback;
    throw cause;
  };

const absent = (path: string): Promise<boolean> => lstat(path).then(() => false, missing(true));

const ancestors = (paths: readonly string[]): ReadonlySet<string> => {
  const dirs = new Set<string>(['.']);
  for (const path of paths) {
    for (let dir = dirname(path); dir !== '.' && !dirs.has(dir); dir = dirname(dir)) dirs.add(dir);
  }
  return dirs;
};

const LINKING = 8;

const PATHS_AT_ONCE = 512;

const chunks = (paths: readonly string[]): readonly (readonly string[])[] =>
  Array.from({ length: Math.ceil(paths.length / PATHS_AT_ONCE) }, (_, at) => paths.slice(at * PATHS_AT_ONCE, (at + 1) * PATHS_AT_ONCE));

const childrenOf = async (root: string, dir: string): Promise<readonly string[]> => {
  const listed = await readdir(join(root, dir), { withFileTypes: true }).catch(missing([]));
  return listed
    .filter((entry) => !(dir === '.' && entry.name === '.git'))
    .map((entry) => {
      const path = dir === '.' ? entry.name : `${dir}/${entry.name}`;
      return entry.isDirectory() ? `${path}/` : path;
    });
};

const bare = (entry: string): string => entry.replace(/\/$/, '');

const covered = (dirs: ReadonlySet<string>, path: string): boolean => {
  for (let dir = dirname(path); dir !== '.'; dir = dirname(dir)) if (dirs.has(dir)) return true;
  return false;
};

const outermost = (entries: readonly string[]): readonly string[] => {
  const dirs = new Set(entries.filter((entry) => entry.endsWith('/')).map(bare));
  return entries.filter((entry) => !covered(dirs, bare(entry)));
};

const escaped = (path: string): string => path.replace(/[\\*?[]/g, '\\$&');

const literal = (path: string): string => `/${escaped(path).replace(/ +$/, (spaces) => spaces.replace(/ /g, '\\ '))}`;

const exactSpec = (path: string): string => `:(literal)${path}`;

const childrenSpec = (dir: string): string => `:(glob)${dir === '.' ? '' : `${escaped(dir)}/`}*`;

const standingOf = async (dir: string): Promise<Standing> => {
  if (await absent(join(dir, INDEX))) return 'fresh';
  const shape = await readFile(join(dir, SHAPE), 'utf8').catch(missing(null));
  return shape === 'sparse' || shape === 'full' ? shape : 'legacy';
};

const presentIn = async (work: string, dir = '.'): Promise<readonly string[]> => {
  const listed = await readdir(dir === '.' ? work : join(work, dir), { withFileTypes: true }).catch(missing([]));
  const found = await Promise.all(
    listed.map((entry) => {
      const path = dir === '.' ? entry.name : `${dir}/${entry.name}`;
      return entry.isDirectory() ? presentIn(work, path) : [path];
    }),
  );
  return found.flat();
};

const quoted = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;

const fitting = async (tree: string, path: string): Promise<boolean> => {
  for (let dir = dirname(path); dir !== '.'; dir = dirname(dir)) {
    const standing = await lstat(join(tree, dir)).catch(missing(null));
    if (standing !== null && !standing.isDirectory()) return false;
  }
  return true;
};

const MODULES = 'node_modules';

const isScope = (name: string): boolean => name.startsWith('@') || name === '.bin';

type Child =
  | { readonly kind: 'plain'; readonly name: string; readonly directory: boolean }
  | { readonly kind: 'workspace'; readonly name: string; readonly target: string; readonly directory: boolean }
  | { readonly kind: 'scope'; readonly name: string; readonly scan: Scan };

type Scan = { readonly holds: boolean; readonly children: readonly Child[] };

const workspaceTarget = (root: string, inside: string, dir: string, text: string): string | null => {
  const found = relative(root, resolve(root, dir, text));
  if (found === '' || isAbsolute(found) || found === '..' || found.startsWith(`..${sep}`)) return null;
  const path = found.split(sep).join('/');
  return path === inside || path.startsWith(`${inside}/`) ? null : path;
};

const scanned = async (root: string, inside: string, dir: string, depth: number): Promise<Scan> => {
  const listed = await readdir(join(root, dir), { withFileTypes: true }).catch(missing([]));
  const children = await Promise.all(
    listed.map(async (entry): Promise<Child> => {
      const path = `${dir}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        const target = workspaceTarget(root, inside, dir, await readlink(join(root, path)));
        if (target === null) return { kind: 'plain', name: entry.name, directory: false };
        const standing = await stat(join(root, target)).catch(missing(null));
        return { kind: 'workspace', name: entry.name, target, directory: standing?.isDirectory() ?? true };
      }
      if (depth === 0 && entry.isDirectory() && isScope(entry.name)) {
        const scan = await scanned(root, inside, path, 1);
        if (scan.holds) return { kind: 'scope', name: entry.name, scan };
      }
      return { kind: 'plain', name: entry.name, directory: entry.isDirectory() };
    }),
  );
  return { holds: children.some((child) => child.kind !== 'plain'), children };
};

const placeLink = async (target: string, link: string, directory: boolean): Promise<void> => {
  if (directory) {
    await symlink(target, link, 'junction');
    return;
  }
  const made = await symlink(target, link, 'file').then(
    () => true,
    (cause: NodeJS.ErrnoException) => {
      if (cause.code !== 'EPERM' && cause.code !== 'EACCES') throw cause;
      return false;
    },
  );
  if (!made) await cp(target, link, { force: true, verbatimSymlinks: true });
};

const populated = async (root: string, tree: string, dir: string, scan: Scan): Promise<void> => {
  const made = join(tree, dir);
  await mkdir(made, { recursive: true });
  await Promise.all(
    scan.children.map((child) => {
      const path = `${dir}/${child.name}`;
      if (child.kind === 'scope') return populated(root, tree, path, child.scan);
      if (child.kind === 'workspace') return placeLink(join(tree, child.target), join(made, child.name), child.directory);
      return placeLink(join(root, path), join(made, child.name), child.directory);
    }),
  );
};

const linked = async (root: string, tree: string, entry: string, whole: boolean): Promise<void> => {
  const directory = entry.endsWith('/');
  const path = bare(entry);
  const link = join(tree, path);
  await rm(link, { recursive: true, force: true });
  await mkdir(dirname(link), { recursive: true });
  const scan = directory && whole && basename(path) === MODULES ? await scanned(root, path, path, 0) : null;
  if (scan?.holds === true) await populated(root, tree, path, scan);
  else await placeLink(join(root, path), link, directory);
};

const unlinked = async (dir: string, work: string): Promise<void> => {
  const listed = await readFile(join(dir, LINKS), 'utf8').catch(missing(''));
  const paths = named(listed);
  const links = new Set(paths);
  await Promise.all(paths.filter((path) => !covered(links, path)).map((path) => rm(join(work, path), { recursive: true, force: true })));
};

export const keyOf = (root: string): string => createHash('sha256').update(resolve(root)).digest('hex').slice(0, 24);

type Trees = CommitTrees['Service'];

export type GitCommitTrees = Effect.Success<ReturnType<typeof makeGitCommitTrees>>;

export const makeGitCommitTrees = Effect.fnUntraced(function* ({ base }: { readonly base: string }) {
  const hooks = yield* lane({
    name: 'git-hooks',
    owner: 'workspace',
    rank: 280,
    threshold: '1 minute',
    ceilings: {
      step: CEILINGS.callCap,
      wait: CEILINGS.callCap,
      leaves: "the commit stays unpublished; its hooks ran in the checkout's commit tree, never in the checkout",
    },
    external: { named: "the checkout's commit hooks", callsBack: true },
  });

  const drop = (root: string): Effect.Effect<void, OwnGitFailed | HoldStalled | HoldCut> =>
    hooks
      .enter(
        resolve(root),
        files('commit-tree-drop', () => rm(join(base, keyOf(root)), { recursive: true, force: true })),
      )
      .pipe(Effect.catchTag('ReentrantCall', (failure) => Effect.die(failure)));

  const within = <A, E, R>(
    git: Git['Service'],
    root: string,
    gitDir: string,
    tree: string,
    reach: TreeReach,
    use: (place: TreePlace) => Effect.Effect<A, E, R>,
  ) => {
    return entered(
      root,
      Effect.gen(function* () {
        const place = yield* placed(git, root, gitDir, tree, reach);
        return yield* use(place);
      }),
    );
  };

  const standing = <A, E, R>(root: string, gitDir: string, use: (place: TreePlace) => Effect.Effect<A, E, R>) =>
    entered(
      root,
      Effect.suspend(() => use(placeOf(root, gitDir))),
    );

  const staged = (git: Git['Service'], place: TreePlace): Effect.Effect<string, OwnGitFailed> =>
    runGit(git, 'commit-tree-staged', ['-C', place.dir, 'write-tree'], { env: { ...place.env } });

  const unstaged = (git: Git['Service'], place: TreePlace): Effect.Effect<readonly string[], OwnGitFailed> =>
    Effect.andThen(
      runGit(git, 'commit-tree-refresh', ['-C', place.dir, 'update-index', '-q', '--refresh'], { env: { ...place.env } }),
      Effect.zipWith(
        runGit(git, 'commit-tree-unstaged', ['-C', place.dir, 'diff-files', '--name-only', '--no-renames', '-z'], {
          env: { ...place.env },
        }),
        runGit(git, 'commit-tree-untracked', ['-C', place.dir, 'ls-files', '--others', '--exclude-standard', '-z'], {
          env: { ...place.env },
        }),
        (changed, made) => [...named(changed), ...named(made)],
      ),
    );

  const taken = Effect.fn('CommitTrees.taken')(function* (
    git: Git['Service'],
    place: TreePlace,
    paths: readonly string[],
  ): Effect.fn.Return<string, OwnGitFailed> {
    const index = join(dirname(place.dir), TAKEN);
    const env = { ...place.env, GIT_INDEX_FILE: index };
    yield* files('commit-tree-taken', () => cp(place.env.GIT_INDEX_FILE ?? join(dirname(place.dir), INDEX), index));
    yield* runGit(git, 'commit-tree-take', ['-C', place.dir, 'update-index', '--add', '--remove', '-z', '--stdin'], {
      env,
      cleans: true,
      stdin: paths.map((path) => `${path}\0`).join(''),
    });
    return yield* runGit(git, 'commit-tree-taken', ['-C', place.dir, 'write-tree'], { env });
  });

  const worked = Effect.fn('CommitTrees.worked')(function* (
    git: Git['Service'],
    place: TreePlace,
    built: string,
  ): Effect.fn.Return<string, OwnGitFailed> {
    const index = join(dirname(place.dir), TAKEN);
    const env = { ...place.env, GIT_INDEX_FILE: index };
    yield* files('commit-tree-worked', () => rm(`${index}.lock`, { force: true }));
    yield* runGit(git, 'commit-tree-worked', ['-C', place.dir, 'read-tree', built], { env });
    yield* runGit(git, 'commit-tree-worked', ['-C', place.dir, 'add', '-A'], { env, cleans: true });
    return yield* runGit(git, 'commit-tree-worked', ['-C', place.dir, 'write-tree'], { env });
  });

  const sweep: Effect.Effect<readonly string[], OwnGitFailed> = Effect.gen(function* () {
    const kept = yield* files('commit-tree-sweep', () => readdir(base).catch(missing([])));
    const swept: string[] = [];
    for (const key of kept) {
      const dir = join(base, key);
      const gone = yield* files('commit-tree-sweep', async () => {
        const root = await readFile(join(dir, CHECKOUT), 'utf8').catch(missing(null));
        if (root !== null && !(await absent(join(root, '.git')))) return false;
        await rm(dir, { recursive: true, force: true });
        return true;
      });
      if (gone) swept.push(key);
    }
    return swept;
  });

  function entered<A, E, R>(root: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E | HoldStalled | HoldCut, R> {
    return Effect.flatMap(Effect.context<R>(), (context) =>
      hooks.enter(resolve(root), Effect.provide(work, context)).pipe(Effect.catchTag('ReentrantCall', (failure) => Effect.die(failure))),
    );
  }

  function placeOf(root: string, gitDir: string): TreePlace {
    const dir = join(base, keyOf(root));
    return {
      dir: join(dir, TREE),
      env: {
        GIT_DIR: gitDir,
        GIT_WORK_TREE: join(dir, TREE),
        GIT_INDEX_FILE: join(dir, INDEX),
        GIT_CONFIG_PARAMETERS: [process.env.GIT_CONFIG_PARAMETERS, quoted(`core.excludesfile=${join(dir, EXCLUDE)}`)]
          .filter((one) => one !== undefined && one !== '')
          .join(' '),
      },
    };
  }

  function placed(
    git: Git['Service'],
    root: string,
    gitDir: string,
    tree: string,
    reach: TreeReach,
  ): Effect.Effect<TreePlace, OwnGitFailed> {
    const dir = join(base, keyOf(root));
    return Effect.gen(function* () {
      const place = placeOf(root, gitDir);
      const work = place.dir;
      const was = yield* files('commit-tree-make', async () => {
        await mkdir(work, { recursive: true, mode: 0o700 });
        await writeFile(join(dir, CHECKOUT), resolve(root));
        await Promise.all([INDEX, TAKEN].map((index) => rm(join(dir, `${index}.lock`), { force: true })));
        await unlinked(dir, work);
        return standingOf(dir);
      });
      const unfolded = reach._tag !== 'nearby' || was === 'full';
      if (unfolded) yield* whole(git, dir, place, tree, was);
      else yield* sparse(git, dir, place, tree, [...reach.paths, ...reach.uses], was);
      const ignored = yield* ignoredOf(git, root, reach);
      const tracked = yield* trackedOf(git, place, ignored.map(bare));
      const fit = yield* files('commit-tree-fit', () => Promise.all(ignored.map((entry) => fitting(work, bare(entry)))));
      const entries = outermost(ignored.filter((entry, at) => fit[at] === true && !tracked(bare(entry)) && !bare(entry).includes('\n')));
      const excludes = yield* userExcludes(git, root);
      yield* files('commit-tree-exclude', async () => {
        await writeFile(join(dir, LINKS), entries.map((entry) => `${bare(entry)}\0`).join(''));
        await writeFile(join(dir, EXCLUDE), `${excludes}\n${entries.map((entry) => literal(bare(entry))).join('\n')}\n`);
      });
      yield* Effect.forEach(entries, (entry) => files('commit-tree-link', () => linked(root, work, entry, unfolded)), {
        concurrency: LINKING,
        discard: true,
      });
      return place;
    });
  }

  return { drop, within, standing, staged, unstaged, taken, worked, sweep };
});

const trackedOf = (
  git: Git['Service'],
  place: TreePlace,
  paths: readonly string[],
): Effect.Effect<(path: string) => boolean, OwnGitFailed> =>
  Effect.map(
    Effect.forEach(chunks(paths), (chunk) =>
      runGit(git, 'commit-tree-tracked', ['-C', place.dir, 'ls-files', '-z', '--', ...chunk], {
        env: { ...place.env, GIT_LITERAL_PATHSPECS: '1' },
      }),
    ),
    (listed) => {
      const found = listed.flatMap(named);
      const exact = new Set(found);
      const under = new Set(found.flatMap((path) => [...ancestors([path])]));
      return (path: string) => exact.has(path) || under.has(path);
    },
  );

const reset = (git: Git['Service'], place: TreePlace, tree: string): Effect.Effect<void, OwnGitFailed> =>
  Effect.andThen(
    runGit(git, 'commit-tree-read', ['-C', place.dir, 'read-tree', '--reset', '-u', tree], { env: place.env }),
    runGit(git, 'commit-tree-clean', ['-C', place.dir, 'clean', '-fdq'], { env: place.env }),
  );

const whole = Effect.fn('CommitTrees.whole')(function* (
  git: Git['Service'],
  dir: string,
  place: TreePlace,
  tree: string,
  was: Standing,
): Effect.fn.Return<void, OwnGitFailed> {
  if (was !== 'full') {
    yield* files('commit-tree-whole', async () => {
      if (was === 'sparse') await rm(join(dir, INDEX), { force: true });
      await writeFile(join(dir, SHAPE), 'full');
    });
  }
  yield* reset(git, place, tree);
});

const sparse = Effect.fn('CommitTrees.sparse')(function* (
  git: Git['Service'],
  dir: string,
  place: TreePlace,
  tree: string,
  paths: readonly string[],
  was: Standing,
): Effect.fn.Return<void, OwnGitFailed> {
  if (was === 'sparse') yield* reset(git, place, tree);
  else {
    yield* files('commit-tree-sparse', async () => {
      await writeFile(join(dir, SHAPE), 'sparse');
      await rm(join(dir, INDEX), { force: true });
      await rm(place.dir, { recursive: true, force: true });
      await mkdir(place.dir, { recursive: true, mode: 0o700 });
    });
    yield* runGit(git, 'commit-tree-read', ['-C', place.dir, 'read-tree', '--reset', tree], { env: place.env });
    const listed = yield* runGit(git, 'commit-tree-listed', ['-C', place.dir, 'ls-files', '-z'], { env: place.env });
    yield* runGit(git, 'commit-tree-skip', ['-C', place.dir, 'update-index', '-z', '--skip-worktree', '--stdin'], {
      env: place.env,
      stdin: listed,
    });
  }
  yield* materialized(git, place, paths);
});

const materialized = Effect.fn('CommitTrees.materialized')(function* (
  git: Git['Service'],
  place: TreePlace,
  paths: readonly string[],
): Effect.fn.Return<void, OwnGitFailed> {
  const dirs = ancestors(paths);
  const reached = new Set(paths);
  const present = yield* files('commit-tree-present', () => presentIn(place.dir));
  const specs = [...new Set([...paths.map(exactSpec), ...[...dirs].map(childrenSpec), ...present.map(exactSpec)])];
  const listed = yield* Effect.forEach(chunks(specs), (chunk) =>
    runGit(git, 'commit-tree-materialized', ['-C', place.dir, 'ls-files', '-t', '-s', '-z', '--', ...chunk], { env: place.env }),
  );
  const standing = new Set(present);
  const wanted = new Set<string>();
  const strays = new Set<string>();
  for (const entry of listed.flatMap(named)) {
    if (!entry.startsWith('S ') || entry.startsWith('S 160000 ')) continue;
    const path = entry.slice(entry.indexOf('\t') + 1);
    if (reached.has(path) || dirs.has(dirname(path))) wanted.add(path);
    else if (standing.has(path)) strays.add(path);
  }
  if (strays.size > 0) {
    yield* files('commit-tree-strays', () => Promise.all([...strays].map((path) => rm(join(place.dir, path), { force: true }))));
  }
  if (wanted.size === 0) return;
  const stdin = [...wanted].map((path) => `${path}\0`).join('');
  yield* runGit(git, 'commit-tree-unskip', ['-C', place.dir, 'update-index', '-z', '--no-skip-worktree', '--stdin'], {
    env: place.env,
    stdin,
  });
  yield* runGit(git, 'commit-tree-checkout', ['-C', place.dir, 'checkout-index', '-f', '-u', '-z', '--stdin'], { env: place.env, stdin });
});

const userExcludes = (git: Git['Service'], root: string): Effect.Effect<string, OwnGitFailed> =>
  Effect.flatMap(excludesFileAt(configuredGit(git, 'commit-tree-excludes'), root), (path) =>
    path === null ? Effect.succeed('') : files('commit-tree-excludes', () => readFile(path, 'utf8').catch(missing(''))),
  );

const ignoredOf = Effect.fn('CommitTrees.ignoredOf')(function* (
  git: Git['Service'],
  root: string,
  reach: TreeReach,
): Effect.fn.Return<readonly string[], OwnGitFailed> {
  if (reach._tag === 'all') {
    return yield* Effect.map(
      runGit(git, 'commit-tree-ignored', ['-C', root, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']),
      named,
    );
  }
  const listed = yield* files('commit-tree-along', () => Promise.all([...ancestors(reach.paths)].map((dir) => childrenOf(root, dir))));
  const candidates = listed.flat();
  if (candidates.length === 0) return [];
  const ignored = yield* quietGit(git, 'commit-tree-along', ['-C', root, 'check-ignore', '-z', '--stdin'], {
    stdin: candidates.map((path) => `${path}\0`).join(''),
  });
  return ignored === null ? [] : named(ignored);
});
