import { Effect, Stream } from 'effect';
import type { SourceChanges, SourceShift } from '../../checkout-builds/contract/service/changes.js';
import type { NextIssue } from '../../installation/contract/wire/next.js';
import type { FileRoots } from '../../workspace/contract/service/roots.js';
import type { CheckoutWatch } from '../../workspace/contract/service/watch.js';

export const sourceChanges = (roots: FileRoots['Service'], watches: CheckoutWatch['Service']): SourceChanges['Service'] => ({
  watch: (path) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const root = yield* roots.register({ path, provenance: { kind: 'installation', id: path } });
        const following = yield* Effect.acquireRelease(watches.follow(root.rootId), (held) => Effect.sync(() => held.release()));
        return Stream.concat(
          Stream.succeed({ history: true, watched: following.watching(), paths: null }),
          Stream.map(following.shifts, (shift): SourceShift => ({
            history:
              shift.rescan !== null ||
              shift.movements.some((movement) => movement === 'head' || movement === 'refs' || movement === 'config'),
            watched: following.watching(),
            paths: shift.rescan === null ? shift.paths.keys() : null,
          })),
        );
      }).pipe(
        Effect.mapError((failure): NextIssue => ({
          code: 'source-unreadable',
          reason: failure.message,
          unblock: [`${path} — restore the source checkout before following it`],
        })),
      ),
    ),
});
