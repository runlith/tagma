import { Data, Effect } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { spawnGit } from './Git.js';

export class CloneFailed extends Data.TaggedError('CloneFailed')<{ readonly url: string; readonly reason: string }> {
  override get message(): string {
    return `git could not clone ${this.url}: ${this.reason}`;
  }
}

export class CommitUnreachable extends Data.TaggedError('CommitUnreachable')<{
  readonly url: string;
  readonly commit: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.url} serves no commit ${this.commit}: ${this.reason}`;
  }
}

export type Shallow = { readonly url: string; readonly into: string; readonly ref?: string; readonly commit?: string };

const REMOTE = /^(?:https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[\w.-]+@[\w.-]+:)/u;

export const isGitUrl = (text: string): boolean => REMOTE.test(text);

const QUIET = { GIT_TERMINAL_PROMPT: '0' };

const said = (stderr: string, status: number) => stderr.trim().split('\n').at(-1) || `git ended ${status}`;

export const shallowClone = Effect.fn('Git.clone')(function* (
  shallow: Shallow,
): Effect.fn.Return<{ readonly commit: string }, CloneFailed | CommitUnreachable, ChildProcessSpawner.ChildProcessSpawner> {
  const { url, into, ref, commit } = shallow;
  const git = (args: readonly string[], cwd?: string) =>
    spawnGit(args, { cwd, env: QUIET, extendEnv: true, capture: 4_000 }).pipe(
      Effect.mapError((failure) => new CloneFailed({ url, reason: failure.message })),
    );
  if (commit === undefined) {
    const cloned = yield* git([
      'clone',
      '--quiet',
      '--depth',
      '1',
      '--no-tags',
      ...(ref === undefined ? [] : ['--branch', ref]),
      '--',
      url,
      into,
    ]);
    if (cloned.status !== 0) return yield* new CloneFailed({ url, reason: said(cloned.stderr, cloned.status) });
  } else {
    const made = yield* git(['init', '--quiet', into]);
    if (made.status !== 0) return yield* new CloneFailed({ url, reason: said(made.stderr, made.status) });
    const fetched = yield* git(['fetch', '--quiet', '--depth', '1', '--no-tags', '--', url, commit], into);
    if (fetched.status !== 0) return yield* new CommitUnreachable({ url, commit, reason: said(fetched.stderr, fetched.status) });
    const checked = yield* git(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], into);
    if (checked.status !== 0) return yield* new CloneFailed({ url, reason: said(checked.stderr, checked.status) });
  }
  const head = yield* git(['rev-parse', 'HEAD'], into);
  if (head.status !== 0) return yield* new CloneFailed({ url, reason: said(head.stderr, head.status) });
  return { commit: head.stdout.trim() };
});
