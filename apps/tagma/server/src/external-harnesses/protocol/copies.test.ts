import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { makeThreadAsides } from '@runlith/agent/thread/ThreadAsides';
import type { AgentAside } from '@runlith/agent/AgentAside';
import { Usage } from '@runlith/llm/schema/events';
import { HarnessAsides } from '../../threads/contract/service/engine.js';
import type { SessionCapture } from '../contract/service/copies.js';
import { makeSessionCopies } from './copies.js';

type ObservedCopy = { readonly threadId: string; readonly aside: AgentAside };

const capture = Effect.gen(function* () {
  const at = new Date(yield* Clock.currentTimeMillis).toISOString();
  return {
    threadId: 'thread',
    turn: 'run',
    readerInput: 'reader:run',
    aside: {
      served: { provider: 'subscription', model: 'claude-sonnet-5-5', reasoning: 'low' },
      ask: () => Effect.succeed({ text: 'Held turn', finishReason: 'stop', usage: undefined }),
    },
    reading: {
      usage: Usage.from({ inputTokens: 1_000, outputTokens: 20 }),
      contextWindow: 1_000_000,
      runId: 'run',
      stepNumber: 0,
      provider: 'subscription',
      model: 'claude-sonnet-5-5',
      measuredAt: at,
      sentAt: at,
      cache: { ttlSeconds: 3_600 },
      stale: false,
    },
  } satisfies SessionCapture;
});

it.effect('a warm live session answers captured questions across settlement, and its process exit releases the copy', () =>
  Effect.gen(function* () {
    const held = yield* makeThreadAsides;
    const copies = yield* makeSessionCopies.pipe(Effect.provideService(HarnessAsides, held));
    const input = yield* capture;
    expect(yield* copies.measured(input)).toBe(true);
    const live = held.of(input.threadId);
    expect(live).toMatchObject({ source: 'session', runId: input.turn, readerInput: input.readerInput, expiresAt: 3_600_000 });
    if (live === undefined) return yield* Effect.die('the measured session supplied no copy');
    expect((yield* held.ask(input.threadId, live, { instruction: 'name the turn' })).text).toBe('Held turn');
    const settled: ObservedCopy[] = [];
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        held.watch({
          opened: () => Effect.void,
          forgotten: () => Effect.void,
          settled: (threadId, aside) =>
            Effect.sync(() => {
              settled.push({ threadId, aside });
            }),
        }),
      ),
      (stop) => Effect.sync(stop),
    );
    yield* TestClock.adjust('30 minutes');
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    yield* copies.settled({ ...input, reading: { ...input.reading, sentAt: at, measuredAt: at } });
    expect(held.of(input.threadId)).toMatchObject({ source: 'session', runId: input.turn, expiresAt: 5_400_000 });
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ threadId: input.threadId, aside: { source: 'session', runId: input.turn, expiresAt: 5_400_000 } });
    yield* copies.exited(input.threadId);
    expect(held.of(input.threadId)).toBeUndefined();
  }),
);

it.effect('missing, previous-run, foreign-provider or unpromised context cannot supply a session copy', () =>
  Effect.gen(function* () {
    const held = yield* makeThreadAsides;
    const copies = yield* makeSessionCopies.pipe(Effect.provideService(HarnessAsides, held));
    const input = yield* capture;
    for (const reading of [
      null,
      { ...input.reading, runId: 'past' },
      { ...input.reading, provider: 'another' },
      { ...input.reading, cache: undefined },
    ]) {
      expect(yield* copies.measured({ ...input, reading })).toBe(false);
      expect(held.of(input.threadId)).toBeUndefined();
    }
  }),
);

it.effect('the promised reading expiry cannot be renewed by settlement, and a session exit leaves a native replacement alone', () =>
  Effect.gen(function* () {
    const held = yield* makeThreadAsides;
    const copies = yield* makeSessionCopies.pipe(Effect.provideService(HarnessAsides, held));
    const input = yield* capture;
    yield* copies.measured(input);
    const session = held.of(input.threadId);
    if (session === undefined) return yield* Effect.die('the measured session supplied no copy');
    const native = { ...session, source: 'capture' as const };
    yield* held.hold(input.threadId, native);
    yield* copies.exited(input.threadId);
    expect(held.of(input.threadId)).toBe(native);
    yield* copies.measured(input);
    yield* TestClock.adjust('61 minutes');
    expect(held.of(input.threadId)).toBeUndefined();
    yield* copies.settled(input);
    expect(held.of(input.threadId)).toBeUndefined();
  }),
);
