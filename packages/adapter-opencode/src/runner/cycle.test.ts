import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { hostedAgent } from '@runlith/hosted-runner/agent';
import type { HostedDoor } from '@runlith/hosted-runner/door';
import { OpenCodeSdk } from './channel.js';
import { makeOpenCodeCycle } from './cycle.js';

it.effect('restored history survives a cancelled submission and leaves only after the vendor takes it', () =>
  Effect.gen(function* () {
    const submitted = yield* Deferred.make<void>();
    const cancelled = yield* Deferred.make<void>();
    const received: string[] = [];
    let first = true;
    const sdk = OpenCodeSdk.of({
      open: (_, replacing) =>
        Effect.as(replacing, {
          id: 'session',
          close: Effect.void,
          send: Effect.fnUntraced(function* (input) {
            if (first) {
              first = false;
              yield* Deferred.succeed(submitted, undefined);
              return {
                cancel: Effect.asVoid(Deferred.succeed(cancelled, undefined)),
                wait: Effect.as(Deferred.await(cancelled), { status: 'cancelled' as const }),
              };
            }
            received.push(input.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n'));
            yield* input.taken;
            return { cancel: Effect.void, wait: Effect.succeed({ status: 'finished' as const }) };
          }),
        }),
    });
    const door: HostedDoor = {
      agent: () => Effect.succeed({ prompt: '', web: 'none' }),
      turn: () => Effect.succeed({ prompt: '', context: null, web: 'none' }),
      tools: () => Effect.succeed({ tools: [], names: [] }),
      history: () => Effect.succeed([{ role: 'user', content: [{ type: 'text', text: 'RESTORED_JOURNAL' }] }]),
      call: () => Effect.die('no calls'),
    };
    const cycle = yield* makeOpenCodeCycle(
      door,
      { stderr: () => {}, died: (reason) => Effect.die(reason) },
      {
        model: 'provider/model',
        effort: null,
        parameters: {},
        version: 'test',
      },
    ).pipe(Effect.provideService(OpenCodeSdk, sdk));
    const agent = hostedAgent(
      cycle,
      door,
    )({ update: () => Effect.void, notify: () => Effect.void, request: () => Effect.die('no requests') });
    const session = yield* agent.newSession({ cwd: '/work', mcpServers: [] });
    const prompt = (text: string) => agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text }] });
    const abandoned = yield* Effect.forkChild(prompt('cancel before acceptance'));
    yield* Deferred.await(submitted);
    yield* agent.cancel({ sessionId: session.sessionId });
    expect(yield* Fiber.join(abandoned)).toMatchObject({ stopReason: 'cancelled' });
    expect(yield* prompt('first accepted prompt')).toMatchObject({ stopReason: 'end_turn' });
    expect(received[0]).toContain('RESTORED_JOURNAL');
    expect(yield* prompt('next accepted prompt')).toMatchObject({ stopReason: 'end_turn' });
    expect(received[1]).not.toContain('RESTORED_JOURNAL');
    yield* agent.ended;
  }),
);
