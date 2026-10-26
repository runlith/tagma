import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { FAULT } from '@runlith/acp/agent';
import type { Session } from './cycle.js';
import type { HostedDoor } from './door.js';
import { Turn } from './turn.js';

it.effect('closing a session settles a prompt still waiting for the hosted turn to open', () =>
  Effect.gen(function* () {
    const reached = yield* Deferred.make<void>();
    const session: Session = {
      id: 'session',
      cwd: '/work',
      busy: () => false,
      configOptions: () => [],
      prepare: () => Effect.die('the hosted turn has not opened'),
      start: () => Effect.die('no prompt may reach the vendor'),
      steer: () => Effect.die('this session gets no steer'),
      configure: () => Effect.die('this session is not configured'),
      cancel: () => Effect.void,
      close: () => Effect.void,
    };
    const door: HostedDoor = {
      agent: () => Effect.die('the session is already open'),
      history: () => Effect.die('the session has no history to seed'),
      tools: () => Effect.succeed({ tools: [], names: [] }),
      call: () => Effect.die('this prompt calls no tool'),
      turn: () => Effect.andThen(Deferred.succeed(reached, undefined), Effect.never),
    };
    const turn = new Turn(door, session);
    const prompt = yield* Effect.forkScoped(Effect.flip(turn.prompt([{ type: 'text', text: 'work' }], undefined)));
    yield* Deferred.await(reached);
    yield* turn.close();
    expect((yield* Fiber.join(prompt)).code).toBe(FAULT.internal);
    expect(turn.busy()).toBe(false);
  }),
);
