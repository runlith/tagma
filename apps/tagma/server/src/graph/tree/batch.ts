import { access, lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Clock, Data, Effect } from 'effect';
import { isStaging } from './atomicFile.js';
import type { Git } from '@runlith/git/Git';
import { isCookie } from '@runlith/watch/cookie';
import { OwnGitFailed, gitAnswer, runGit, runGitBytes } from '../../platform/git/ownGit.js';
import { publish } from '../../platform/git/publish.js';
import { AGENT_PERSON, personOf } from '../../platform/contract/wire/commits.js';
import { operationIn, placesOf, pointedAt } from '../../platform/git/places.js';
import type { SettleEntry, Settlement } from '../../platform/git/settle.js';

export type CapturedFile = {
  readonly mode: '100644' | '100755' | '120000';
  readonly bytes: Uint8Array;
};

export type TreeCapture = {
  readonly files: ReadonlyMap<string, CapturedFile>;
  readonly gone: ReadonlySet<string>;
};

export type BatchCommit = {
  readonly ref: string;
  readonly from: string | null;
  readonly message: string;
  readonly at: Date;
};

const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null'] as const;

export class TreeCaptureFailed extends Data.TaggedError('TreeCaptureFailed')<{ readonly path: string; readonly message: string }> {}

const GIT = '.git';

const GITDIR = 'gitdir: ';

const absent = (cause: unknown): boolean => {
  const code = (cause as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

export const captureTree = (
  treeRoot: string,
  paths: Iterable<string>,
  excluded: (relative: string) => boolean,
): Effect.Effect<TreeCapture, TreeCaptureFailed> => {
  const named = [...new Set(paths)];
  return Effect.tryPromise({
    try: async () => {
      const files = new Map<string, CapturedFile>();
      const gone = new Set<string>();
      const take = async (relative: string): Promise<void> => {
        if (relative === GIT || relative.startsWith(`${GIT}/`) || isStaging(basename(relative)) || isCookie(relative) || excluded(relative))
          return;
        const abs = join(treeRoot, relative);
        const found = await lstat(abs).catch((cause: unknown) => (absent(cause) ? null : Promise.reject(cause)));
        if (found === null) {
          gone.add(relative);
          return;
        }
        if (found.isDirectory()) {
          for (const entry of await readdir(abs)) await take(`${relative}/${entry}`);
          return;
        }
        if (found.isSymbolicLink()) {
          files.set(relative, { mode: '120000', bytes: Buffer.from(await readlink(abs)) });
          return;
        }
        if (!found.isFile()) return;
        const bytes = await readFile(abs).catch((cause: unknown) => (absent(cause) ? null : Promise.reject(cause)));
        if (bytes === null) gone.add(relative);
        else files.set(relative, { mode: (found.mode & 0o111) === 0 ? '100644' : '100755', bytes });
      };
      for (const relative of named) await take(relative);
      return { files, gone };
    },
    catch: (cause) => new TreeCaptureFailed({ path: treeRoot, message: String(cause) }),
  });
};

const OPERATIONS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'] as const;

export type TreeBranch = { readonly ref: string } | { readonly held: 'detached' | 'operation' | 'no-repository' };

export type TreeBranchOptions = { readonly operations?: boolean };

export const gitdirOf = (text: string): string | null =>
  text.startsWith(GITDIR) ? text.slice(GITDIR.length).replace(/[\r\n]+$/, '') : null;

export const treeGitDir = async (treeRoot: string): Promise<string | null> => {
  const marker = join(treeRoot, GIT);
  const found = await lstat(marker).catch((cause: unknown) => (absent(cause) ? null : Promise.reject(cause)));
  if (found === null) return null;
  if (found.isDirectory()) return marker;
  const pointer = gitdirOf(await readFile(marker, 'utf8'));
  return pointer === null ? marker : resolve(treeRoot, pointer);
};

export const treeBranch = (treeRoot: string, options: TreeBranchOptions = {}): Effect.Effect<TreeBranch, TreeCaptureFailed> =>
  Effect.tryPromise({
    try: async (): Promise<TreeBranch> => {
      const gitDir = await treeGitDir(treeRoot);
      if (gitDir === null) return { held: 'no-repository' };
      for (const operation of options.operations === false ? [] : OPERATIONS) {
        if (
          await access(join(gitDir, operation)).then(
            () => true,
            () => false,
          )
        )
          return { held: 'operation' };
      }
      const head = (await readFile(join(gitDir, 'HEAD'), 'utf8')).trim();
      return head.startsWith('ref: ') ? { ref: head.slice('ref: '.length) } : { held: 'detached' };
    },
    catch: (cause) => new TreeCaptureFailed({ path: treeRoot, message: String(cause) }),
  });

const quoted = (path: string): string =>
  /["\\\n]/.test(path) || path.startsWith('"') ? `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"` : path;

const importStream = (capture: TreeCapture, commit: BatchCommit): Uint8Array => {
  const parts: Uint8Array[] = [];
  const text = (line: string) => parts.push(Buffer.from(line, 'utf8'));
  const data = (bytes: Uint8Array) => {
    text(`data ${bytes.byteLength}\n`);
    parts.push(bytes);
    text('\n');
  };
  const seconds = Math.floor(commit.at.getTime() / 1000);
  const person = `${personOf(AGENT_PERSON)} ${seconds} +0000`;
  if (commit.from === null) text(`reset ${commit.ref}\n\n`);
  text(`commit ${commit.ref}\nmark :1\nauthor ${person}\ncommitter ${person}\n`);
  data(Buffer.from(commit.message, 'utf8'));
  if (commit.from !== null) text(`from ${commit.from}\n`);
  for (const path of [...capture.gone].sort()) text(`D ${quoted(path)}\n`);
  for (const [path, file] of [...capture.files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    text(`M ${file.mode} inline ${quoted(path)}\n`);
    data(file.bytes);
  }
  text('get-mark :1\ndone\n');
  return Buffer.concat(parts);
};

const STAGING_REF = 'refs/tagma/graph-batch';
const ZERO = /^0+$/;

export type OwedSettlement = { readonly ref: string; readonly entries: readonly SettleEntry[] };

export type CheckoutPublished =
  | {
      readonly kind: 'committed';
      readonly commit: string;
      readonly base: string | null;
      readonly files: number;
      readonly unsettled: string | null;
      readonly owed: OwedSettlement;
    }
  | { readonly kind: 'clean' }
  | { readonly kind: 'moved' }
  | { readonly kind: 'held'; readonly reason: 'detached' | 'merge' };

export const owedOf = (entries: readonly SettleEntry[], settled: Settlement | { readonly message: string }): readonly SettleEntry[] =>
  'paths' in settled ? (settled.moved ? entries.filter((entry) => settled.paths.get(entry.path) === 'unsynced') : []) : entries;

export const publishToCheckout = Effect.fnUntraced(function* (
  git: Git['Service'],
  checkout: string,
  capture: TreeCapture,
  message: string,
): Effect.fn.Return<CheckoutPublished, OwnGitFailed> {
  const places = yield* placesOf(git, checkout);
  if ((yield* operationIn(places)) !== null) return { kind: 'held', reason: 'merge' } as const;
  const head = yield* pointedAt(git, checkout);
  const ref = head.ref;
  if (ref === null) return { kind: 'held', reason: 'detached' } as const;
  const base = head.commit;
  const imported = yield* gitAnswer(git, 'graph-batch', ['-C', checkout, ...NO_HOOKS, 'fast-import', '--quiet', '--done', '--force'], {
    stdin: importStream(capture, { message, ref: STAGING_REF, from: base, at: new Date(yield* Clock.currentTimeMillis) }),
  });
  if (imported.status !== 0) {
    return yield* new OwnGitFailed({ op: 'graph-batch', message: imported.stderr.trim() || imported.stdout.trim(), ran: true });
  }
  const built = imported.stdout.trim();
  const delta = yield* runGitBytes(git, 'graph-delta', [
    '-C',
    checkout,
    'diff-tree',
    '-z',
    '-r',
    '--no-renames',
    ...(base === null ? ['--root', '--no-commit-id', built] : [base, built]),
  ]);
  yield* runGit(git, 'graph-unstage', ['-C', checkout, ...NO_HOOKS, 'update-ref', '-d', STAGING_REF]);
  const fields = delta.split('\0');
  const entries: SettleEntry[] = [];
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const [, , old = '', landed = ''] = (fields[at] as string).split(' ');
    entries.push({ path: fields[at + 1] as string, base: ZERO.test(old) ? null : old, landed: ZERO.test(landed) ? null : landed });
  }
  if (entries.length === 0) {
    const paths = [...capture.files.keys(), ...capture.gone];
    if (paths.length > 0)
      yield* runGitBytes(
        git,
        'graph-index',
        ['-C', checkout, '--literal-pathspecs', 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'],
        { stdin: `${paths.join('\0')}\0` },
      );
    return { kind: 'clean' } as const;
  }
  const answer = yield* Effect.result(
    publish(
      git,
      { checkout, places, ref, base, tree: `${built}^{tree}`, message, job: 'graph batch', entries, author: AGENT_PERSON },
      () => Effect.void,
    ),
  );
  if (answer._tag === 'Failure') {
    if (answer.failure._tag === 'MidOperation') return { kind: 'held', reason: 'merge' } as const;
    return yield* answer.failure;
  }
  const published = answer.success;
  if (published.outcome === 'moved') return { kind: 'moved' } as const;
  const settled = published.settlement;
  const unsettled =
    'paths' in settled
      ? [...settled.paths].some(([, outcome]) => outcome !== 'synced')
        ? 'some graph paths were staged or moved by hand and kept as they stood'
        : null
      : settled.message;
  return {
    kind: 'committed',
    commit: published.commit,
    base,
    files: entries.length,
    unsettled,
    owed: { ref, entries: owedOf(entries, settled) },
  } as const;
});

export type BatchCommitted = {
  readonly commit: string;
  readonly unindexed: OwnGitFailed | null;
};

export const commitCapture = Effect.fnUntraced(function* (
  git: Git['Service'],
  treeRoot: string,
  capture: TreeCapture,
  commit: BatchCommit,
): Effect.fn.Return<BatchCommitted, OwnGitFailed> {
  const imported = yield* gitAnswer(git, 'batch-commit', ['-C', treeRoot, ...NO_HOOKS, 'fast-import', '--quiet', '--done'], {
    stdin: importStream(capture, commit),
  });
  if (imported.status !== 0) {
    return yield* new OwnGitFailed({ op: 'batch-commit', message: imported.stderr.trim() || imported.stdout.trim(), ran: true });
  }
  const paths = [...capture.gone, ...capture.files.keys()];
  const aligned = yield* Effect.result(
    gitAnswer(git, 'batch-index', ['-C', treeRoot, '--literal-pathspecs', 'reset', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      stdin: `${paths.join('\0')}\0`,
    }),
  );
  const unindexed =
    aligned._tag === 'Failure'
      ? aligned.failure
      : aligned.success.status === 0
        ? null
        : new OwnGitFailed({ op: 'batch-index', message: aligned.success.stderr.trim() || aligned.success.stdout.trim(), ran: true });
  return { commit: imported.stdout.trim(), unindexed };
});
