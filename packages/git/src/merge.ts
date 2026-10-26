import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { Git } from './Git.js';
import { run, runEnded, commandFor, GitUnreadable, type GitAnswerInvalid, type GitRefused } from './repository.js';

type Failed = GitUnreadable | GitRefused | GitAnswerInvalid;

export type MergeTree = {
  readonly tree: string;
  readonly conflicts: readonly string[];
  readonly yielded: readonly string[];
};

export type MergeSides = { readonly base: string; readonly ours: string; readonly theirs: string };

const CONFLICTED = 1;

export const OBJECT = /^[0-9a-f]{40,64}$/;

const MERGE_FILE_CONFLICTS = Array.from({ length: 127 }, (_, at) => at + 1);

export type FileMerge = {
  readonly text: string;
  readonly conflicts: number;
};

const stagedTexts = (
  dir: string,
  texts: readonly string[],
): Effect.Effect<{ readonly scratch: string; readonly files: readonly string[] }, GitUnreadable> =>
  Effect.tryPromise({
    try: async () => {
      const scratch = await mkdtemp(join(tmpdir(), 'merge-file-'));
      const files = texts.map((_, at) => join(scratch, String(at)));
      await Promise.all(texts.map((text, at) => writeFile(files[at] as string, text)));
      return { scratch, files };
    },
    catch: (cause) =>
      new GitUnreadable({ command: commandFor(dir, ['merge-file']), reason: `the three texts could not be staged: ${String(cause)}` }),
  });

export const mergeFileAt = Effect.fn('Git.mergeFile')(function* (
  git: Git['Service'],
  dir: string,
  texts: MergeSides,
  options: { readonly capture?: number; readonly favor?: 'none' | 'ours' } = {},
): Effect.fn.Return<FileMerge, Failed> {
  const staged = yield* stagedTexts(dir, [texts.ours, texts.base, texts.theirs]);
  return yield* Effect.gen(function* () {
    const favor = options.favor === 'ours' ? ['--ours'] : [];
    const args = ['merge-file', '-p', ...favor, '-L', 'ours', '-L', 'base', '-L', 'theirs', ...staged.files];
    const ended = yield* runEnded(git, dir, args, options.capture, MERGE_FILE_CONFLICTS);
    return { text: ended.stdout, conflicts: ended.status };
  }).pipe(Effect.ensuring(Effect.promise(() => rm(staged.scratch, { recursive: true, force: true }))));
});

export const mergeTreeArgs = (ours: string, theirs: string, mergeBase: string | undefined, names = true): readonly string[] => [
  'merge-tree',
  '--write-tree',
  ...(names ? ['--name-only'] : []),
  '--no-messages',
  '-z',
  ...(mergeBase === undefined ? [] : [`--merge-base=${mergeBase}`]),
  '--end-of-options',
  ours,
  theirs,
];

export const mergedIn = Effect.fn('Git.mergedIn')(function* (
  git: Git['Service'],
  dir: string,
  args: readonly string[],
  capture: number | undefined,
  env?: Readonly<Record<string, string>>,
): Effect.fn.Return<MergeTree, Failed> {
  const ended = yield* runEnded(git, dir, args, capture, [CONFLICTED], { env });
  const [tree = '', ...paths] = ended.stdout.split('\0');
  const conflicts = [...new Set(paths.filter((path) => path !== ''))];
  if (!OBJECT.test(tree) || (ended.status === CONFLICTED) !== conflicts.length > 0) {
    return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'merge-tree printed no tree this reader can frame' });
  }
  return { tree, conflicts, yielded: [] };
});

export const mergeTreeAt = Effect.fn('Git.mergeTree')(function* (
  git: Git['Service'],
  dir: string,
  ours: string,
  theirs: string,
  options: { readonly mergeBase?: string; readonly capture?: number } = {},
): Effect.fn.Return<MergeTree, Failed> {
  return yield* mergedIn(git, dir, mergeTreeArgs(ours, theirs, options.mergeBase), options.capture);
});

export type Identity = { readonly name: string; readonly email: string; readonly date: string };

export type CommitMeta = {
  readonly tree: string;
  readonly parents: readonly string[];
  readonly author: Identity;
  readonly message: string;
};

export const commitMetaAt = Effect.fn('Git.commitMeta')(function* (
  git: Git['Service'],
  dir: string,
  commit: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<CommitMeta, Failed> {
  const args = ['log', '-1', '--date=raw', '--format=%T%x00%P%x00%an%x00%ae%x00%ad%x00%B', '--end-of-options', commit];
  const [tree = '', parents = '', name = '', email = '', date = '', ...message] = (yield* run(git, dir, args, options.capture)).split('\0');
  if (tree === '' || date === '') {
    return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'log printed no commit this reader can frame' });
  }
  return {
    tree,
    parents: parents.split(' ').filter((one) => one !== ''),
    author: { name, email, date },
    message: message.join('\0').replace(/\n+$/, ''),
  };
});

export const commitTreeAt = Effect.fn('Git.commitTree')(function* (
  git: Git['Service'],
  dir: string,
  commit: {
    readonly tree: string;
    readonly parents: readonly string[];
    readonly message: string;
    readonly author?: Identity;
  },
  options: { readonly capture?: number; readonly sign?: boolean } = {},
): Effect.fn.Return<string, Failed> {
  const args = [
    'commit-tree',
    ...commit.parents.flatMap((parent) => ['-p', parent]),
    ...(options.sign === true ? ['-S'] : []),
    '--end-of-options',
    commit.tree,
  ];
  const author =
    commit.author === undefined
      ? undefined
      : { GIT_AUTHOR_NAME: commit.author.name, GIT_AUTHOR_EMAIL: commit.author.email, GIT_AUTHOR_DATE: commit.author.date };
  const made = (yield* run(git, dir, args, options.capture, `${commit.message}\n`, author)).trim();
  if (!/^[0-9a-f]{40,64}$/.test(made)) {
    return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'commit-tree printed no commit' });
  }
  return made;
});

export const commitsBetween = Effect.fn('Git.commitsBetween')(function* (
  git: Git['Service'],
  dir: string,
  base: string,
  tip: string,
  merges: boolean,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<readonly string[], Failed> {
  const listed = yield* run(
    git,
    dir,
    ['rev-list', merges ? '--merges' : '--no-merges', '--end-of-options', `${base}..${tip}`],
    options.capture,
  );
  return listed.split('\n').filter((line) => line !== '');
});

export const moveBranchAt = Effect.fn('Git.moveBranch')(function* (
  git: Git['Service'],
  dir: string,
  branch: string,
  from: string,
  to: string,
  reflogMessage: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<void, Failed> {
  yield* run(git, dir, ['update-ref', '-m', reflogMessage, '--end-of-options', `refs/heads/${branch}`, to, from], options.capture);
  yield* run(git, dir, ['read-tree', '-m', '-u', '--end-of-options', from, to], options.capture);
});

export type Replayed =
  | { readonly head: string; readonly applied: number; readonly dropped: number; readonly conflicts: readonly [] }
  | { readonly head: null; readonly at: string; readonly conflicts: readonly [string, ...string[]] };

export const replayAt = Effect.fn('Git.replay')(function* (
  git: Git['Service'],
  dir: string,
  range: { readonly onto: string; readonly upstream: string; readonly tip: string },
  options: { readonly capture?: number; readonly sign?: boolean } = {},
): Effect.fn.Return<Replayed, Failed> {
  const listed = yield* run(
    git,
    dir,
    ['rev-list', '--reverse', '--no-merges', '--end-of-options', `${range.upstream}..${range.tip}`],
    options.capture,
  );
  let head = range.onto;
  let tree = (yield* commitMetaAt(git, dir, head, options)).tree;
  let applied = 0;
  let dropped = 0;
  for (const commit of listed.split('\n').filter((line) => line !== '')) {
    const meta = yield* commitMetaAt(git, dir, commit, options);
    const parent = meta.parents[0];
    const merged = yield* mergeTreeAt(git, dir, head, commit, {
      mergeBase: parent,
      capture: options.capture,
    });
    const [first, ...rest] = merged.conflicts;
    if (first !== undefined) return { head: null, at: commit, conflicts: [first, ...rest] };
    if (merged.tree === tree) {
      dropped += 1;
      continue;
    }
    head = yield* commitTreeAt(git, dir, { tree: merged.tree, parents: [head], message: meta.message, author: meta.author }, options);
    tree = merged.tree;
    applied += 1;
  }
  return { head, applied, dropped, conflicts: [] };
});
