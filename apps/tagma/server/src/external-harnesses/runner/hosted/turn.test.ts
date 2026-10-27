import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Predicate } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { PromptResult } from '@runlith/acp/methods';
import type { Session } from './cycle.js';
import type { HostedDoor } from './door.js';
import { Turn } from './turn.js';

const openedSession = (answer: Effect.Effect<PromptResult, AgentFault>, prepared: Effect.Effect<void>, takes = true): Session => ({
  id: 'session',
  cwd: '/work',
  busy: () => false,
  configOptions: () => [],
  prepare: () => prepared,
  start: (input) => Effect.succeed(Effect.andThen(takes ? input.taken : Effect.void, answer)),
  steer: () => Effect.die('this session gets no steer'),
  configure: () => Effect.die('this session is not configured'),
  cancel: () => Effect.void,
  close: () => Effect.void,
});

const openedOf = (result: PromptResult): unknown => (Predicate.isObject(result._meta) ? result._meta['tagma/opened'] : undefined);

const openingDoor: HostedDoor = {
  agent: () => Effect.die('the session is already open'),
  history: () => Effect.die('the session has no history to seed'),
  tools: () => Effect.succeed({ tools: [], names: [] }),
  call: () => Effect.die('this prompt calls no tool'),
  turn: () => Effect.succeed({ context: 'the workspace moved', prompt: null, web: 'none' }),
};

it.effect('a prompt answers that its opening reached the agent only once the agent took it, ended or failed', () =>
  Effect.gen(function* () {
    const said = { stopReason: 'end_turn' } satisfies PromptResult;
    const ended = yield* new Turn(openingDoor, openedSession(Effect.succeed(said), Effect.void)).prompt(
      [{ type: 'text', text: 'go' }],
      undefined,
    );
    expect(openedOf(ended)).toBe(true);
    const fault = new AgentFault({ code: FAULT.internal, message: 'overloaded', data: { usage: undefined } });
    const failed = yield* Effect.flip(
      new Turn(openingDoor, openedSession(Effect.fail(fault), Effect.void)).prompt([{ type: 'text', text: 'go' }], undefined),
    );
    expect(failed.data).toMatchObject({ _meta: { 'tagma/opened': true } });
    const withdrawn = yield* new Turn(openingDoor, openedSession(Effect.succeed({ stopReason: 'cancelled' }), Effect.void, false)).prompt(
      [{ type: 'text', text: 'go' }],
      undefined,
    );
    expect([withdrawn.stopReason, openedOf(withdrawn)]).toEqual(['cancelled', undefined]);
    const preparing = yield* Deferred.make<void>();
    const held = new Turn(
      openingDoor,
      openedSession(Effect.succeed(said), Effect.andThen(Deferred.succeed(preparing, undefined), Effect.never)),
    );
    const prompt = yield* Effect.forkScoped(held.prompt([{ type: 'text', text: 'go' }], undefined));
    yield* Deferred.await(preparing);
    yield* held.cancel();
    const cancelled = yield* Fiber.join(prompt);
    expect([cancelled.stopReason, openedOf(cancelled)]).toEqual(['cancelled', undefined]);
  }),
);

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
