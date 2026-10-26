import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Deferred, Effect, Exit, Fiber, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Message } from '@runlith/llm/schema/messages';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity, type CachePolicy } from '@runlith/llm/schema/options';
import type { LLMEvent } from '@runlith/llm/schema/events';
const identity = (model: string) => new ModelIdentity({ provider: ProviderID.make('p'), model: ModelID.make(model) });
import { agentAside, type AgentAside } from '../agent/AgentAside';
import type { ModelRequest } from '../agent/modelPort';
import { makeThreadAsides } from './ThreadAsides';
const answering: readonly LLMEvent[] = [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', text: 'TITLE: a name' },
  { type: 'text-end', id: 't' },
  { type: 'finish', reason: 'stop' },
];
function prompt(options: {
  readonly cache?: CachePolicy;
  readonly runId?: string;
  readonly sentAt?: number;
  readonly model?: string;
  readonly account?: string;
  readonly events?: readonly LLMEvent[];
  readonly opened?: Effect.Effect<void>;
  readonly pending?: () => void;
}): AgentAside {
  const request: ModelRequest = {
    plannedOutputTokens: 0,
    origin: identity(options.model ?? 'm'),
    cache: options.cache,
    signedAccount: options.account === undefined ? undefined : () => options.account,
    stream: () => {
      if (options.pending === undefined) return Stream.fromIterable(options.events ?? answering);
      const open: Stream.Stream<LLMEvent, never> = Stream.concat(
        Stream.fromIterable<LLMEvent>([{ type: 'text-start', id: 't' }]),
        Stream.fromEffect(options.opened ?? Effect.void).pipe(Stream.drain, Stream.concat(Stream.never)),
      );
      return Stream.ensuring(
        open,
        Effect.sync(() => options.pending?.()),
      );
    },
    text: () => Effect.die(new Error('not used')),
    object: () => Effect.die(new Error('not used')),
  };
  return agentAside({
    runId: options.runId ?? 'run-1',
    stepNumber: 0,
    request,
    messages: [Message.user('build the thing')],
    tools: {},
    stallMs: 1000,
    sentAt: options.sentAt ?? 0,
  });
}
it.effect(
  'a prompt whose call named a cache lifetime is dropped when that lifetime, counted from the send, runs out',
  Effect.fnUntraced(function* () {
    const asides = yield* makeThreadAsides;
    yield* TestClock.adjust('20 minutes');
    yield* asides.hold('t1', prompt({ cache: { ttlSeconds: 3600 } }));
    const warm = asides.of('t1') !== undefined;
    yield* TestClock.adjust('39 minutes');
    const beforeExpiry = asides.of('t1') !== undefined;
    yield* TestClock.adjust('2 minutes');
    const after = asides.of('t1') !== undefined;
    yield* asides.hold('t1', prompt({ cache: { ttlSeconds: 3600 } }));
    expect({ warm, beforeExpiry, after, expiredOnArrival: asides.of('t1') !== undefined }).toEqual({
      warm: true,
      beforeExpiry: true,
      after: false,
      expiredOnArrival: false,
    });
  }),
);
it.effect(
  "a new run's capture replaces the previous one, and the previous run settling leaves it",
  Effect.fnUntraced(function* () {
    const asides = yield* makeThreadAsides;
    yield* asides.hold('t1', prompt({ runId: 'run-1' }));
    yield* asides.hold('t1', prompt({ runId: 'run-2' }));
    yield* asides.settled('t1', 'run-1');
    expect(asides.of('t1')?.runId).toBe('run-2');
  }),
);
it.effect(
  'a prompt whose lifetime is the vendor default is released when its run settles',
  Effect.fnUntraced(function* () {
    const asides = yield* makeThreadAsides;
    yield* asides.hold('t1', prompt({ cache: 'auto' }));
    yield* TestClock.adjust('24 hours');
    const beforeSettlement = asides.of('t1') !== undefined;
    yield* asides.settled('t1', 'run-other');
    const afterOther = asides.of('t1') !== undefined;
    yield* asides.settled('t1', 'run-1');
    expect({ beforeSettlement, afterOther, afterOwnRun: asides.of('t1') !== undefined }).toEqual({
      beforeSettlement: true,
      afterOther: true,
      afterOwnRun: false,
    });
  }),
);
it.effect(
  'a prompt whose call named a lifetime keeps it across its run settling',
  Effect.fnUntraced(function* () {
    const asides = yield* makeThreadAsides;
    yield* asides.hold('t1', prompt({ cache: { ttlSeconds: 3600 } }));
    yield* asides.settled('t1', 'run-1');
    expect(asides.of('t1') !== undefined).toBe(true);
  }),
);
it.effect(
  'a held prompt is refused once the thread would call a different model or account',
  Effect.fnUntraced(function* () {
    const asides = yield* makeThreadAsides;
    yield* asides.hold('t1', prompt({ model: 'opus', account: 'work' }));
    const same = asides.of('t1', { origin: identity('opus'), account: 'work', cache: undefined });
    const otherModel = asides.of('t1', { origin: identity('sonnet'), account: 'work', cache: undefined });
    const otherAccount = asides.of('t1', { origin: identity('opus'), account: 'personal', cache: undefined });
    expect({ same: same !== undefined, otherModel: otherModel !== undefined, otherAccount: otherAccount !== undefined }).toEqual({
      same: true,
      otherModel: false,
      otherAccount: false,
    });
  }),
);
it.effect(
  'a question in flight is cancelled when its thread is forgotten',
  Effect.fnUntraced(function* () {
    const asides = yield* makeThreadAsides;
    let released = false;
    const opened = yield* Deferred.make<void>();
    const held = prompt({
      opened: Deferred.succeed(opened, undefined),
      pending: () => {
        released = true;
      },
    });
    yield* asides.hold('t1', held);
    const asking = yield* Effect.forkScoped(asides.ask('t1', held, { instruction: 'name it' }));
    yield* Deferred.await(opened);
    const beforeForget = asking.pollUnsafe();
    yield* asides.forget('t1');
    const ended = yield* Fiber.await(asking);
    expect({
      stillOpen: beforeForget === undefined,
      interrupted: Exit.isFailure(ended) && Cause.hasInterruptsOnly(ended.cause),
      released,
    }).toEqual({ stillOpen: true, interrupted: true, released: true });
  }),
);
