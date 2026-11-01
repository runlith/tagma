import { randomUUID } from 'node:crypto';
import { lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { gitAnswer, OwnGitFailed, runGit, runGitBytes } from '../../platform/git/ownGit.js';
import { named, nul } from '../../change-record/prepared/tree.js';

type Brought = { readonly kept: readonly string[]; readonly failure: string | null };

const BROUGHT: Brought = { kept: [], failure: null };

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

const entriesOf = (git: Git['Service'], root: string, tree: string, paths: readonly string[]) =>
  runGitBytes(git, 'bring-entries', ['-C', root, '--literal-pathspecs', 'ls-tree', '-z', '--full-tree', tree, '--', ...paths]);

const placed = (out: string): ReadonlySet<string> => new Set(named(out).map((record) => record.slice(record.indexOf('\t') + 1)));

const setEntries = Effect.fnUntraced(function* (
  git: Git['Service'],
  root: string,
  tree: string,
  paths: readonly string[],
  env: Record<string, string> | undefined,
) {
  if (paths.length === 0) return;
  const entries = yield* entriesOf(git, root, tree, paths);
  const there = placed(entries);
  if (entries !== '') yield* runGitBytes(git, 'bring-index', ['-C', root, 'update-index', '-z', '--index-info'], { env, stdin: entries });
  const gone = paths.filter((path) => !there.has(path));
  if (gone.length > 0)
    yield* runGitBytes(git, 'bring-remove', ['-C', root, 'update-index', '-z', '--force-remove', '--stdin'], { env, stdin: nul(gone) });
});

export const bringCheckout = Effect.fn('landing.bringCheckout')(function* (
  git: Git['Service'],
  root: string,
  index: string,
  from: string,
  to: string,
): Effect.fn.Return<Brought, OwnGitFailed> {
  yield* gitAnswer(git, 'bring-refresh', ['-C', root, 'update-index', '-q', '--refresh']);
  const whole = yield* Effect.result(runGit(git, 'bring-checkout', ['-C', root, 'read-tree', '-m', '-u', from, to]));
  if (whole._tag === 'Success') return BROUGHT;
  const changed = new Set(yield* listed(git, root, 'bring-changed', ['diff-tree', '-r', '-z', '--name-only', '--no-renames', from, to]));
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
  const differs = (yield* listed(git, root, 'bring-differs', ['diff-index', '-z', '--name-only', '--no-renames', from])).filter((path) =>
    changed.has(path),
  );
  const staged = new Set(yield* listed(git, root, 'bring-staged', ['diff-index', '--cached', '-z', '--name-only', '--no-renames', from]));
  const kept = [...differs];
  for (const path of added) if (!differs.includes(path) && (yield* present(root, path))) kept.push(path);
  if (kept.length === 0) return { kept: [...changed], failure: whole.failure.message };
  const temporary = `${index}.tagma-bring-${randomUUID()}`;
  const env = { GIT_INDEX_FILE: temporary };
  const target = yield* Effect.ensuring(
    Effect.gen(function* () {
      yield* runGit(git, 'bring-target', ['-C', root, 'read-tree', to], { env });
      yield* setEntries(git, root, from, kept, env);
      return yield* runGit(git, 'bring-write', ['-C', root, 'write-tree'], { env });
    }),
    Effect.promise(() => rm(temporary, { force: true })),
  );
  const narrowed = yield* Effect.result(runGit(git, 'bring-narrowed', ['-C', root, 'read-tree', '-m', '-u', from, target]));
  if (narrowed._tag === 'Failure') return { kept: [...changed], failure: narrowed.failure.message };
  yield* setEntries(
    git,
    root,
    to,
    kept.filter((path) => !staged.has(path)),
    undefined,
  );
  return { kept, failure: null };
});
