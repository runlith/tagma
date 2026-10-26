import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Schema, Stream } from 'effect';
import { ASKS_NEVER } from '../permissions/vocabulary';
import { Agent } from './Agent';
import { makeAgentRunner } from './AgentRunner';
import { RunStop } from './RunStop';
import { builtinMode } from './testing/modes';
import { Tool } from './tool';

it.effect(
  'stopping a run carries the caller’s reason into its tool answer',
  Effect.fnUntraced(function* () {
    const started = yield* Deferred.make<void>();
    const tool = Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_NEVER,
      description: 'Wait until the run stops.',
      parameters: Schema.Struct({}),
      execute: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    });
    const runner = yield* makeAgentRunner({
      models: {
        request: () => ({
          plannedOutputTokens: 0,
          stream: () => Stream.never,
          text: () => Effect.die('unused'),
          object: () => Effect.die('unused'),
        }),
      },
      idleMs: 300_000,
    });
    const agent = new Agent({
      id: 'stop-reason',
      name: 'Stop reason',
      description: 'Exercises a run stopping its invocation.',
      instructions: () => '',
      tools: () => ({ wait: tool }),
      stopWhen: [],
    });
    const handle = yield* runner.run(
      agent,
      {
        runId: 'run',
        stop: new RunStop(),
        ctx: {},
        model: { ownerId: 'owner', provider: 'test', model: null, reasoning: null, switches: {} },
        messages: [],
        approval: { mode: 'trust', interactive: false },
        modeOf: builtinMode('trust'),
      },
      { push: () => Effect.void },
    );
    const waiting = yield* Effect.forkScoped(
      handle.door.settle({
        name: 'wait',
        tool,
        input: {},
        options: { toolCallId: 'call', messages: [] },
      }),
    );
    yield* Deferred.await(started);
    const reason = new Error('The agent harness was disposed.');
    yield* handle.stop(reason);
    expect(yield* Fiber.join(waiting)).toMatchObject({ output: { status: 'cancelled', reason: reason.message } });
    yield* handle.close();
  }),
);
