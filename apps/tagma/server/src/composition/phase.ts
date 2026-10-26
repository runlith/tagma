import { Cause, Clock, Effect, Exit, Layer, Scope } from 'effect';
import { PhaseEvents } from '../platform/contract/service/phases.js';

const PHASE_TICK = '2 seconds';

const seconds = (elapsed: number): string => `${(elapsed / 1000).toFixed(1)}s`;

const ticking = <A, E, R>(label: string, work: Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      const monotonic = yield* Clock.monotonicTimeNanos;
      const observe = yield* PhaseEvents;
      const stamp = { id: crypto.randomUUID(), name: label, pid: process.pid, startedAt };
      yield* observe({ ...stamp, endedAt: null, durationMs: null, outcome: null });
      let ticks = 0;
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.sleep(PHASE_TICK).pipe(
            Effect.andThen(
              Effect.flatMap(Clock.currentTimeMillis, (now) =>
                Effect.sync(() => {
                  ticks += 1;
                  console.log(`[tagma] ${label} … ${seconds(now - startedAt)} so far`);
                }),
              ),
            ),
          ),
        ),
      );
      const result = yield* work.pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            const endedAt = yield* Clock.currentTimeMillis;
            const ended = yield* Clock.monotonicTimeNanos;
            yield* observe({
              ...stamp,
              endedAt,
              durationMs: Number(ended - monotonic) / 1_000_000,
              outcome: Exit.isSuccess(exit) ? 'completed' : Cause.hasInterrupts(exit.cause) ? 'interrupted' : 'failed',
            });
          }),
        ),
      );
      return { result, took: seconds((yield* Clock.currentTimeMillis) - startedAt), ticked: ticks > 0 };
    }),
  );

export const phase = <A, E, R>(label: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.map(ticking(label, work), ({ result, took }) => {
    console.log(`[tagma] ${label} in ${took}`);
    return result;
  });

export const opening = <ROut, E, RIn>(label: string, layer: Layer.Layer<ROut, E, RIn>): Layer.Layer<ROut, E, RIn> =>
  Layer.fromBuild((memoMap, scope) => phase(label, Layer.buildWithMemoMap(layer, memoMap, scope)));

export const closing = <ROut, E, RIn>(
  label: string,
  layer: Layer.Layer<ROut, E, RIn>,
  before: Effect.Effect<void> = Effect.void,
): Layer.Layer<ROut, E, RIn> =>
  Layer.fromBuild((memoMap, scope) =>
    Effect.gen(function* () {
      const own = yield* Scope.make();
      const observe = yield* PhaseEvents;
      yield* Scope.addFinalizerExit(scope, (exit) =>
        Effect.map(ticking(`${label} closing`, Effect.andThen(before, Scope.close(own, exit))), ({ took, ticked }) => {
          if (ticked) console.log(`[tagma] ${label} closed in ${took}`);
        }).pipe(Effect.provideService(PhaseEvents, observe)),
      );
      return yield* Layer.buildWithMemoMap(layer, memoMap, own);
    }),
  );
