import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { treeEntriesAt, type TreeEntry } from '@runlith/git/entries';
import { configuredGit } from '../../platform/git/ownGit.js';
import type { HeadSide } from '../contract/service/holdings.js';

export const WHOLE_TREE = 256;

const HEADS_KEPT = 65_536;

export type HeadsRead = { revision: string | null; readonly sides: Map<string, HeadSide> };

export const headsRead = (): HeadsRead => ({ revision: null, sides: new Map() });

export const headsAt = Effect.fnUntraced(function* (
  git: Git['Service'],
  dir: string,
  revision: string | null,
  paths: readonly string[],
  known: HeadsRead = headsRead(),
): Effect.fn.Return<ReadonlyMap<string, HeadSide>> {
  if (revision === null) return new Map(paths.map((path) => [path, { kind: 'absent' } as const]));
  if (known.revision !== revision || known.sides.size > HEADS_KEPT) {
    known.revision = revision;
    known.sides.clear();
  }
  const asked = paths.filter((path) => !known.sides.has(path));
  const unread = new Map<string, string>();
  if (asked.length > 0) {
    const read = yield* treeEntriesAt(configuredGit(git, 'holdings-head'), dir, revision, asked.length > WHOLE_TREE ? null : asked);
    const whole = read.unread.get('');
    for (const path of asked) {
      const cause = read.unread.get(path) ?? whole;
      if (cause !== undefined) {
        unread.set(path, cause);
        continue;
      }
      const entry: TreeEntry | undefined = read.entries.get(path);
      known.sides.set(path, entry === undefined ? { kind: 'absent' } : { kind: 'blob', oid: entry.object, mode: entry.mode });
    }
  }
  return new Map(
    paths.map((path): readonly [string, HeadSide] => {
      const cause = unread.get(path);
      return [path, cause === undefined ? (known.sides.get(path) as HeadSide) : { kind: 'unread', cause }];
    }),
  );
});
