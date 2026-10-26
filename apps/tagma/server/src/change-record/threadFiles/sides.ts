import { Effect, type FileSystem } from 'effect';
import { fileText } from '@runlith/files/content';
import { GitUnreadable, troubleOf, type GitAnswerInvalid } from '@runlith/git/repository';
import type { Git } from '@runlith/git/Git';
import { normalizedAt, workingTextsAt } from '@runlith/git/working';
import { configuredGit } from '../../platform/git/ownGit.js';
import { PathUnreadable } from '../../workspace/contract/service/checkouts.js';
import { PathRefused } from '../contract/service/authorship.js';
import { returns } from '../lines/ends.js';
import { READING_CAPTURE } from './failures.js';

export const headBlob = (git: Git['Service'], dir: string, path: string): Effect.Effect<string | null, GitUnreadable | GitAnswerInvalid> =>
  Effect.flatMap(workingTextsAt(configuredGit(git, 'thread-files-blob'), dir, 'HEAD', [path], { capture: READING_CAPTURE }), ([text]) =>
    Effect.fromResult(text!),
  );

const endsAt = (
  git: Git['Service'],
  dir: string,
  paths: readonly string[],
): Effect.Effect<ReadonlySet<string>, GitUnreadable | GitAnswerInvalid> =>
  normalizedAt(configuredGit(git, 'thread-files-ends'), dir, paths).pipe(
    Effect.catchTag('GitRefused', (failure) => Effect.fail(new GitUnreadable({ command: failure.command, reason: troubleOf(failure) }))),
  );

export const normalizedOne = (
  git: Git['Service'],
  dir: string,
  path: string,
  ...texts: readonly (string | null)[]
): Effect.Effect<boolean, GitUnreadable | GitAnswerInvalid> =>
  returns(...texts) ? Effect.map(endsAt(git, dir, [path]), (normalized) => normalized.has(path)) : Effect.succeed(false);

export const working = (
  files: FileSystem.FileSystem,
  dir: string,
  path: string,
): Effect.Effect<string | null, PathUnreadable | PathRefused> => {
  const at = `${dir}/${path}`;
  return Effect.gen(function* () {
    const link = yield* Effect.result(files.readLink(at));
    if (link._tag === 'Success') return link.success;
    if (link.failure.reason._tag === 'NotFound') return null;
    const stands = yield* Effect.result(files.stat(at));
    if (stands._tag === 'Failure') {
      if (stands.failure.reason._tag === 'NotFound') return null;
      return yield* new PathUnreadable({ path, cause: stands.failure, asking: 'probe' });
    }
    const bytes = Number(stands.success.size);
    if (bytes > READING_CAPTURE) return yield* new PathRefused({ path, bytes, reason: 'oversized' });
    const file = yield* Effect.result(fileText(files, at));
    if (file._tag === 'Success') return file.success;
    return yield* new PathUnreadable({ path, cause: file.failure, asking: 'read' });
  });
};

export const stagedBlob = (
  git: Git['Service'],
  dir: string,
  path: string,
): Effect.Effect<string | null, GitUnreadable | GitAnswerInvalid> =>
  Effect.flatMap(workingTextsAt(configuredGit(git, 'thread-files-staged'), dir, '', [path], { capture: READING_CAPTURE }), ([text]) =>
    Effect.fromResult(text!),
  );
