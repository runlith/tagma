import { Cause, Context, Deferred, Effect, FiberSet, Layer } from 'effect';
import type { AgentToolResolution } from '../../agent/door/types';
import type { ThreadBorderFailed, ThreadPortFailure } from '../ThreadBorder';
import { QuestionDeadlines, questionDeadlinesLayer } from './QuestionDeadlines';
import { ThreadRunLedger, type ThreadRunRef } from './ThreadRunLedger';

export class ApprovalParking extends Context.Service<
  ApprovalParking,
  {
    hold(run: ThreadRunRef, questionId: string, resolutions: readonly AgentToolResolution[]): void;
    holds(runId: string, questionId: string): boolean;
    take(runId: string, questionId: string): readonly AgentToolResolution[];
    released(runId: string, questionId: string): Effect.Effect<void>;
    release(runId: string): void;
    parked(): readonly string[];
  }
>()('@runlith/agent/ApprovalParking') {}

type Parked = {
  readonly questionId: string;
  readonly resolutions: readonly AgentToolResolution[];
  readonly released: Deferred.Deferred<void>;
};

export const approvalParkingLayer = Layer.effect(
  ApprovalParking,
  Effect.gen(function* () {
    const maintenance = yield* FiberSet.make<void, never>();
    const ledger = yield* ThreadRunLedger;
    const deadlines = yield* QuestionDeadlines;
    const runMaintenance = yield* FiberSet.runtime(maintenance)();
    const held = new Map<string, Parked>();

    const release = (runId: string): void => {
      const parked = held.get(runId);
      held.delete(runId);
      deadlines.disarm(runId);
      if (parked) Deferred.doneUnsafe(parked.released, Effect.void);
    };

    const reconcile = (): Effect.Effect<void, ThreadPortFailure> =>
      Effect.suspend(() => {
        const asked = [...held.entries()];
        if (asked.length === 0) return Effect.void;
        return Effect.map(ledger.runningHere(asked.map(([runId]) => runId)), (running) => {
          const ours = new Set(running);
          for (const [runId, parked] of asked) {
            if (ours.has(runId) || held.get(runId) !== parked) continue;
            release(runId);
          }
        });
      });

    const maintain = (name: string, work: Effect.Effect<void, ThreadBorderFailed>): void => {
      runMaintenance(
        work.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning('approval parking maintenance failed', { work: name, cause: Cause.pretty(cause) }),
          ),
        ),
      );
    };

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const runId of [...held.keys()]) release(runId);
      }),
    );

    return ApprovalParking.of({
      hold: (run, questionId, resolutions) => {
        release(run.id);
        held.set(run.id, { questionId, resolutions, released: Deferred.makeUnsafe<void>() });
        maintain('parked resolutions', reconcile());
      },

      holds: (runId, questionId) => held.get(runId)?.questionId === questionId,

      take: (runId, questionId) => {
        const parked = held.get(runId);
        if (!parked || parked.questionId !== questionId) return [];
        release(runId);
        return parked.resolutions;
      },

      released: (runId, questionId) => {
        const parked = held.get(runId);
        return parked?.questionId === questionId ? Deferred.await(parked.released) : Effect.void;
      },

      release,

      parked: () => [...held.keys()],
    });
  }),
).pipe(Layer.provideMerge(questionDeadlinesLayer));
