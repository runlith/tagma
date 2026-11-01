import { rmSync } from 'node:fs';
import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { treeEntriesAt } from '@runlith/git/entries';
import { actingGit, OwnGitFailed, runGit } from '../../platform/git/ownGit.js';
import type { PreparedLanding } from '../contract/service/prepared.js';
import { named } from './tree.js';

const nested = (one: string, other: string): boolean => one === other || one.startsWith(`${other}/`) || other.startsWith(`${one}/`);

export const rebasePrepared = Effect.fn('prepared.rebase')(function* <Caller>(
  git: Git['Service'],
  root: string,
  prepared: PreparedLanding<Caller>,
  head: string,
): Effect.fn.Return<PreparedLanding<Caller> | null, OwnGitFailed> {
  const { built } = prepared;
  if (
    prepared.merge !== undefined ||
    prepared.beside !== undefined ||
    built.base === null ||
    built.base === head ||
    (built.derived?.length ?? 0) > 0
  )
    return null;
  const base = built.base;
  const between = (to: string) =>
    Effect.map(
      runGit(git, 'submit-rebase-diff', ['-C', root, 'diff-tree', '-r', '-z', '--name-only', '--no-renames', '--end-of-options', base, to]),
      named,
    );
  const [moved, selected, shaped] = yield* Effect.all([between(head), between(built.from), between(built.tree)], { concurrency: 3 });
  const own = [...new Set([...selected, ...shaped])];
  const declaration = new Set(built.declaration);
  if (moved.some((theirs) => declaration.has(theirs) || own.some((path) => nested(theirs, path)))) return null;
  const index = `${prepared.index}.rebase`;
  const env = { GIT_INDEX_FILE: index };
  const over = Effect.fnUntraced(function* (tree: string, paths: readonly string[]) {
    const read = yield* treeEntriesAt(actingGit(git, 'submit-rebase-entries'), root, tree, paths);
    if (read.unread.size > 0)
      return yield* new OwnGitFailed({
        op: 'submit-rebase-entries',
        message: [...read.unread].map(([path, why]) => `${path}: ${why}`).join('; '),
        ran: true,
      });
    const entries = paths.map((path) => {
      const entry = read.entries.get(path);
      return entry === undefined ? `0 ${'0'.repeat(head.length)}\t${path}\0` : `${entry.mode} ${entry.object}\t${path}\0`;
    });
    yield* runGit(git, 'submit-rebase-read', ['-C', root, 'read-tree', head], { env });
    if (entries.length > 0)
      yield* runGit(git, 'submit-rebase-entries', ['-C', root, 'update-index', '-z', '--index-info'], { env, stdin: entries.join('') });
    return yield* runGit(git, 'submit-rebase-tree', ['-C', root, 'write-tree'], { env });
  });
  const { from, tree } = yield* Effect.gen(function* () {
    const from = yield* over(built.from, selected);
    return { from, tree: built.tree === built.from ? from : yield* over(built.tree, shaped) };
  }).pipe(Effect.ensuring(Effect.sync(() => rmSync(index, { force: true }))));
  return {
    ...prepared,
    built: { ...built, base: head, from, tree },
    subject: { ...prepared.subject, base: head, built: tree },
  };
});
