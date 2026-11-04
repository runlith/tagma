import { Effect, FileSystem, Layer } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Git } from '@runlith/git/Git';
import { type GitAnswerInvalid, type GitRefused, GitUnreadable } from '@runlith/git/repository';
import { gitRefusal, gitText } from '../platform/git/readings.js';
import { GateRefusal, type GitRefusal } from '../platform/contract/wire/refusal.js';
import { ProjectIdentification } from './contract/service/registry.js';
import type { ProjectIdentity, ProjectPlace } from './contract/wire/project.js';
import { PROJECT_WORDS } from './contract/wire/words.js';

export const physical = (files: FileSystem.FileSystem, path: string): Effect.Effect<string, PlatformError> =>
  files
    .realPath(path)
    .pipe(
      Effect.catchReason('PlatformError', 'NotFound', () =>
        dirname(path) === path
          ? Effect.succeed(path)
          : Effect.map(physical(files, dirname(path)), (parent) => join(parent, basename(path))),
      ),
    );

export type Mark = { readonly key: string; readonly gitDir: string };

const markPath = (gitDir: string): string => join(gitDir, 'tagma', 'project');

const absent = (cause: unknown): boolean => {
  const code = (cause as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

export const markIn = (gitDir: string): Effect.Effect<Mark | null, GitUnreadable> =>
  Effect.tryPromise({
    try: () =>
      readFile(markPath(gitDir), 'utf8').then(
        (text) => {
          const [key = '', at = ''] = text.split('\n');
          return key === '' || at === '' ? null : { key, gitDir: at };
        },
        (cause: unknown) => {
          if (absent(cause)) return null;
          throw cause;
        },
      ),
    catch: (cause) => new GitUnreadable({ command: ['read', markPath(gitDir)], reason: String(cause) }),
  });

export const heldKey = Effect.fn('ProjectIdentification.heldKey')(function* (gitDir: string) {
  const mark = yield* markIn(gitDir);
  if (mark === null || mark.gitDir === gitDir) return mark?.key ?? null;
  return (yield* markIn(mark.gitDir))?.key === mark.key ? null : mark.key;
});

const GITDIR = 'gitdir: ';

const textOr = (path: string, missing: string): Promise<string> =>
  readFile(path, 'utf8').then(
    (text) => text,
    (cause: unknown) => (absent(cause) ? missing : Promise.reject(cause)),
  );

export const commonDirAt = (root: string): Effect.Effect<string, GitUnreadable> =>
  Effect.tryPromise({
    try: async () => {
      const marker = join(root, '.git');
      const directory = await stat(marker).then(
        (info) => info.isDirectory(),
        (cause: unknown) => (absent(cause) ? true : Promise.reject(cause)),
      );
      if (directory) return marker;
      const named = (await textOr(marker, '')).split('\n', 1)[0]?.trim() ?? '';
      if (!named.startsWith(GITDIR)) return marker;
      const at = resolve(root, named.slice(GITDIR.length).trim());
      const common = (await textOr(join(at, 'commondir'), '')).trim();
      return common === '' ? at : resolve(at, common);
    },
    catch: (cause) => new GitUnreadable({ command: ['read', join(root, '.git')], reason: String(cause) }),
  });

type GitPlace = { readonly toplevel: string; readonly gitDir: string; readonly commonDir: string };

export const mainWorktree = Effect.fn('ProjectIdentification.mainWorktree')(function* (git: Git['Service'], place: GitPlace) {
  if (place.gitDir === place.commonDir) return place.toplevel;
  if (basename(place.commonDir) === '.git') return dirname(place.commonDir);
  const configured = (yield* gitText(git, place.toplevel, [
    'config',
    '--file',
    join(place.commonDir, 'config'),
    '--get',
    'core.worktree',
  ]))?.trim();
  return configured ? resolve(place.commonDir, configured) : dirname(place.commonDir);
});

export const keyHolds = Effect.fn('ProjectIdentification.keyHolds')(function* (
  registered: { readonly repoKey: string; readonly rootPath: string },
  identity: ProjectIdentity,
) {
  if (identity.repoKey !== registered.repoKey) return false;
  if (identity.rootPath === registered.rootPath || identity.gitDir === null) return true;
  const there = yield* markIn(yield* commonDirAt(registered.rootPath));
  return there?.key !== registered.repoKey || there.gitDir === identity.gitDir;
});

export const marked = (gitDir: string, key: string): Effect.Effect<void, GateRefusal<'unwritable-root'>> =>
  Effect.tryPromise({
    try: async () => {
      const path = markPath(gitDir);
      await mkdir(dirname(path), { recursive: true });
      const staged = `${path}.${process.pid}.next`;
      await writeFile(staged, `${key}\n${gitDir}\n`);
      await rename(staged, path);
    },
    catch: (cause) =>
      new GateRefusal('unwritable-root', `the project's mark cannot be written into ${gitDir}: ${String(cause)}`, [
        `make ${gitDir} writable: Tagma keeps the project's mark there`,
      ]).saying(PROJECT_WORDS.folderUnwritable),
  });

const identityAt = Effect.fn('ProjectIdentification.identify')(function* (
  git: Git['Service'],
  files: FileSystem.FileSystem,
  path: string,
): Effect.fn.Return<ProjectIdentity, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const place = yield* gitText(git, path, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir']).pipe(
    Effect.catchTag('GitRefused', () => Effect.succeed(null)),
  );
  const [toplevel, own, gitDir] = (place ?? '').split('\n').map((line) => line.trim());
  if (toplevel && own && gitDir) {
    const rootPath = yield* mainWorktree(git, { toplevel, gitDir: own, commonDir: gitDir });
    return { repoKey: yield* heldKey(gitDir), rootPath, gitDir };
  }
  return yield* folderIdentity(files, path);
});

export const folderIdentity = (files: FileSystem.FileSystem, path: string): Effect.Effect<ProjectIdentity> =>
  physical(files, path).pipe(
    Effect.catchTag('PlatformError', (failure) =>
      Effect.as(
        Effect.logWarning('a project place keeps the spelling it was named by: its physical path could not be read', {
          path,
          reason: failure.message,
        }),
        path,
      ),
    ),
    Effect.map((root) => ({ repoKey: root, rootPath: root, gitDir: null })),
  );

export const placeAt = (
  cwd: string | undefined,
): Effect.Effect<ProjectPlace | undefined, GateRefusal<GitRefusal>, ProjectIdentification> =>
  cwd === undefined || cwd === ''
    ? Effect.succeed(undefined)
    : Effect.flatMap(ProjectIdentification, (identification) => identification.identify(cwd)).pipe(
        Effect.map((identity) => ({ cwd, identity })),
        Effect.mapError(gitRefusal),
      );

export const projectIdentificationLayer: Layer.Layer<ProjectIdentification, never, Git | FileSystem.FileSystem> = Layer.effect(
  ProjectIdentification,
  Effect.gen(function* () {
    const git = yield* Git;
    const files = yield* FileSystem.FileSystem;
    return ProjectIdentification.of({
      identify: (path: string) => identityAt(git, files, path),
    });
  }),
);
