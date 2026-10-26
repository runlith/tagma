import { Effect } from 'effect';
import type { Git } from './Git.js';
import {
  run,
  runEnded,
  commandFor,
  commitOf,
  type GitAnswerInvalid,
  type GitRefused,
  GitUnreadable,
  OFFLINE_PROMPTS,
  saidNo,
} from './repository.js';
import { mergeTreeAt } from './merge.js';
import type { SequencerKind } from './vocabulary.js';

export type Abortable = Exclude<SequencerKind, 'none'>;

export type PushTarget = {
  readonly remote: string;
  readonly branch?: string;
  readonly as?: string;
};

export type PushOptions = {
  readonly target?: PushTarget;
  readonly setUpstream?: boolean;
  readonly absent?: boolean;
  readonly capture?: number;
};

const UPDATED = /^([^\t=])\t([^\t]*):([^\t]+)\t/;

export const abortAt = Effect.fn('Git.abort')(function* (
  git: Git['Service'],
  dir: string,
  operation: Abortable,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<void, GitUnreadable | GitRefused | GitAnswerInvalid> {
  yield* run(git, dir, [operation, '--abort'], options.capture);
});

export type PullMerge = {
  readonly tree: string;
  readonly upstream: string;
  readonly message: string;
};

export type Pulled = {
  readonly head: string | null;
  readonly moved: boolean;
  readonly conflicts: readonly string[];
  readonly merge: PullMerge | null;
};

type Failed = GitUnreadable | GitRefused | GitAnswerInvalid;

const UPSTREAM = '@{upstream}';

const MERGE = ['merge', '--no-ff', '--no-commit', '--no-autostash', '--end-of-options', UPSTREAM] as const;

const FAST_FORWARD = ['merge', '--ff-only', '--no-autostash', '--end-of-options', UPSTREAM] as const;

const merging = (git: Git['Service'], dir: string, capture: number | undefined): Effect.Effect<boolean, Failed> =>
  Effect.map(
    run(git, dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], capture).pipe(Effect.catchTag('GitRefused', saidNo)),
    (said) => said.trim() !== '',
  );

const unmergedPaths = (git: Git['Service'], dir: string, capture: number | undefined): Effect.Effect<readonly string[], Failed> =>
  Effect.map(run(git, dir, ['ls-files', '--unmerged', '-z'], capture), (said) => [
    ...new Set(
      said.split('\0').flatMap((record) => {
        const tab = record.indexOf('\t');
        return tab === -1 ? [] : [record.slice(tab + 1)];
      }),
    ),
  ]);

export const fetchAt = Effect.fn('Git.fetch')(function* (
  git: Git['Service'],
  dir: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<void, Failed> {
  yield* run(git, dir, ['fetch', '--prune'], options.capture, undefined, OFFLINE_PROMPTS);
});

export const pullAt = Effect.fn('Git.pull')(function* (
  git: Git['Service'],
  dir: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<Pulled, Failed> {
  const { capture } = options;
  yield* run(git, dir, ['fetch'], capture, undefined, OFFLINE_PROMPTS);
  const before = yield* commitOf(git, dir, 'HEAD', { capture });
  const upstream = (yield* run(git, dir, ['rev-parse', '--verify', '--end-of-options', `${UPSTREAM}^{commit}`], capture)).trim();
  const stays = { head: before, moved: false, conflicts: [], merge: null } as const;
  if (yield* merging(git, dir, capture)) return yield* Effect.as(run(git, dir, MERGE, capture), stays);
  if (before !== null && (yield* ancestor(git, dir, upstream, before, capture))) return stays;
  if (before === null || (yield* ancestor(git, dir, before, upstream, capture))) {
    yield* run(git, dir, FAST_FORWARD, capture);
    const head = yield* commitOf(git, dir, 'HEAD', { capture });
    return { head, moved: head !== before, conflicts: [], merge: null };
  }
  const merged = yield* mergeTreeAt(git, dir, before, upstream, capture === undefined ? {} : { capture });
  if (merged.conflicts.length === 0) {
    return { ...stays, merge: { tree: merged.tree, upstream, message: yield* mergeMessage(git, dir, capture) } };
  }
  const stopped = yield* Effect.result(run(git, dir, MERGE, capture));
  if (stopped._tag === 'Success')
    return yield* new GitUnreadable({ command: commandFor(dir, MERGE), reason: 'git merged cleanly where merge-tree found conflicts' });
  if (stopped.failure._tag !== 'GitRefused' || !(yield* merging(git, dir, capture))) return yield* stopped.failure;
  const conflicts = yield* unmergedPaths(git, dir, capture);
  if (conflicts.length === 0) return yield* stopped.failure;
  return { ...stays, conflicts };
});

const ancestor = (
  git: Git['Service'],
  dir: string,
  older: string,
  newer: string,
  capture: number | undefined,
): Effect.Effect<boolean, Failed> =>
  Effect.map(runEnded(git, dir, ['merge-base', '--is-ancestor', older, newer], capture, [1]), (ended) => ended.status === 0);

const mergeMessage = Effect.fnUntraced(function* (
  git: Git['Service'],
  dir: string,
  capture: number | undefined,
): Effect.fn.Return<string, Failed> {
  const fetched = (yield* run(git, dir, ['rev-parse', '--path-format=absolute', '--git-path', 'FETCH_HEAD'], capture)).trim();
  const said = yield* run(git, dir, ['fmt-merge-msg', '-F', fetched], capture);
  if (said.trim() !== '') return said;
  const named = (yield* run(git, dir, ['rev-parse', '--abbrev-ref', UPSTREAM], capture)).trim();
  return `Merge remote-tracking branch '${named}'\n`;
});

export type Merged = {
  readonly head: string | null;
  readonly conflicts: readonly string[];
};

export const mergeAt = Effect.fn('Git.merge')(function* (
  git: Git['Service'],
  dir: string,
  revision: string,
  options: { readonly message: string; readonly capture?: number; readonly env?: Readonly<Record<string, string>> },
): Effect.fn.Return<Merged, Failed> {
  const before = yield* commitOf(git, dir, 'HEAD', { capture: options.capture });
  const already = yield* merging(git, dir, options.capture);
  const args = ['merge', '--no-ff', '--no-edit', '-m', options.message, '--end-of-options', revision];
  const merged = yield* Effect.result(run(git, dir, args, options.capture, undefined, options.env));
  if (merged._tag === 'Failure') {
    const failure = merged.failure;
    if (failure._tag !== 'GitRefused' || already || !(yield* merging(git, dir, options.capture))) return yield* failure;
    const conflicts = yield* unmergedPaths(git, dir, options.capture);
    if (conflicts.length === 0) return yield* failure;
    return { head: before, conflicts };
  }
  return { head: yield* commitOf(git, dir, 'HEAD', { capture: options.capture }), conflicts: [] };
});

export const mergingAt = (git: Git['Service'], dir: string, options: { readonly capture?: number } = {}): Effect.Effect<boolean, Failed> =>
  merging(git, dir, options.capture);

export const fastForwardAt = Effect.fn('Git.fastForward')(function* (
  git: Git['Service'],
  dir: string,
  revision: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<string | null, Failed> {
  yield* run(git, dir, ['merge', '--ff-only', '--no-edit', '--end-of-options', revision], options.capture);
  return yield* commitOf(git, dir, 'HEAD', { capture: options.capture });
});

export const pushAt = Effect.fn('Git.push')(function* (
  git: Git['Service'],
  dir: string,
  options: PushOptions = {},
): Effect.fn.Return<readonly string[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  const target =
    options.target === undefined
      ? []
      : [
          '--end-of-options',
          options.target.remote,
          ...(options.target.as !== undefined
            ? [`${options.target.branch === undefined ? 'HEAD' : `refs/heads/${options.target.branch}`}:refs/heads/${options.target.as}`]
            : options.target.branch === undefined
              ? []
              : [options.target.branch]),
        ];
  const landing = options.target?.as ?? options.target?.branch;
  const absent = options.absent === true && landing !== undefined ? [`--force-with-lease=refs/heads/${landing}:`] : [];
  const args = ['push', '--porcelain', ...(options.setUpstream === true ? ['-u'] : []), ...absent, ...target];
  const answer = yield* run(git, dir, args, options.capture, undefined, OFFLINE_PROMPTS);
  return movedBy(answer);
});

const movedBy = (answer: string): readonly string[] => {
  const moved: string[] = [];
  for (const line of answer.split('\n')) {
    const update = UPDATED.exec(line);
    if (update !== null) moved.push(update[3] as string);
  }
  return moved;
};

export const deleteRemoteBranchAt = Effect.fn('Git.deleteRemoteBranch')(function* (
  git: Git['Service'],
  dir: string,
  target: { readonly remote: string; readonly branch: string; readonly expect: string },
  options: { readonly capture?: number } = {},
): Effect.fn.Return<readonly string[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  const ref = `refs/heads/${target.branch}`;
  const args = ['push', '--porcelain', `--force-with-lease=${ref}:${target.expect}`, '--end-of-options', target.remote, `:${ref}`];
  return movedBy(yield* run(git, dir, args, options.capture, undefined, OFFLINE_PROMPTS));
});

export const setUpstreamAt = Effect.fn('Git.setUpstream')(function* (
  git: Git['Service'],
  dir: string,
  branch: string,
  upstream: { readonly remote: string; readonly branch: string },
  options: { readonly capture?: number } = {},
): Effect.fn.Return<void, GitUnreadable | GitRefused | GitAnswerInvalid> {
  yield* run(git, dir, ['config', `branch.${branch}.remote`, upstream.remote], options.capture);
  yield* run(git, dir, ['config', `branch.${branch}.merge`, `refs/heads/${upstream.branch}`], options.capture);
});
