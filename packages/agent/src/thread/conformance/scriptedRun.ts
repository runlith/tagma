import { Deferred, Effect, Fiber, Stream } from 'effect';
import type { AgentEvent } from '../../agent/AgentEvent';
import type { AgentSink } from '../../agent/AgentRunner';
import type { AgentRunBroke } from '../../agent/AgentFailure';
import type { ThreadAgentRunHandle } from '../agents/ThreadAgent';

export type ScriptedRun = Omit<ThreadAgentRunHandle, 'close' | 'withheld' | 'stop'> & {
  readonly events: Stream.Stream<AgentEvent, AgentRunBroke>;
  readonly stop?: ThreadAgentRunHandle['stop'];
};

export const playRun = Effect.fn(function* (script: ScriptedRun, sink: AgentSink) {
  const delivered = Deferred.makeUnsafe<void, AgentRunBroke>();
  const producer = yield* Effect.forkDetach(
    Effect.flatMap(Effect.exit(Stream.runForEach(script.events, (event) => sink.push(event))), (exit) => Deferred.done(delivered, exit)),
  );
  const settled = <A>(value: Effect.Effect<A, AgentRunBroke>) =>
    Effect.map(Effect.all([value, Deferred.await(delivered)], { concurrency: 2 }), ([result]) => result);
  return {
    instructions: script.instructions,
    catalog: script.catalog,
    withheld: [],
    door: script.door,
    completedSteps: script.completedSteps,
    output: {
      text: settled(script.output.text),
      steps: settled(script.output.steps),
      usage: settled(script.output.usage),
      finishReason: settled(script.output.finishReason),
      response: settled(script.output.response),
    },
    stop: script.stop ?? (() => Effect.void),
    close: () => Effect.andThen(Fiber.interrupt(producer), script.door.close()),
  } satisfies ThreadAgentRunHandle;
});
