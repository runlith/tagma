import { Context, Deferred, Effect, Layer } from 'effect';
import type { ThreadRunRef } from './ThreadRunLedger';

export class RunBoundaries extends Context.Service<
  RunBoundaries,
  {
    awaiting(runId: string): Deferred.Deferred<void>;
    forget(runId: string, hit: Deferred.Deferred<void>): void;
    reached(run: ThreadRunRef): Effect.Effect<void>;
  }
>()('@runlith/agent/RunBoundaries') {}

export const runBoundariesLayer = Layer.sync(RunBoundaries, () => {
  const hits = new Map<string, Deferred.Deferred<void>>();
  return RunBoundaries.of({
    awaiting: (runId) => {
      const standing = hits.get(runId);
      if (standing !== undefined) return standing;
      const hit = Deferred.makeUnsafe<void>();
      hits.set(runId, hit);
      return hit;
    },
    forget: (runId, hit) => {
      if (hits.get(runId) === hit) hits.delete(runId);
    },
    reached: (run) =>
      Effect.sync(() => {
        const hit = hits.get(run.id);
        if (hit === undefined) return;
        hits.delete(run.id);
        Deferred.doneUnsafe(hit, Effect.void);
      }),
  });
});
