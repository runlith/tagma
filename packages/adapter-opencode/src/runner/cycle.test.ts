import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { FAULT } from '@runlith/acp/agent';
import { hostedAgent } from '@runlith/hosted-runner/agent';
import type { HostedDoor } from '@runlith/hosted-runner/door';
import { OpenCodeSdk } from './channel.js';
import { makeOpenCodeCycle } from './cycle.js';

it.effect('a vendor execution failure is an ACP failure with its classification and leaves a terminal session usable', () =>
  Effect.gen(function* () {
    let failed = true;
    const sdk = OpenCodeSdk.of({
      open: (_, replacing) =>
        Effect.as(replacing, {
          id: 'session',
          close: Effect.void,
          send: () =>
            Effect.sync(() => {
              const outcome = failed
                ? {
                    status: 'error' as const,
                    detail: 'provider capacity',
                    failure: {
                      stage: 'opencode.turn',
                      type: 'provider.error',
                      retryable: true,
                      modelStarted: false,
                      reason: { family: 'rate-limit' as const },
                    },
                  }
                : { status: 'finished' as const };
              failed = false;
              return { cancel: Effect.void, wait: Effect.succeed(outcome) };
            }),
        }),
    });
    const door: HostedDoor = {
      agent: () => Effect.succeed({ prompt: 'system', web: 'none' }),
      turn: () => Effect.succeed({ prompt: 'system', context: null, web: 'none' }),
      tools: () => Effect.succeed({ tools: [], names: [] }),
      history: () => Effect.succeed([]),
      call: () => Effect.die('No tools admitted'),
    };
    const cycle = yield* makeOpenCodeCycle(
      door,
      { stderr: () => {}, died: (reason) => Effect.die(reason) },
      { model: 'provider/model', effort: null, parameters: {}, version: 'test' },
    ).pipe(Effect.provideService(OpenCodeSdk, sdk));
    const agent = hostedAgent(
      cycle,
      door,
    )({ update: () => Effect.void, notify: () => Effect.void, request: () => Effect.die('No vendor permissions') });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    const params = { sessionId: session.sessionId, prompt: [{ type: 'text' as const, text: 'go' }] };
    const failure = yield* Effect.flip(agent.prompt(params));
    expect(failure).toMatchObject({
      code: FAULT.internal,
      message: 'provider capacity',
      data: { 'tagma/failure': { reason: { family: 'rate-limit' }, retryable: true, modelStarted: false } },
    });
    expect(yield* agent.prompt(params)).toMatchObject({ stopReason: 'end_turn' });
    yield* agent.ended;
  }),
);
