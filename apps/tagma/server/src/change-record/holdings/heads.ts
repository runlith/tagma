import { isAbsolute } from 'node:path';
import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { treeEntriesAt } from '@runlith/git/entries';
import { insideRepository } from '@runlith/git/repository';
import { treePathsAt } from '@runlith/git/treePaths';
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
    const own = configuredGit(git, 'holdings-head');
    const raw: Git['Service'] = {
      ...own,
      run: (args, options) => own.run(args, { ...options, env: { ...options?.env, GIT_NO_REPLACE_OBJECTS: '1' } }),
    };
    const read = yield* treePathsAt(raw, dir, revision, asked, { gitlinks: true, relative: 'cwd' });
    const fallback = asked.some((path) => isAbsolute(path) || !insideRepository(dir, path) || read.get(path)?._tag !== 'Success')
      ? yield* treeEntriesAt(raw, dir, revision, asked.length > WHOLE_TREE ? null : asked)
      : null;
    for (const path of asked) {
      if (fallback !== null) {
        const cause = fallback.unread.get(path) ?? fallback.unread.get('');
        if (cause !== undefined) {
          unread.set(path, cause);
          continue;
        }
        const entry = fallback.entries.get(path);
        known.sides.set(path, entry === undefined ? { kind: 'absent' } : { kind: 'blob', oid: entry.object, mode: entry.mode });
      } else {
        const entry = read.get(path)!;
        if (entry._tag === 'Success')
          known.sides.set(
            path,
            entry.success === null ? { kind: 'absent' } : { kind: 'blob', oid: entry.success.blob, mode: entry.success.mode },
          );
      }
    }
  }
  return new Map(
    paths.map((path): readonly [string, HeadSide] => {
      const cause = unread.get(path);
      return [path, cause === undefined ? (known.sides.get(path) as HeadSide) : { kind: 'unread', cause }];
    }),
  );
});
