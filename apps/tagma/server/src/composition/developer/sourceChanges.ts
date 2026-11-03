import { dirname, join } from 'node:path';
import { Effect, Queue, Stream } from 'effect';
import type { SourceChanges, SourceShift } from '../../checkout-builds/contract/service/changes.js';
import type { NextIssue } from '../../installation/contract/wire/next.js';
import { watchAll } from '../../platform/watch/tree.js';
import type { FileRoots } from '../../workspace/contract/service/roots.js';
import type { CheckoutWatch } from '../../workspace/contract/service/watch.js';

const declaredWatch = Effect.fnUntraced(function* (path: string, inputs: readonly string[], watched: () => boolean) {
  const shifts = yield* Queue.unbounded<SourceShift>();
  if (inputs.length === 0) return { shifts, watching: () => true };
  const directories = Map.groupBy(inputs, (input) => dirname(join(path, input)));
  const watch = yield* Effect.acquireRelease(
    watchAll(
      [...directories].map(([at, named]) => ({
        at,
        recursive: false,
        listen: () => Queue.offerUnsafe(shifts, { history: false, watched: watched(), paths: named }),
      })),
    ),
    (opened) => Effect.sync(() => opened.close()),
  );
  return { shifts, watching: watch.watching };
});

export const sourceChanges = (roots: FileRoots['Service'], watches: CheckoutWatch['Service']): SourceChanges['Service'] => ({
  watch: (path, inputs) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const root = yield* roots.register({ path, provenance: { kind: 'installation', id: path } });
        const following = yield* Effect.acquireRelease(watches.follow(root.rootId), (held) => Effect.sync(() => held.release()));
        let declared = (): boolean => true;
        const watching = () => following.watching() && declared();
        const inputsWatch = yield* declaredWatch(path, inputs, watching);
        declared = inputsWatch.watching;
        return Stream.concat(
          Stream.succeed({ history: true, watched: watching(), paths: null }),
          Stream.merge(
            Stream.map(following.shifts, (shift): SourceShift => ({
              history:
                shift.rescan !== null ||
                shift.movements.some((movement) => movement === 'head' || movement === 'refs' || movement === 'config'),
              watched: watching(),
              paths: shift.rescan === null ? shift.paths.keys() : null,
            })),
            Stream.fromQueue(inputsWatch.shifts),
          ),
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
