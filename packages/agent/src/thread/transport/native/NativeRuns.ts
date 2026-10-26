import { Cause, Effect, Layer } from 'effect';
import { RunExecution, ThreadRunStopped } from '../../run/RunExecution';
import { QuestionIntake } from '../../run/scheduler/intake';
import { NATIVE_BINDING, NATIVE_CAPABILITIES } from '../../record';
import type { RunLaunch, Transport } from '../contract';
import { Transports } from '../Transports';
import { makeAdoptions } from './adoptions';
import { ApprovalParking } from '../../run/ApprovalParking';
import { ThreadRunSettlements } from '../../run/ThreadRunSettlements';
import { NativeLaunches } from './launches';

export const nativeTransportLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const execution = yield* RunExecution;
    const launches = yield* NativeLaunches;
    const adoptions = yield* makeAdoptions;
    const intake = yield* QuestionIntake;
    const parking = yield* ApprovalParking;
    yield* (yield* ThreadRunSettlements).subscribe({
      name: 'native parking',
      handle: (event) => Effect.sync(() => parking.release(event.runId)),
    });

    const launch = (input: RunLaunch): Effect.Effect<void> =>
      Effect.suspend(() => {
        if (execution.holds(input.run.id)) return Effect.void;
        return Effect.gen(function* () {
          yield* execution.enlist(input.run, input.run.approvalMode);
          yield* execution.launch(
            input.run,
            execution
              .settling(
                input.run,
                Effect.gen(function* () {
                  yield* execution.confirm(input.run);
                  yield* launches
                    .launch(input.thread, input.run, {
                      fresh: true,
                      oriented: input.oriented,
                      outputOptional: input.outputOptional ? true : undefined,
                    })
                    .pipe(Effect.provideService(QuestionIntake, intake));
                }),
              )
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning('a native run did not open', {
                    runId: input.run.id,
                    threadId: input.thread.id,
                    cause: Cause.pretty(cause),
                  }),
                ),
              ),
          );
        });
      });

    const transport: Transport = {
      adapter: NATIVE_BINDING.adapter,
      declares: { history: NATIVE_CAPABILITIES.history, compaction: NATIVE_CAPABILITIES.compaction },
      words: 'opening',
      runs: {
        launch,
        deliver: () => Effect.void,
        withdraw: () => Effect.succeed('unsent'),
        queued: () => Effect.void,
        holds: (runIds) => runIds.filter((runId) => execution.holds(runId)),
        interrupt: (runId, by) => execution.abort(runId, new ThreadRunStopped(by)),
        adopt: adoptions.adopt,
        reached: () => Effect.void,
      },
    };
    yield* (yield* Transports).register(transport).pipe(Effect.orDie);
  }),
);
