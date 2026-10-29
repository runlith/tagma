import { Context, Deferred, Effect, Layer } from 'effect';
import { ThreadRuns } from '../contract/service/runs.js';

export class RunEnds extends Context.Service<RunEnds, { end(thread: string): Effect.Effect<void> }>()('tagma/browser/RunEnds') {}

export const runsLayer = Layer.effectContext(
  Effect.sync(() => {
    const current = new Map<string, Deferred.Deferred<void>>();
    const runOf = (thread: string) => {
      const held = current.get(thread) ?? Deferred.makeUnsafe<void>();
      current.set(thread, held);
      return held;
    };
    return Context.make(
      ThreadRuns,
      ThreadRuns.of({ running: () => Effect.succeed(true), ending: (thread) => Effect.sync(() => Deferred.await(runOf(thread))) }),
    ).pipe(
      Context.add(
        RunEnds,
        RunEnds.of({
          end: (thread) =>
            Effect.suspend(() => {
              const ended = runOf(thread);
              current.delete(thread);
              return Deferred.succeed(ended, undefined);
            }),
        }),
      ),
    );
  }),
);
