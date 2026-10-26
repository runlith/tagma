import { Effect, FileSystem, Layer } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
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

export const keyHolds = Effect.fn('ProjectIdentification.keyHolds')(function* (
  registered: { readonly repoKey: string; readonly rootPath: string },
  identity: ProjectIdentity,
) {
  if (identity.repoKey !== registered.repoKey) return false;
  if (identity.rootPath === registered.rootPath || identity.gitDir === null) return true;
  const there = yield* markIn(join(registered.rootPath, '.git'));
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
  const place = yield* gitText(git, path, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir']).pipe(
    Effect.catchTag('GitRefused', () => Effect.succeed(null)),
  );
  const [toplevel, gitDir] = (place ?? '').split('\n').map((line) => line.trim());
  if (toplevel && gitDir) return { repoKey: yield* heldKey(gitDir), rootPath: dirname(gitDir), gitDir };
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
