import { Effect } from 'effect';
import { compareAt } from '@runlith/git/history';
import { fileAt } from '@runlith/git/entries';
import type { Git } from '@runlith/git/Git';
import type { GitAnswerInvalid, GitRefused, GitUnreadable } from '@runlith/git/repository';
import type { Tagged } from '../contract/wire/tags/roles.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import type { GraphChanges, GraphKindChanges } from '../contract/wire/branchChanges.js';
import { decodeBlockFile } from './blockFile.js';
import { LIFECYCLE, lifecycleOf } from '../contract/wire/tags/lifecycle.js';

export const GRAPH_FILES_READ = 300;

const READERS = 8;

const UNTAGGED = 'note';

const total = (kind: GraphKindChanges): number => kind.added + kind.changed + kind.removed + kind.done + kind.closed;

const sideOf = (text: string | null) =>
  text === null
    ? Effect.succeed(null)
    : Effect.map(
        decodeBlockFile(text),
        ({ frontmatter }) => ({ tags: frontmatter.tags ?? [], fields: frontmatter.fields ?? {} }) as Tagged,
      );

type Counted = {
  added: number;
  changed: number;
  removed: number;
  done: number;
  closed: number;
  doneWord: string | null;
  closedWord: string | null;
};

export const graphChangesAt = Effect.fn('graphChangesAt')(function* (
  git: Git['Service'],
  dir: string,
  base: string,
  tip: string,
  under: string | null,
  table: TagTable,
): Effect.fn.Return<GraphChanges, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const compared = yield* compareAt(git, dir, base, tip);
  if (compared.outcome === 'no-merge-base') {
    return { status: 'unread', reason: `${tip} and ${base} share no history in the graph's store` };
  }
  const files = compared.entries.filter((entry) => entry.path.endsWith('.md') && (under === null || entry.path.startsWith(`${under}/`)));
  const read = files.slice(0, GRAPH_FILES_READ);
  const sides = yield* Effect.forEach(
    read,
    (entry) =>
      Effect.flatMap(
        Effect.all([
          entry.status === 'added' ? Effect.succeed(null) : fileAt(git, dir, compared.mergeBase, entry.oldPath ?? entry.path),
          entry.status === 'deleted' ? Effect.succeed(null) : fileAt(git, dir, compared.head, entry.path),
        ]),
        ([before, after]) => Effect.result(Effect.all([sideOf(before), sideOf(after)])),
      ),
    { concurrency: READERS },
  );
  const kinds = new Map<string, Counted>();
  const unreadable: { path: string; reason: string }[] = [];
  let unsorted = files.length - read.length;
  for (const [at, side] of sides.entries()) {
    if (side._tag === 'Failure') {
      unreadable.push({ path: read[at]!.path, reason: side.failure.message });
      continue;
    }
    const [before, after] = side.success;
    const node = after ?? before;
    if (node === null) {
      unsorted += 1;
      continue;
    }
    const owner = table.bindingTag(node, LIFECYCLE);
    const declared = table.tagOf(node);
    if (owner === null && declared === null && node.tags.length > 0) {
      unsorted += 1;
      continue;
    }
    const tag = owner?.id ?? declared?.id ?? UNTAGGED;
    const binding = owner === null ? null : lifecycleOf(owner);
    const counted = kinds.get(tag) ?? {
      added: 0,
      changed: 0,
      removed: 0,
      done: 0,
      closed: 0,
      doneWord: binding?.done ?? null,
      closedWord: binding?.closed ?? null,
    };
    const now = after === null ? null : table.statusOf(after);
    const moved = before !== null && after !== null && now !== null && now !== table.statusOf(before);
    if (before === null) counted.added += 1;
    else if (after === null) counted.removed += 1;
    else if (moved && now === binding?.done) counted.done += 1;
    else if (moved && now === binding?.closed) counted.closed += 1;
    else counted.changed += 1;
    kinds.set(tag, counted);
  }
  const ordered: GraphKindChanges[] = [...kinds]
    .map(([tag, counted]) => ({ tag, ...counted }))
    .sort((left, right) => total(right) - total(left) || (left.tag < right.tag ? -1 : 1));
  return { status: 'counted', kinds: ordered, files: files.length, unsorted, unreadable };
});
