import { randomUUID } from 'node:crypto';
import { lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { gitAnswer, OwnGitFailed, runGit, runGitBytes } from '../../platform/git/ownGit.js';
import type { GitPlaces } from '../../platform/git/places.js';
import { settleHeldIndex } from '../../platform/git/settle.js';
import { named, nul } from '../../change-record/prepared/tree.js';

type Brought = { readonly kept: readonly string[]; readonly failure: string | null; readonly stale: string | null };

const BROUGHT: Brought = { kept: [], failure: null, stale: null };

const SCRATCH = { scratch: true } as const;

const listed = (git: Git['Service'], root: string, op: string, args: readonly string[]) =>
  Effect.map(runGit(git, op, ['-C', root, ...args]), named);

const present = (root: string, path: string) =>
  Effect.tryPromise({
    try: () =>
      lstat(join(root, path)).then(
        () => true,
        (cause: NodeJS.ErrnoException) => (cause.code === 'ENOENT' || cause.code === 'ENOTDIR' ? false : Promise.reject(cause)),
      ),
    catch: (cause) => new OwnGitFailed({ op: 'bring-present', message: `${path} could not be read: ${String(cause)}`, ran: false }),
  });

const leaves = (git: Git['Service'], root: string, tree: string, paths: readonly string[]) =>
  runGitBytes(git, 'bring-entries', ['-C', root, '--literal-pathspecs', 'ls-tree', '-r', '-z', '--full-tree', tree, '--', ...paths]);

const blobsOf = (out: string): ReadonlyMap<string, string> =>
  new Map(
    named(out).map((record) => {
      const tab = record.indexOf('\t');
      return [record.slice(tab + 1), record.slice(0, tab).split(' ')[2] ?? ''] as const;
    }),
  );

const crossing = (kept: readonly string[], changed: ReadonlySet<string>): string | null =>
  kept.find((path) => [...changed].some((other) => other.startsWith(`${path}/`) || path.startsWith(`${other}/`))) ?? null;

const hiddenDirty = Effect.fnUntraced(function* (git: Git['Service'], root: string, from: string, candidates: readonly string[]) {
  const flagged = new Map<string, boolean>();
  for (const record of yield* listed(git, root, 'bring-flags', ['ls-files', '-v', '-z'])) {
    const tag = record[0] ?? 'H';
    const path = record.slice(2);
    if (candidates.includes(path) && (tag === 'S' || tag === 's' || tag !== tag.toUpperCase()))
      flagged.set(path, tag === 'S' || tag === 's');
  }
  if (flagged.size === 0) return [];
  const atFrom = blobsOf(yield* leaves(git, root, from, [...flagged.keys()]));
  const dirty: string[] = [];
  const hashing: string[] = [];
  for (const [path, sparse] of flagged) {
    if (yield* present(root, path)) hashing.push(path);
    else if (!sparse && atFrom.has(path)) dirty.push(path);
  }
  if (hashing.length > 0) {
    const hashes = (yield* runGit(git, 'bring-hash', ['-C', root, 'hash-object', '--stdin-paths'], {
      cleans: true,
      stdin: hashing.map((path) => `${path}\n`).join(''),
    })).split('\n');
    for (const [at, path] of hashing.entries()) if (hashes[at] !== atFrom.get(path)) dirty.push(path);
  }
  return dirty;
});

const restore = Effect.fnUntraced(function* (
  git: Git['Service'],
  root: string,
  tree: string,
  paths: readonly string[],
  env: Record<string, string>,
) {
  const entries = yield* leaves(git, root, tree, paths);
  const there = blobsOf(entries);
  if (entries !== '')
    yield* runGitBytes(git, 'bring-index', ['-C', root, 'update-index', '-z', '--index-info'], { ...SCRATCH, env, stdin: entries });
  const gone = paths.filter((path) => !there.has(path));
  if (gone.length > 0)
    yield* runGitBytes(git, 'bring-remove', ['-C', root, 'update-index', '-z', '--force-remove', '--stdin'], {
      ...SCRATCH,
      env,
      stdin: nul(gone),
    });
});

export const bringCheckout = Effect.fn('landing.bringCheckout')(function* (
  git: Git['Service'],
  root: string,
  places: GitPlaces,
  ref: string,
  from: string,
  to: string,
): Effect.fn.Return<Brought, OwnGitFailed> {
  yield* gitAnswer(git, 'bring-refresh', ['-C', root, 'update-index', '-q', '--refresh']);
  const whole = yield* Effect.result(runGit(git, 'bring-checkout', ['-C', root, 'read-tree', '-m', '-u', from, to]));
  if (whole._tag === 'Success') return BROUGHT;
  const changed = new Set(yield* listed(git, root, 'bring-changed', ['diff-tree', '-r', '-z', '--name-only', '--no-renames', from, to]));
  const all = [...changed];
  const untouched = (failure: string): Brought => ({ kept: all, failure, stale: null });
  const added = yield* listed(git, root, 'bring-added', [
    'diff-tree',
    '-r',
    '-z',
    '--name-only',
    '--no-renames',
    '--diff-filter=A',
    from,
    to,
  ]);
  const kept = (yield* listed(git, root, 'bring-differs', ['diff-index', '-z', '--name-only', '--no-renames', from])).filter((path) =>
    changed.has(path),
  );
  kept.push(
    ...(yield* hiddenDirty(
      git,
      root,
      from,
      all.filter((path) => !kept.includes(path)),
    )),
  );
  for (const path of added) if (!kept.includes(path) && (yield* present(root, path))) kept.push(path);
  if (kept.length === 0) return untouched(whole.failure.message);
  const crossed = crossing(kept, changed);
  if (crossed !== null)
    return untouched(`${crossed} holds uncommitted work where the merge turns a file into a directory or back, so nothing was moved`);
  const temporary = `${places.index}.tagma-bring-${randomUUID()}`;
  const env = { GIT_INDEX_FILE: temporary };
  const target = yield* Effect.ensuring(
    Effect.gen(function* () {
      yield* runGit(git, 'bring-target', ['-C', root, 'read-tree', to], { ...SCRATCH, env });
      yield* restore(git, root, from, kept, env);
      return yield* runGit(git, 'bring-write', ['-C', root, 'write-tree'], { ...SCRATCH, env });
    }),
    Effect.promise(() => rm(temporary, { force: true })),
  );
  const narrowed = yield* Effect.result(runGit(git, 'bring-narrowed', ['-C', root, 'read-tree', '-m', '-u', from, target]));
  if (narrowed._tag === 'Failure') return untouched(narrowed.failure.message);
  const [before, after] = [blobsOf(yield* leaves(git, root, from, kept)), blobsOf(yield* leaves(git, root, to, kept))];
  const entries = kept.map((path) => ({ path, base: before.get(path) ?? null, landed: after.get(path) ?? null }));
  const settled = yield* Effect.result(settleHeldIndex(git, root, places, ref, entries));
  return {
    kept,
    failure: null,
    stale:
      settled._tag === 'Failure'
        ? `their index entries stayed on the old tree: ${settled.failure._tag === 'IndexWriteFailed' ? settled.failure.reason : settled.failure.message}`
        : null,
  };
});
