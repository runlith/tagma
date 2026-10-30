import { Effect, Exit, FiberSet, Option, Scope, Semaphore, Stream } from 'effect';
import { carryCost } from '@runlith/performance/CostLedger';
import { Git } from '@runlith/git/Git';
import { commitOf } from '@runlith/git/repository';
import { configuredGit } from '../../platform/git/ownGit.js';
import { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import type { CheckoutPlace } from '../../workspace/contract/service/checkoutPaths.js';
import { Coverage } from '../../workspace/contract/service/roots.js';

type Known = { head: string | null; readonly projectId: number; readonly root: string; readonly scope: Scope.Closeable };

export type Heads = Effect.Success<typeof makeHeads>;

export const makeHeads = Effect.gen(function* () {
  const git = yield* Git;
  const rows = yield* Effect.serviceOption(CheckoutRows);
  const coverage = yield* Effect.serviceOption(Coverage);
  const scope = yield* Effect.scope;
  const known = new Map<string, Known>();
  const claiming = yield* Semaphore.make(1);

  const recheck = Effect.fnUntraced(function* (covering: Coverage['Service'], projectId: number) {
    const covered = yield* Effect.result(covering.covered(projectId));
    if (covered._tag === 'Failure') {
      return yield* Effect.logWarning('HEAD watches stay as they are: the coverage that would release them could not be read', {
        projectId,
        reason: covered.failure.message,
      });
    }
    const standing = new Map<string, string>(covered.success.roots.map((root) => [root.rootId, root.path]));
    for (const [checkout, one] of [...known]) {
      if (one.projectId !== projectId || standing.get(checkout) === one.root) continue;
      known.delete(checkout);
      yield* Scope.close(one.scope, Exit.void);
    }
  });

  if (Option.isSome(coverage)) {
    const runFork = yield* FiberSet.makeRuntime<never, void, never>();
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        coverage.value.onCovered((projectId) => void runFork(carryCost(recheck(coverage.value, projectId), 'Heads.coverage'))),
      ),
      (release) => Effect.sync(release),
    );
  }

  const read = Effect.fnUntraced(function* (projectId: number, place: CheckoutPlace) {
    const commit = yield* Effect.result(commitOf(configuredGit(git, 'intake-head'), place.root, 'HEAD'));
    if (commit._tag === 'Failure') {
      yield* Effect.logWarning('a write is recorded without its HEAD: HEAD of its checkout could not be read', {
        root: place.root,
        reason: commit.failure.message,
      });
      return null;
    }
    const head = commit.success;
    if (Option.isNone(rows)) return head;
    yield* claiming.withPermit(
      Effect.gen(function* () {
        if (known.has(place.checkout)) return;
        const watching = yield* Scope.fork(scope);
        const entry: Known = { head, projectId, root: place.root, scope: watching };
        known.set(place.checkout, entry);
        yield* Effect.forkIn(
          Stream.runForEach(rows.value.headMoved(place.root), (moved) =>
            Effect.sync(() => {
              entry.head = moved.head;
            }),
          ),
          watching,
        );
      }),
    );
    return head;
  });

  return {
    of: (projectId: number, place: CheckoutPlace): Effect.Effect<string | null> => {
      const standing = known.get(place.checkout);
      return standing === undefined ? read(projectId, place) : Effect.succeed(standing.head);
    },
  };
});
