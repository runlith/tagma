import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, Schedule, type Scope } from 'effect';
import type { ThreadRestarted } from '../ending';
import type { StopCase, StopState, Unreachable } from './transportStops';

export type RestartCase = StopCase & {
  readonly continues: boolean;
  restart(): Effect.Effect<ThreadRestarted, unknown>;
  processes(): Effect.Effect<number, unknown>;
};

export type RestartRig<R = never> = {
  reach(state: StopState): Effect.Effect<RestartCase | Unreachable, unknown, Scope.Scope | R>;
};

export function describeTransportRestarts<R>(
  transport: string,
  make: () => Effect.Effect<RestartRig<R>, unknown, Scope.Scope | R>,
  test: Tester<Scope.Scope | R>,
  states: readonly StopState[] = ['tagma-call'],
  timeout?: number,
): void {
  describe(`${transport}: Restart agent ends the turn, replaces the agent process and continues the turn`, () => {
    for (const state of states)
      test(
        `Restart in the state ${state}`,
        Effect.fnUntraced(function* () {
          const rig = yield* make();
          const reached = yield* rig.reach(state);
          if ('unreachable' in reached) return;
          const processes = yield* reached.processes();
          const answer = yield* reached.restart();
          expect(answer.stoppedRunId).toBe(reached.runId);
          const run = yield* reached.ended().pipe(Effect.repeat({ while: (ended) => ended === null, schedule: Schedule.spaced(5) }));
          expect(run?.status).toBe('aborted');
          expect(answer.runId !== null).toBe(reached.continues);
          if (answer.runId === null) return;
          yield* reached.processes().pipe(Effect.repeat({ while: (count) => count <= processes, schedule: Schedule.spaced(5) }));
          yield* reached.settle();
          expect(yield* reached.runsAfter()).toBe(1);
        }),
        timeout,
      );
  });
}
