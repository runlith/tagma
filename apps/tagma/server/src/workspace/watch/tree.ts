import { join } from 'node:path';
import { Effect } from 'effect';
import { locationsAt } from '@runlith/git/repository';
import type { Git } from '@runlith/git/Git';
import { type TreeShift, type TreeWatch, type WatchEvent, mayReference, mayTouch, watchAll, watchTree } from '../../platform/watch/tree.js';

const HEAD = 'HEAD';

export const watchingHead = Effect.fn('watch.watchingHead')(function* (
  git: Git['Service'],
  from: string,
  moved: (event: WatchEvent) => void,
): Effect.fn.Return<TreeWatch> {
  const located = yield* locationsAt(git, from).pipe(Effect.catch(() => Effect.succeed(null)));
  if (located === null) {
    moved({ rescan: 'polling' });
    return yield* watchAll([]);
  }
  const named =
    (names: readonly string[]) =>
    (event: WatchEvent): void => {
      if (names.some((name) => mayTouch(event, name))) moved(event);
    };
  const watching = yield* watchAll([
    {
      at: located.gitDir,
      recursive: false,
      required: true,
      listen: named(located.gitDir === located.commonDir ? [HEAD, 'packed-refs'] : [HEAD]),
    },
    { at: join(located.gitDir, 'logs'), recursive: false, listen: named([HEAD]) },
    {
      at: join(located.commonDir, 'refs', 'heads'),
      recursive: true,
      listen: (event) => {
        if (mayReference(event)) moved(event);
      },
    },
    ...(located.gitDir === located.commonDir ? [] : [{ at: located.commonDir, recursive: false, listen: named(['packed-refs']) }]),
  ]);
  moved({ rescan: 'opened' });
  return watching;
});

export const watchingCheckout = Effect.fn('watch.watchingCheckout')(function* (
  git: Git['Service'],
  places: {
    readonly tree: string;
    readonly gitFrom: string | null;
  },
  moved: (shift: TreeShift) => void,
): Effect.fn.Return<TreeWatch> {
  const from = places.gitFrom;
  const located = from === null ? null : yield* locationsAt(git, from).pipe(Effect.catch(() => Effect.succeed(null)));
  const watching = yield* watchTree({ tree: places.tree, gitDir: located?.gitDir ?? null, commonDir: located?.commonDir ?? null }, moved);
  moved({ movement: 'tree', rescan: 'opened' });
  return watching;
});
