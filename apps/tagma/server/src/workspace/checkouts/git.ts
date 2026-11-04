import { Effect, FileSystem, Layer } from 'effect';
import type { Stats } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Git } from '@runlith/git/Git';
import type { GitAnswerInvalid, GitRefused, GitUnreadable } from '@runlith/git/repository';
import { worktreesOf } from '@runlith/git/worktree';
import { gitText } from '../../platform/git/readings.js';
import { ProjectIdentification } from '../../projects/contract/service/registry.js';
import type { ProjectIdentity } from '../../projects/contract/wire/project.js';
import { folderIdentity, heldKey, mainWorktree, projectIdentificationLayer } from '../../projects/identity.js';
import { CallerCheckout, type CallerCheckoutState, type GitCheckout } from '../contract/service/checkouts.js';

export type GitWorktree = {
  readonly path: string;
  readonly branch: string | null;
};

export type RegisteredCheckout = GitWorktree & { readonly prunable: string | null };

export const checkoutAt = Effect.fn('Repo.checkoutAt')(function* (git: Git['Service'], cwd: string) {
  const caller = yield* CallerCheckout;
  return caller?.cwd === cwd ? yield* caller.repo : yield* locateCheckout(git, cwd);
});

export const readCallerCheckout = Effect.fn('Repo.readCallerCheckout')(function* (
  cwd: string,
): Effect.fn.Return<CallerCheckoutState, never, Git> {
  return { cwd, repo: yield* Effect.cached(locateCheckout(yield* Git, cwd)) };
});

export function standsAside(here: GitCheckout | null, repoKey: string, rootPath: string): boolean {
  return here !== null && here.key === repoKey && here.toplevel !== rootPath;
}

const LISTINGS_KEPT = 256;

const listings = new Map<string, { readonly stamp: string; readonly worktrees: RegisteredCheckout[] }>();

const absent = (cause: unknown): boolean => {
  const code = (cause as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

const statOrAbsent = async (path: string) => {
  try {
    return await stat(path);
  } catch (cause) {
    if (absent(cause)) return null;
    throw cause;
  }
};

const textOrAbsent = async (path: string) => {
  try {
    return await readFile(path, 'utf8');
  } catch (cause) {
    if (absent(cause)) return null;
    throw cause;
  }
};

const fileStamp = (info: Stats | null): string => (info === null ? '-' : `${info.ino}:${info.mtimeMs}:${info.size}`);

//! Everything `git worktree list` reads for paths, branches and prunability; another stamp means another answer.
const metadataStamp = async (rootPath: string): Promise<string | null> => {
  const common = join(rootPath, '.git');
  const top = await statOrAbsent(common);
  if (top === null || !top.isDirectory()) return null;
  const parts = [
    `${top.ino}`,
    fileStamp(await statOrAbsent(join(common, 'HEAD'))),
    fileStamp(await statOrAbsent(join(common, 'config'))),
    fileStamp(await statOrAbsent(join(common, 'reftable', 'tables.list'))),
  ];
  const linked = join(common, 'worktrees');
  const directory = await statOrAbsent(linked);
  if (directory === null) return parts.join('|');
  parts.push(fileStamp(directory));
  for (const id of (await readdir(linked)).sort()) {
    const entry = join(linked, id);
    const [gitdir, head, refs, locked] = await Promise.all([
      textOrAbsent(join(entry, 'gitdir')),
      statOrAbsent(join(entry, 'HEAD')),
      statOrAbsent(join(entry, 'reftable', 'tables.list')),
      statOrAbsent(join(entry, 'locked')),
    ]);
    const target = gitdir === null ? null : resolve(entry, gitdir.trim());
    const stands = target === null ? null : await statOrAbsent(target);
    parts.push(
      `${id}:${gitdir ?? '-'}:${fileStamp(head)}:${fileStamp(refs)}:${locked === null ? '-' : 'locked'}:${stands === null ? '-' : 'stands'}`,
    );
  }
  return parts.join('|');
};

const listedNow = Effect.fnUntraced(function* (git: Git['Service'], rootPath: string) {
  const listed = yield* worktreesOf(git, rootPath).pipe(
    Effect.catch((failure) =>
      Effect.flatMap(locateCheckout(git, rootPath), (here) => (here === null ? Effect.succeed(null) : Effect.fail(failure))),
    ),
  );
  if (listed === null) return { listed: [{ path: rootPath, branch: null, prunable: null }], kept: false };
  const worktrees = listed.map((worktree) => ({
    path: worktree.path,
    branch: worktree.head?.ref?.replace(/^refs\/heads\//, '') ?? null,
    prunable: worktree.prunable,
  }));
  return { listed: worktrees, kept: true };
});

export const registeredCheckoutsOf = Effect.fn('Repo.registeredCheckoutsOf')(function* (
  git: Git['Service'],
  rootPath: string,
): Effect.fn.Return<RegisteredCheckout[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  const stamp = yield* Effect.promise(() =>
    metadataStamp(rootPath).then(
      (value) => value,
      () => null,
    ),
  );
  const known = listings.get(rootPath);
  if (stamp !== null && known !== undefined && known.stamp === stamp) return [...known.worktrees];
  const { listed, kept } = yield* listedNow(git, rootPath);
  if (stamp === null || !kept) {
    listings.delete(rootPath);
    return listed;
  }
  listings.delete(rootPath);
  listings.set(rootPath, { stamp, worktrees: listed });
  for (const oldest of listings.keys()) {
    if (listings.size <= LISTINGS_KEPT) break;
    listings.delete(oldest);
  }
  return [...listed];
});

export const checkoutsOf = Effect.fn('Repo.checkoutsOf')(function* (
  git: Git['Service'],
  rootPath: string,
): Effect.fn.Return<GitWorktree[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  return (yield* registeredCheckoutsOf(git, rootPath))
    .filter((checkout) => checkout.prunable === null)
    .map(({ path, branch }) => ({ path, branch }));
});

const locateCheckout = Effect.fn('Repo.locate')(function* (
  git: Git['Service'],
  dir: string,
): Effect.fn.Return<GitCheckout | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const place = yield* gitText(git, dir, [
    'rev-parse',
    '--show-prefix',
    '--path-format=absolute',
    '--show-toplevel',
    '--git-dir',
    '--git-common-dir',
  ]).pipe(Effect.catchTag('GitRefused', () => Effect.succeed(null)));
  if (place === null) return null;
  const [prefix = '', toplevel = '', own = '', gitDir = ''] = place.split('\n').map((line) => line.trim());
  if (toplevel === '' || own === '' || gitDir === '') return null;
  return {
    key: yield* heldKey(gitDir),
    path: prefix === '' ? '.' : prefix.replace(/\/+$/, ''),
    toplevel,
    gitDir,
    mainWorktree: yield* mainWorktree(git, { toplevel, gitDir: own, commonDir: gitDir }),
  };
});

export const checkoutIdentificationLayer: Layer.Layer<ProjectIdentification, never, Git | FileSystem.FileSystem> = Layer.effect(
  ProjectIdentification,
  Effect.gen(function* () {
    const base = yield* ProjectIdentification;
    const files = yield* FileSystem.FileSystem;
    return ProjectIdentification.of({
      identify: (path) =>
        Effect.flatMap(CallerCheckout, (caller): Effect.Effect<ProjectIdentity, GitUnreadable | GitRefused | GitAnswerInvalid> => {
          if (caller?.cwd !== path) return base.identify(path);
          return Effect.flatMap(caller.repo, (repo) =>
            repo === null
              ? folderIdentity(files, path)
              : Effect.succeed({ repoKey: repo.key, rootPath: repo.mainWorktree, gitDir: repo.gitDir }),
          );
        }),
    });
  }),
).pipe(Layer.provide(projectIdentificationLayer));
