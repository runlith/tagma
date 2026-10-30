import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect, Fiber } from 'effect';
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { FAULT } from '@runlith/acp/agent';
import { claudeSdk } from './sdk.js';

type Module = Parameters<typeof claudeSdk>[0]['module'];

const channelOver = (query: Record<string, unknown>) =>
  claudeSdk({ module: { query: () => query as unknown as Query, getSessionMessages: async () => [] } as unknown as Module }).open({});

const usageOf = (input: number) => ({
  session: {
    total_cost_usd: 0.5,
    model_usage: { m: { inputTokens: input, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, contextWindow: 1000 } },
  },
});

it.effect(
  'an interrupt asks Claude Code to drop the queued words and answers those it dropped, those still queued, and no list without a receipt',
  () =>
    Effect.gen(function* () {
      const asked: unknown[] = [];
      const dropping = yield* channelOver({
        interrupt: async (options: unknown) => (asked.push(options), { still_queued: [], cancelled: ['a'] }),
      });
      expect(yield* dropping.interrupt()).toEqual({ queued: [], dropped: ['a'] });
      expect(asked).toEqual([{ cancelQueued: true }]);
      const older = yield* channelOver({ interrupt: async () => ({ still_queued: ['a', 'b'] }) });
      expect(yield* older.interrupt()).toEqual({ queued: ['a', 'b'], dropped: [] });
      const none = yield* channelOver({ interrupt: async () => undefined });
      expect(yield* none.interrupt()).toEqual({ queued: null, dropped: [] });
    }),
);

it.effect('a message is sent once the SDK wrote it and asks for the next one, not when it is handed over', () =>
  Effect.gen(function* () {
    let prompt: AsyncIterable<SDKUserMessage> | undefined;
    const module = {
      query: (params: { readonly prompt: AsyncIterable<SDKUserMessage> }) => ((prompt = params.prompt), { close: () => {} }),
      getSessionMessages: async () => [],
    } as unknown as Module;
    const channel = yield* claudeSdk({ module }).open({});
    const said = { type: 'user', message: { role: 'user', content: 'words' }, parent_tool_use_id: null } as SDKUserMessage;
    const order: string[] = [];
    const sending = yield* Effect.forkChild(
      Effect.andThen(
        channel.send(said),
        Effect.sync(() => void order.push('sent')),
      ),
    );
    yield* Effect.yieldNow;
    const written = prompt![Symbol.asyncIterator]();
    const read = yield* Effect.promise(() => written.next());
    order.push('written');
    void written.next();
    yield* Fiber.join(sending);
    yield* channel.close();
    expect(read.value).toBe(said);
    expect(order).toEqual(['written', 'sent']);
  }),
);

it.effect('a command lifecycle frame reaches the session as the command and its state, and an unreadable one not at all', () =>
  Effect.gen(function* () {
    const reads = yield* channelOver({
      async *[Symbol.asyncIterator]() {
        yield { type: 'command_lifecycle', command_uuid: 'w', state: 'started' };
        yield { type: 'command_lifecycle', state: 'started' };
      },
    });
    const said = yield* Effect.promise(() => Array.fromAsync(reads.messages));
    expect(said).toEqual([{ type: 'command_lifecycle', uuid: 'w', state: 'started' }]);
  }),
);

it.effect('a side question and a withdrawal are method-not-found where this SDK lacks them, and answer where it has them', () =>
  Effect.gen(function* () {
    const bare = yield* channelOver({});
    expect((yield* Effect.flip(bare.sideQuestions())).code).toBe(FAULT.methodNotFound);
    expect((yield* Effect.flip(bare.withdraw('a'))).code).toBe(FAULT.methodNotFound);
    const full = yield* channelOver({
      askSideQuestion: async (question: string) => ({ response: `re: ${question}`, synthetic: false }),
      cancelAsyncMessage: async (uuid: string) => uuid === 'queued',
    });
    const ask = yield* full.sideQuestions();
    expect(yield* ask('why')).toEqual({ response: 're: why', synthetic: false });
    expect(yield* full.withdraw('queued')).toBe(true);
    expect(yield* full.withdraw('gone')).toBe(false);
  }),
);

it.effect('subscription windows report through the channel with reset instants in epoch seconds', () =>
  Effect.gen(function* () {
    const reads = yield* channelOver({
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'rate_limit_event',
          rate_limit_info: {
            unifiedWindows: {
              five_hour: { utilization: 0.42, resetsAt: 1791753000 },
              seven_day: { utilization: 0.87, resetsAt: 1791842400 },
            },
          },
        };
      },
    });
    yield* Effect.promise(async () => {
      for await (const _message of reads.messages) {
      }
    });
    const reading = yield* reads.quota();
    expect(reading?.windows).toMatchObject([
      { kind: 'session', label: 'five_hour', usedPercent: 42, resetsAt: 1791753000 },
      { kind: 'weekly', label: 'seven_day', usedPercent: 87, resetsAt: 1791842400 },
    ]);
    expect(reading?.source).toBe('reply');
    expect(reading?.observedAt.getTime()).toBe(yield* Clock.currentTimeMillis);
  }),
);

it.effect('status-only quota events carry no new measurement, malformed limits fail typed and later numeric limits recover', () =>
  Effect.gen(function* () {
    const reads = yield* channelOver({
      async *[Symbol.asyncIterator]() {
        yield { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } };
        yield { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 'unknown' } } } };
        yield { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { custom: { utilization: 0.5 } } } };
      },
    });
    const messages = reads.messages[Symbol.asyncIterator]();
    yield* Effect.promise(() => messages.next());
    expect(yield* reads.quota()).toBeNull();
    yield* Effect.promise(() => messages.next());
    expect((yield* Effect.flip(reads.quota())).code).toBe(FAULT.internal);
    yield* Effect.promise(() => messages.next());
    expect((yield* reads.quota())?.windows).toMatchObject([{ kind: 'bucket', label: 'custom', usedPercent: 50 }]);
  }),
);

it.effect('a rejecting limit event names when its window resets in epoch milliseconds, and the next allowing one clears it', () =>
  Effect.gen(function* () {
    const reads = yield* channelOver({
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'rate_limit_event',
          rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', utilization: 1, resetsAt: 1791753000 },
        };
        yield { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } };
      },
    });
    const messages = reads.messages[Symbol.asyncIterator]();
    yield* Effect.promise(() => messages.next());
    expect(reads.rejectedUntil()).toBe(1791753000000);
    expect((yield* reads.quota())?.windows).toMatchObject([{ kind: 'session', usedPercent: 100, resetsAt: 1791753000 }]);
    yield* Effect.promise(() => messages.next());
    expect(reads.rejectedUntil()).toBeNull();
  }),
);

it.effect(
  'the session usage reads as the cumulative reading, as none where the SDK reports none, and fails typed where its shape drifted',
  () =>
    Effect.gen(function* () {
      const reads = yield* channelOver({ usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => usageOf(40) });
      expect(yield* reads.reading()).toMatchObject({ input: 40, output: 2, cost: 0.5 });
      const none = yield* channelOver({});
      expect(yield* none.reading()).toBeNull();
      const drifted = yield* channelOver({ usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({ renamed: {} }) });
      expect((yield* Effect.flip(drifted.reading())).code).toBe(FAULT.internal);
    }),
);
