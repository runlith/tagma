import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { type GitAnswerInvalid, type GitRefused, type GitUnreadable, headAt, runEnded, troubleOf } from '@runlith/git/repository';
import { type Status, statusAt } from '@runlith/git/status';
import { GateRefusal, type GitRefusal } from '../contract/wire/refusal.js';
import { notAdmitted } from './ownGit.js';

export const gitRefusal = (failure: GitUnreadable | GitRefused | GitAnswerInvalid): GateRefusal<GitRefusal> => {
  if (failure._tag === 'GitUnreadable' && failure.admission !== undefined) return notAdmitted(failure.admission);
  return new GateRefusal<GitRefusal>(
    failure._tag === 'GitRefused' ? 'git-refused' : failure._tag === 'GitAnswerInvalid' ? 'git-incomplete' : 'git-unreadable',
    troubleOf(failure),
    ['read what git said above and run that command yourself to see why'],
  );
};

export const gitText = Effect.fn('Git.text')(function* (
  git: Git['Service'],
  cwd: string,
  args: readonly string[],
): Effect.fn.Return<string | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const ended = yield* runEnded(git, cwd, args, undefined, [1]);
  return ended.status === 0 ? ended.stdout : null;
});

export const gitLines = Effect.fn('Git.lines')(function* (
  git: Git['Service'],
  cwd: string,
  args: readonly string[],
): Effect.fn.Return<string[] | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const output = yield* gitText(git, cwd, args);
  return output === null ? null : output.split('\n').filter((line) => line.length > 0);
});

export const gitPaths = Effect.fn('Git.paths')(function* (
  git: Git['Service'],
  cwd: string,
  args: readonly string[],
): Effect.fn.Return<string[] | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const output = yield* gitText(git, cwd, args);
  return output === null ? null : output.split('\0').filter((path) => path.length > 0);
});

export type TreeReading = { readonly changed: number; readonly fingerprint: string | null };

const FINGERPRINT_LENGTH = 12;

export const changedIn = (status: Status): number => {
  const { staged, unstaged, unmerged, untracked } = status.entries;
  return new Set([...staged, ...unstaged, ...unmerged].map((entry) => entry.path)).size + untracked.length;
};

export const treeFingerprint = Effect.fn('Git.fingerprint')(function* (
  git: Git['Service'],
  cwd: string,
  status: Status,
): Effect.fn.Return<string | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const [diff, top] = yield* Effect.all(
    [
      gitText(git, cwd, ['diff', 'HEAD', '--binary', '--no-color', '--no-ext-diff', '--no-renames']),
      gitText(git, cwd, ['rev-parse', '--show-toplevel']),
    ],
    { concurrency: 'unbounded' },
  );
  if (diff === null || top === null) return null;
  const root = top.trim();
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(diff);
  for (const path of status.entries.untracked.map((entry) => entry.path).sort()) {
    const stat = yield* statOrNull(join(root, path));
    hasher.update(`\0${path}\0${stat === null ? '-' : `${stat.size}:${stat.mtimeMs}`}`);
  }
  return hasher.digest('hex').slice(0, FINGERPRINT_LENGTH);
});

export const gitTree = Effect.fn('Git.tree')(function* (
  git: Git['Service'],
  cwd: string,
): Effect.fn.Return<TreeReading, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const status = yield* statusAt(git, cwd, { untracked: 'all' });
  const changed = changedIn(status);
  if (changed === 0) return { changed, fingerprint: null };
  return { changed, fingerprint: yield* treeFingerprint(git, cwd, status) };
});

const statOrNull = (path: string): Effect.Effect<{ size: number; mtimeMs: number } | null> =>
  Effect.promise(() => stat(path).catch(() => null));

export const gitCut = Effect.fn('Git.cut')(function* (
  git: Git['Service'],
  cwd: string,
): Effect.fn.Return<{ head: string; dirty: boolean } | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const named = yield* gitText(git, cwd, ['rev-parse', '--verify', '--quiet', '--short', 'HEAD']);
  const head = named === null ? '' : named.trim();
  if (head === '') return null;
  const status = yield* statusAt(git, cwd, { untracked: 'no' });
  const { staged, unstaged, unmerged } = status.entries;
  return { head, dirty: staged.length + unstaged.length + unmerged.length > 0 };
});

const NOT_A_REPOSITORY = /^fatal: not a git repository/m;

export const headNamed = Effect.fn('Git.headNamed')(function* (
  git: Git['Service'],
  cwd: string,
): Effect.fn.Return<string | null, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const read = yield* Effect.result(headAt(git, cwd));
  if (read._tag === 'Success') return read.success.ref ?? read.success.commit;
  if (read.failure._tag === 'GitRefused' && NOT_A_REPOSITORY.test(read.failure.message)) return null;
  return yield* read.failure;
});
