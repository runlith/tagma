import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import type { Cycle } from './cycle.js';
import { hostedAgent } from './agent.js';
import { clientSession, type ClientDriver } from './client.js';
import type { HostedDoor } from './door.js';
import { Options } from './options.js';

const open = Effect.fnUntraced(function* (send: ClientDriver['send']) {
  const scope = yield* Effect.scope;
  const options = new Options({ model: 'model', effort: null, parameters: {}, version: 'test' }, false);
  const door: HostedDoor = {
    agent: () => Effect.succeed({ prompt: '', web: 'none' }),
    turn: () => Effect.succeed({ prompt: '', context: null, web: 'none' }),
    tools: () => Effect.succeed({ names: [], tools: [], dispatch: false }),
    history: () => Effect.succeed([]),
    call: () => Effect.die('no calls'),
    close: () => Effect.die('no close'),
  };
  const process = { stderr: () => {}, died: (reason: string) => Effect.die(reason) };
  const cycle: Cycle = {
    initialize: { protocolVersion: 1 },
    extensions: [],
    modes: { currentModeId: 'agent', availableModes: [] },
    open: (opening, outlet, replacing) =>
      Effect.andThen(
        replacing,
        clientSession(
          {
            id: opening.id,
            cwd: opening.cwd,
            configOptions: options.options,
            configure: options.configure.bind(options),
            send,
            close: Effect.void,
          },
          door,
          process,
          outlet,
          scope,
        ),
      ),
  };
  const agent = hostedAgent(
    cycle,
    door,
  )({ update: () => Effect.void, notify: () => Effect.void, request: () => Effect.die('no requests') });
  const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
  return { agent, id: session.sessionId };
});

it.effect('cancel during submission cancels the accepted run and the next turn remains usable', () =>
  Effect.gen(function* () {
    const sending = yield* Deferred.make<void>();
    const accepted = yield* Deferred.make<void>();
    const cancelled = yield* Deferred.make<void>();
    let first = true;
    const { agent, id } = yield* open(
      Effect.fnUntraced(function* () {
        if (!first) return { cancel: Effect.void, wait: Effect.succeed({ status: 'finished' as const }) };
        first = false;
        yield* Deferred.succeed(sending, undefined);
        yield* Deferred.await(accepted);
        return {
          cancel: Effect.asVoid(Deferred.succeed(cancelled, undefined)),
          wait: Effect.as(Deferred.await(cancelled), { status: 'cancelled' as const }),
        };
      }),
    );
    const running = yield* Effect.forkChild(agent.prompt({ sessionId: id, prompt: [{ type: 'text', text: 'first' }] }));
    yield* Deferred.await(sending);
    yield* agent.cancel({ sessionId: id });
    yield* Deferred.succeed(accepted, undefined);
    expect(yield* Fiber.join(running)).toMatchObject({ stopReason: 'cancelled' });
    expect(yield* agent.prompt({ sessionId: id, prompt: [{ type: 'text', text: 'second' }] })).toMatchObject({ stopReason: 'end_turn' });
    const configured = yield* agent.configure!({ sessionId: id, configId: 'effort', value: 'high' });
    expect(configured.configOptions.find((option) => option.id === 'effort')?.currentValue).toBe('high');
    expect(yield* Effect.flip(agent.configure!({ sessionId: id, configId: 'parameters', value: '{"unknown":"on"}' }))).toMatchObject({
      code: -32602,
    });
    yield* agent.ended;
  }),
);

it.effect('a failed execution retains its usage and failure classification, then accepts another turn', () =>
  Effect.gen(function* () {
    let first = true;
    const { agent, id } = yield* open(() =>
      Effect.sync(() => {
        const outcome = first
          ? {
              status: 'error' as const,
              detail: 'capacity refusal',
              usage: { totalTokens: 30, inputTokens: 20, outputTokens: 10 },
              failure: {
                stage: 'vendor.turn',
                type: 'RateLimitError',
                retryable: true,
                modelStarted: false,
                reason: { family: 'rate-limit' as const },
              },
            }
          : { status: 'finished' as const };
        first = false;
        return { cancel: Effect.void, wait: Effect.succeed(outcome) };
      }),
    );
    const params = { sessionId: id, prompt: [{ type: 'text' as const, text: 'go' }] };
    expect(yield* Effect.flip(agent.prompt(params))).toMatchObject({
      code: -32603,
      message: 'capacity refusal',
      data: {
        'tagma/failure': { reason: { family: 'rate-limit' }, retryable: true, modelStarted: false },
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      },
    });
    expect(yield* agent.prompt(params)).toMatchObject({ stopReason: 'end_turn' });
    yield* agent.ended;
  }),
);
