import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Fiber } from 'effect';
import { USER_QUESTION_TOOL_NAME } from '@runlith/agent/transcript/parts';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { claudeLogin, hostedDefaults } from '../claudeLogin.js';
import { until } from './protocolRig.js';
import { heldTurn } from './hostedTurn.js';
import { ProtocolWorld, protocolWorld } from './protocolWorld.js';

layer(protocolWorld({ name: 'hosted-stop', prepare: (world) => Effect.andThen(claudeLogin(world), hostedDefaults(world)) }), {
  excludeTestServices: true,
})('a stopped hosted run', (it) => {
  it.effect('a call still waiting when the operator stops the run answers that the run ended', () =>
    Effect.gen(function* () {
      const { world, changes } = yield* ProtocolWorld;
      const harness = Context.get(world.runtime.owners, ThreadHarness);
      const { threadId, report, sealed, called, release } = yield* heldTurn('stopped', 'bypass');
      yield* called('reveal', 'tool_search', { query: `select:${USER_QUESTION_TOOL_NAME}` });
      const input = { questions: [{ prompt: 'Choose a colour', options: [{ value: 'blue', label: 'Blue' }] }] };
      const asking = yield* Effect.forkScoped(sealed('question', USER_QUESTION_TOOL_NAME, input));
      yield* until(
        Effect.map(harness.runs.questions().open(threadId), (open) => (open.length > 0 ? true : null)),
        'the question opened',
        report,
        changes(threadId),
      );
      yield* harness.threads.handle(threadId, 'operator').stop();
      const answer = yield* Fiber.join(asking);
      expect({ status: answer.status, body: answer.body }).toMatchObject({ status: 200, body: { status: 'called', failed: true } });
      yield* release;
    }),
  );
});
