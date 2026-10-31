import { Cause, Clock, Effect, Exit, FiberSet, Layer } from 'effect';
import type { ThreadRunStoppedBy } from '../ending';
import { ThreadLeaseRhythm } from '../ThreadPorts';
import { RunLifecycle } from './lifecycle/RunLifecycle';
import { RunControl } from './RunControl';
import type { ThreadRunRef } from './ThreadRunLedger';

export const runBeaterLayer: Layer.Layer<never, never, RunControl | RunLifecycle | ThreadLeaseRhythm> = Layer.effectDiscard(
  Effect.gen(function* () {
    const control = yield* RunControl;
    const lifecycle = yield* RunLifecycle;
    const rhythm = yield* ThreadLeaseRhythm;
    const fibers = yield* FiberSet.make<void, never>();
    const spawn = yield* FiberSet.runtime(fibers)();
    let beating = false;
    let closed = false;
    yield* Effect.addFinalizer(() =>
      Effect.suspend(() => {
        closed = true;
        const driven = control.driven().map((run) => run.id);
        return driven.length === 0
          ? Effect.void
          : Effect.flatMap(Effect.exit(lifecycle.handover(driven, new Date())), (exit) =>
              Exit.isFailure(exit)
                ? Effect.logWarning('driven runs could not be handed over', { runs: driven, cause: Cause.pretty(exit.cause) })
                : Effect.void,
            );
      }),
    );

    const interrupting = new Set<string>();
    const interrupt = (run: ThreadRunRef, by: ThreadRunStoppedBy | null): void => {
      if (closed || interrupting.has(run.id)) return;
      interrupting.add(run.id);
      spawn(
        Effect.flatMap(Effect.exit(control.interrupt(run, by)), (stopped) =>
          Exit.isFailure(stopped)
            ? Effect.logWarning('a stop asked elsewhere did not reach its run', { run: run.id, cause: Cause.pretty(stopped.cause) })
            : Effect.void,
        ).pipe(Effect.ensuring(Effect.sync(() => void interrupting.delete(run.id)))),
      );
    };

    const tick: Effect.Effect<void> = Effect.sleep(rhythm.heartbeatIntervalMs).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          const alive = control.held();
          if (alive.length === 0 || closed) {
            beating = false;
            return Effect.void;
          }
          const runs = new Map(alive.map((run) => [run.id, run]));
          return Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) => Effect.exit(lifecycle.beat([...runs.values()], new Date(now)))),
            Effect.flatMap((exit) =>
              Exit.isFailure(exit)
                ? Effect.logWarning('run heartbeats did not land', { runs: [...runs.keys()], cause: Cause.pretty(exit.cause) })
                : Effect.sync(() => {
                    for (const asked of exit.value) {
                      const run = runs.get(asked.runId);
                      if (run !== undefined) interrupt(run, asked.by);
                    }
                  }),
            ),
            Effect.andThen(tick),
          );
        }),
      ),
    );

    control.onChange((count) => {
      if (count === 0 || beating || closed) return;
      beating = true;
      spawn(tick.pipe(Effect.onInterrupt(() => Effect.sync(() => void (beating = false)))));
    });
  }),
);
