import { Effect, Result } from 'effect';
import type { Working } from '@runlith/files/working';
import type { Git } from '@runlith/git/Git';
import { ignoredAmong } from '@runlith/git/entries';
import { literal } from '@runlith/git/repository';
import { pathspecFits, statusAt, type Status, type StatusRow } from '@runlith/git/status';
import { configuredGit } from '../../platform/git/ownGit.js';
import type { HoldingGit } from '../contract/wire/holdings.js';
import type { HeadSide } from '../contract/service/holdings.js';
import { WHOLE_TREE } from './heads.js';

export type Lettered = { readonly letters: ReadonlyMap<string, HoldingGit>; readonly added: ReadonlySet<string> };

export const lettersAt = Effect.fnUntraced(function* (
  git: Git['Service'],
  dir: string,
  paths: readonly string[],
  status: Status,
  heads: ReadonlyMap<string, HeadSide>,
  working: ReadonlyMap<string, Working>,
): Effect.fn.Return<Lettered | string> {
  const asked = new Set(paths);
  const letters = new Map<string, HoldingGit>();
  const { unmerged, staged, unstaged, untracked } = status.entries;
  for (const area of [unmerged, unstaged, staged, untracked])
    for (const row of area) {
      if (asked.has(row.path) && !letters.has(row.path)) letters.set(row.path, row.status);
      if (row.oldPath !== undefined && asked.has(row.oldPath) && !letters.has(row.oldPath)) letters.set(row.oldPath, 'deleted');
    }
  const added = new Set(
    staged.filter((row) => asked.has(row.path) && (row.status === 'added' || row.status === 'renamed')).map((row) => row.path),
  );
  const candidates = paths.filter((path) => {
    if (letters.has(path) || heads.get(path)?.kind !== 'absent') return false;
    const bytes = working.get(path);
    return bytes !== undefined && bytes.kind !== 'absent' && bytes.kind !== 'unread';
  });
  const ignored = yield* Effect.result(ignoredAmong(configuredGit(git, 'holdings-ignored'), dir, candidates));
  if (ignored._tag === 'Failure') return ignored.failure.message;
  const outside = new Set(candidates);
  for (const path of paths)
    if (!letters.has(path)) letters.set(path, outside.has(path) ? (ignored.success.has(path) ? 'ignored' : 'untracked') : null);
  return { letters, added };
});

export const confirmedAt = Effect.fnUntraced(function* (
  git: Git['Service'],
  dir: string,
  status: Status,
  silent: readonly string[],
): Effect.fn.Return<Result.Result<Status, { readonly message: string }>> {
  if (silent.length === 0) return Result.succeed(status);
  const fits = silent.length <= WHOLE_TREE && pathspecFits(silent);
  const read = yield* Effect.result(
    statusAt(configuredGit(git, 'holdings-status'), dir, {
      untracked: 'no',
      paths: fits ? silent.map(literal) : undefined,
      monitor: false,
    }),
  );
  if (read._tag === 'Failure') return read;
  if (read.success.branch.head !== status.branch.head)
    return Result.fail({ message: 'HEAD moved between the whole status and its unmonitored confirmation' });
  const asked = new Set(silent);
  const joined = (rows: readonly StatusRow[], more: readonly StatusRow[]) => [...rows, ...more.filter((row) => asked.has(row.path))];
  const { entries } = read.success;
  return Result.succeed({
    ...status,
    entries: {
      staged: joined(status.entries.staged, entries.staged),
      unstaged: joined(status.entries.unstaged, entries.unstaged),
      untracked: status.entries.untracked,
      unmerged: joined(status.entries.unmerged, entries.unmerged),
    },
  });
});
