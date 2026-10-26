import { Effect, FileSystem } from 'effect';
import { Git } from '@runlith/git/Git';
import { run, GitUnreadable } from '@runlith/git/repository';
import { worktreesOf } from '@runlith/git/worktree';
import type { ProjectRoot } from '../../workspace/contract/wire/coverage.js';
import { actingGit } from '../../platform/git/ownGit.js';
import { WorktreeUnavailable } from '../contract/wire/failures.js';

export type TreeMetadata = {
  readonly head: string | null;
  readonly ref: string | null;
  readonly headTime: number | null;
  readonly present: boolean;
};

export type MetadataSnapshot = {
  readonly trees: ReadonlyMap<string, TreeMetadata>;
  readonly refs: ReadonlyMap<string, { readonly head: string; readonly time: number | null }>;
};

export const makeMetadata = Effect.gen(function* () {
  const git = actingGit(yield* Git, 'worktree-listing');
  const files = yield* FileSystem.FileSystem;
  return Effect.fn('WorktreeRows.metadata')(function* (canonical: ProjectRoot): Effect.fn.Return<MetadataSnapshot, WorktreeUnavailable> {
    const read = Effect.gen(function* () {
      const trees = yield* worktreesOf(git, canonical.path);
      const listing = yield* run(
        git,
        canonical.path,
        ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(authordate:unix)', 'refs/heads/'],
        undefined,
      );
      const refs = new Map<string, { readonly head: string; readonly time: number | null }>();
      const times = new Map<string, number>();
      for (const line of listing.split('\n')) {
        if (line === '') continue;
        const [ref, head, stamp] = line.split('\0');
        if (ref === undefined || head === undefined || stamp === undefined)
          return yield* new GitUnreadable({ command: ['for-each-ref'], reason: 'a reference record has no name, object or date' });
        const time = stamp === '' ? null : Number(stamp) * 1000;
        if (time !== null && !Number.isFinite(time))
          return yield* new GitUnreadable({ command: ['for-each-ref'], reason: 'a reference record has an invalid date' });
        refs.set(ref, { head, time });
        if (time !== null) times.set(head, time);
      }
      const detached = [
        ...new Set(trees.flatMap((tree) => (tree.head?.commit != null && !times.has(tree.head.commit) ? [tree.head.commit] : []))),
      ];
      if (detached.length > 0) {
        const dated = yield* run(
          git,
          canonical.path,
          ['log', '--no-walk', '--format=%H%x00%at', '--stdin'],
          undefined,
          detached.join('\n'),
        );
        for (const line of dated.split('\n')) {
          if (line === '') continue;
          const [head, stamp] = line.split('\0');
          const time = Number(stamp) * 1000;
          if (head === undefined || stamp === undefined || !Number.isFinite(time))
            return yield* new GitUnreadable({ command: ['show'], reason: 'a commit record has an invalid object or date' });
          times.set(head, time);
        }
      }
      const entries = yield* Effect.forEach(
        trees,
        (tree) =>
          Effect.map(
            files.exists(tree.path),
            (present) =>
              [
                tree.path,
                {
                  head: tree.head?.commit ?? null,
                  ref: tree.head?.ref?.replace(/^refs\/heads\//u, '') ?? null,
                  headTime: tree.head?.commit == null ? null : (times.get(tree.head.commit) ?? null),
                  present,
                },
              ] as const,
          ),
        { concurrency: 3 },
      );
      return { trees: new Map(entries), refs };
    }).pipe(
      Effect.catchTag('GitRefused', (failure) =>
        failure.status === 128 && /not a git repository/u.test(failure.message)
          ? Effect.succeed({
              trees: new Map<string, TreeMetadata>(),
              refs: new Map<string, { readonly head: string; readonly time: number | null }>(),
            })
          : Effect.fail(failure),
      ),
    );
    return yield* Effect.mapError(read, (failure) => new WorktreeUnavailable({ reason: 'git', message: failure.message }));
  });
});
