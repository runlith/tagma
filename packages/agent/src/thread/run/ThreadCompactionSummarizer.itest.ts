import { openModelClient } from '@runlith/llm/models/client';
import { it } from '@runlith/effect-test';
import { describe, expect } from 'bun:test';
import { Effect, Stream } from 'effect';
import * as LLM from '@runlith/llm/call';
import { answering } from '@runlith/llm/route/transport/answering';
import { modelCatalog } from '@runlith/llm/models/catalog';
import type { ModelCapacity } from '@runlith/llm/models/description';
import { recordedRegistrations } from '@runlith/builtin-catalog/registrations';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { LLMError, QuotaExceededReason } from '@runlith/llm/schema/errors';
import { LLMResponse, Usage } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import type { ModelRequest, ModelRequestInput } from '../../agent/modelPort';
import { modelRequester } from '../../agent/ModelRequests';
import { ThreadNoSummarizerError, type ThreadCompactionStorage } from '../storage/compaction';
import type { CompactionModels } from '../compaction/CompactionModels';
import { lookupModels } from '../compaction/lookupModels';
import type { ThreadCompactionPolicy } from '../compaction/policy';
import type { ThreadSummarizing } from '../compaction/summarizer';
import { makeThreadSummaryStrategy } from '../compaction/summaryStrategy';
import { makeThreadDigestStrategy } from '../compaction/digestStrategy';
import { makeThreadCompaction, type ThreadCompaction } from './ThreadCompaction';
import { prepare } from '@runlith/llm/route/client';
const policy: ThreadCompactionPolicy = {
  compactionTrigger: { strategy: 'reserve-output' },
  compactionOverrides: [],
  bufferTokens: 20_000,
  imageTokens: 0,
  maxRecentTokens: 8_000,
  minRecentTokens: 2_000,
  maxOpeningTokens: 8_000,
  recentFraction: 0.25,
  recentUserTurns: 2,
  toolPruneProtectShare: 0.2,
};
const text = {
  checkpointMarker: 'Continue from the anchored thread state below.',
  prunedToolOutput: '[Old tool result content cleared]',
  overflowMediaGuidance: 'Attached media was omitted from this retry.',
  omittedMedia: (mediaType: string | undefined) => `[Attached ${mediaType ?? 'media'} omitted.]`,
};
const checkpoints = {
  latestCheckpoint: () => Effect.succeed(null),
  prunedToolCalls: () => Effect.succeed(new Set<string>()),
  prunedToolCallVolume: () => Effect.succeed({ count: 0, tokens: 0 }),
  compactionCount: () => Effect.succeed(0),
  markToolCallsPrunedIn: () => Effect.void,
  retirePrunedToolCallsIn: () => Effect.void,
  writeCheckpointIn: () => Effect.die(new Error('a compaction proposes its fold; the settling owner writes it')),
} satisfies ThreadCompactionStorage;
const credentials: ModelCredentials = {
  apiKey: async () => 'synthetic-key',
  accessToken: async () => 'synthetic-token',
  credential: async () => ({
    accessToken: 'token',
    refreshToken: 'synthetic',
    expiresAt: 0,
    scope: '',
    account: { uuid: 'synthetic-account', email: 'synthetic@example.test' },
    organization: { uuid: 'organization-uuid', name: '' },
    accountId: undefined,
  }),
};
const subscription = recordedRegistrations.subscription;
const catalog = modelCatalog([subscription]);
const SUMMARY = `Summary:\n${'The first task was answered and the second task set the plan the next turn follows. '.repeat(12).trim()}`;
type Asked = {
  readonly provider: string;
  readonly model: string | null | undefined;
  readonly account: string | undefined;
  readonly cacheGroup: string | undefined;
  readonly prompt: string;
};
type Reply =
  | {
      readonly text: string;
    }
  | {
      readonly fails: LLMError;
    };
type World = {
  readonly compaction: ThreadCompaction;
  readonly asked: Asked[];
  readonly sent: number[];
};
const world = Effect.fnUntraced(function* (
  options: {
    readonly replies?: Reply[];
    readonly windows?: Record<string, ModelCapacity>;
  } = {},
) {
  const asked: Asked[] = [];
  const sent: number[] = [];
  const replies = options.replies ?? [];
  const fetch = answering((request) => {
    const path = new URL(request.url).pathname;
    if (path !== '/v1/messages') return Response.json({ data: [], next_page: null });
    sent.push(1);
    return new Response(
      [
        { type: 'message_start', message: { id: 'msg_summary', usage: { input_tokens: 10 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: SUMMARY },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } },
        { type: 'message_stop' },
      ]
        .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        .join(''),
      {
        headers: { 'content-type': 'text/event-stream', 'request-id': 'req_summary' },
      },
    );
  });
  const requester = modelRequester(catalog, credentials, yield* openModelClient(fetch));
  const foreign = (input: ModelRequestInput): ModelRequest => ({
    plannedOutputTokens: 1_000,
    signedAccount: () => input.account ?? 'default-key',
    stream: () => Stream.die(new Error('A summary never streams.')),
    object: () => Effect.die(new Error('A summary answers text.')),
    text: (one) =>
      Effect.suspend(() => {
        asked.push({
          provider: input.provider,
          model: input.model,
          account: input.account,
          cacheGroup: input.cacheGroup,
          prompt:
            one.messages?.map((message) => message.content.map((part) => (part.type === 'text' ? part.text : '')).join('')).join('') ?? '',
        });
        const reply = replies.shift() ?? { text: SUMMARY };
        if ('fails' in reply) return Effect.fail(reply.fails);
        return Effect.succeed(
          new LLMResponse({
            message: Message.assistant(reply.text),
            events: [{ type: 'text-delta', id: 'summary', text: reply.text }],
            usage: new Usage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
            finishReason: 'stop',
          }),
        );
      }),
  });
  const models: CompactionModels = lookupModels({
    request: (input) => (input.provider === 'subscription' ? requester.request(input) : foreign(input)),
    capacity: (provider, model) =>
      provider === 'subscription'
        ? catalog.textModelCapacity(provider, model)
        : (options.windows?.[String(model)] ?? { context: 200_000, output: 32_000 }),
    cacheLifetime: () => ({ promisedSeconds: null, prior: null }),
    compactionTrigger: () => undefined,
    modelId: (provider, model) => (provider === 'subscription' ? catalog.resolveTextModel(provider, model).id : (model ?? provider)),
  });
  return {
    compaction: makeThreadCompaction({
      models,
      checkpoints,
      policy: () => Effect.succeed(policy),
      strategy: makeThreadSummaryStrategy({ models, prompt: { instructions: 'Summarize.', template: '## State' } }),
      recovery: makeThreadDigestStrategy(),
      text,
    }),
    asked,
    sent,
  };
});
const history = [
  Message.user('First task'),
  Message.make({ id: 'msg_first', requestId: 'req_first', role: 'assistant', content: 'First answer' }),
  Message.user('Second task'),
  Message.make({ id: 'msg_last', requestId: 'req_last', role: 'assistant', content: 'Last answer' }),
];
const claudeThread = (sourceMessages: readonly Message[] = history) => ({
  threadId: crypto.randomUUID(),
  runId: crypto.randomUUID(),
  ownerId: 'owner',
  account: 'thread-account',
  cacheGroup: crypto.randomUUID(),
  provider: 'subscription',
  model: 'claude-sonnet-5-5',
  reasoning: 'high',
  switches: {},
  sourceMessages,
  keep: 'the plan',
  envelope: Effect.succeed({
    instructions: 'Caller instructions',
    tools: [],
    transcriptLocation: '/synthetic/transcript.jsonl',
    lower: (messages: readonly Message[]) => Effect.succeed(messages),
  }),
});
const deepseek = { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoning: null, account: 'key-1' } as const;
const foreign = (
  members: Extract<
    ThreadSummarizing,
    {
      kind: 'foreign';
    }
  >['members'],
  skipped: Extract<
    ThreadSummarizing,
    {
      kind: 'foreign';
    }
  >['skipped'] = [],
  reason: ThreadSummarizing['reason'] = 'cold',
): ThreadSummarizing => ({ kind: 'foreign', reason, members, skipped });
const quota = () =>
  new LLMError({ module: 'test', method: 'text', reason: new QuotaExceededReason({ message: 'The weekly window is spent.' }) });
const nextTurnMessages = Effect.fnUntraced(function* (folded: readonly Message[]) {
  const selected = yield* subscription.profile.model({
    ownerId: 'owner',
    model: 'claude-sonnet-5-5',
    credentials,
    cacheGroup: crypto.randomUUID(),
    lane: 'main',
  });
  const prepared = yield* prepare<{
    messages: unknown;
  }>(LLM.request({ model: selected, system: 'Caller instructions', messages: [...folded, Message.user('Third task')] }));
  return prepared.body.messages;
});
describe('a compaction summarized by another model than the thread’s', () => {
  it.live(
    'a thread whose profile owns its compaction folds through the host strategy on the summarizer, and its next request continues exactly as after its own form',
    Effect.fnUntraced(function* () {
      const own = yield* world();
      const native = yield* own.compaction.compact({ ...claudeThread(), summarizing: { kind: 'own', reason: 'warm' } });
      expect(own.sent).toHaveLength(1);
      expect(native.summarizer).toMatchObject({
        provider: 'subscription',
        model: 'claude-sonnet-5-5',
        own: true,
        reason: 'warm',
        passes: 1,
      });
      const other = yield* world();
      const folded = yield* other.compaction.compact({ ...claudeThread(), summarizing: foreign([deepseek]) });
      expect(other.sent).toHaveLength(0);
      expect(other.asked).toHaveLength(1);
      expect(other.asked[0]).toMatchObject({
        provider: 'opencode-go',
        model: 'deepseek-v4.1-flash',
        account: 'key-1',
        cacheGroup: undefined,
      });
      expect(folded.summarizer).toEqual({
        provider: 'opencode-go',
        model: 'deepseek-v4.1-flash',
        reasoning: null,
        account: 'key-1',
        own: false,
        reason: 'cold',
        skipped: [],
        passes: 1,
        usage: expect.objectContaining({ inputTokens: 100 }),
      });
      const head = (result: typeof folded) => result.settlement?.replaced.messages.find((message) => message.compaction !== undefined);
      expect(head(folded)?.compaction).toMatchObject({
        mode: 'manual',
        keep: 'the plan',
        transcriptLocation: '/synthetic/transcript.jsonl',
        preservedCount: 1,
        previousMessageId: 'msg_last',
        previousRequestId: 'req_last',
      });
      expect(folded.settlement?.replaced.keepFrom).toBe(native.settlement?.replaced.keepFrom);
      const continued = (result: typeof folded) =>
        nextTurnMessages([...(result.settlement?.replaced.messages ?? []), ...history.slice(result.settlement?.replaced.keepFrom)]);
      const next = yield* continued(folded);
      if (!Array.isArray(next)) return yield* Effect.die('Expected the provider message array');
      expect(next[0]).toMatchObject({ role: 'user' });
      expect(JSON.stringify(next)).toContain(SUMMARY.slice('Summary:\n'.length));
      expect<unknown>(next).toEqual(yield* continued(native));
    }),
  );
  it.live(
    'a thread that stores no model is its provider’s default: naming that model, or a chain member equal to it, compacts through the thread’s own form',
    Effect.fnUntraced(function* () {
      const own = catalog.defaultTextModelId('subscription');
      const thread = { ...claudeThread(), model: null };
      const { compaction, asked, sent } = yield* world();
      const named = yield* compaction.summarizing({
        threadId: thread.threadId,
        provider: 'subscription',
        model: null,
        running: false,
        named: { provider: 'subscription', model: own },
      });
      const byName = yield* compaction.compact({ ...thread, summarizing: named });
      const byChain = yield* compaction.compact({
        ...thread,
        summarizing: foreign([{ provider: 'subscription', model: own, reasoning: null }]),
      });
      expect(named).toEqual({ kind: 'own', reason: 'named' });
      expect(asked).toHaveLength(0);
      expect(sent).toHaveLength(2);
      expect(byName.summarizer).toMatchObject({ own: true, reason: 'named' });
      expect(byChain.summarizer).toMatchObject({ own: true, reason: 'cold' });
    }),
  );
  it.live(
    'a provider failure falls through to the next member, and the entry names every member skipped with its reason',
    Effect.fnUntraced(function* () {
      const { compaction, asked } = yield* world({ replies: [{ fails: quota() }] });
      const muse = { provider: 'muse', model: 'muse-spark-1.3', reasoning: null } as const;
      const skippedBefore = { provider: 'stepfun', model: 'step-3.7-flash', reason: 'not-connected' } as const;
      const result = yield* compaction.compact({ ...claudeThread(), summarizing: foreign([muse, deepseek], [skippedBefore]) });
      expect(asked.map((call) => call.provider)).toEqual(['muse', 'opencode-go']);
      expect(result.summarizer).toMatchObject({
        provider: 'opencode-go',
        skipped: [skippedBefore, { provider: 'muse', model: 'muse-spark-1.3', reason: 'quota' }],
      });
      expect(result.settlement).toBeDefined();
    }),
  );
  it.live(
    'a named summarizer is not replaced: its failure fails the compaction as its own',
    Effect.fnUntraced(function* () {
      const failure = quota();
      const { compaction, asked } = yield* world({ replies: [{ fails: failure }] });
      const refused = yield* Effect.flip(compaction.compact({ ...claudeThread(), summarizing: foreign([deepseek], [], 'named') }));
      expect(asked).toHaveLength(1);
      expect(refused).toMatchObject({ _tag: 'ThreadSummaryFailed', reason: 'model', failure });
    }),
  );
  it.live(
    'when every member fails the compaction refuses no-summarizer naming each, and nothing reaches the thread’s own model',
    Effect.fnUntraced(function* () {
      const { compaction, sent } = yield* world({ replies: [{ fails: quota() }, { fails: quota() }] });
      const muse = { provider: 'muse', model: 'muse-spark-1.3', reasoning: null } as const;
      const refused = yield* Effect.flip(compaction.compact({ ...claudeThread(), summarizing: foreign([muse, deepseek]) }));
      expect(refused).toBeInstanceOf(ThreadNoSummarizerError);
      expect(refused).toMatchObject({
        skipped: [
          { provider: 'muse', reason: 'quota' },
          { provider: 'opencode-go', reason: 'quota' },
        ],
      });
      expect(sent).toHaveLength(0);
    }),
  );
  it.live(
    'a summarizer whose window is smaller than the covered history folds it in the passes the estimate announced, each on the previous summary',
    Effect.fnUntraced(function* () {
      const long = (label: string) => `${label}: ${'a line of the work this turn carried out, kept verbatim. '.repeat(35)}`;
      const turns = Array.from({ length: 10 }, (_, index) => [
        Message.user(long(`ask ${index}`)),
        Message.assistant(long(`answer ${index}`)),
      ]).flat();
      const small = { provider: 'small', model: 'small-1', reasoning: null } as const;
      const { compaction, asked } = yield* world({ windows: { 'small-1': { context: 6_000, output: 1_000 } } });
      const thread = {
        threadId: crypto.randomUUID(),
        runId: crypto.randomUUID(),
        ownerId: 'owner',
        provider: 'plain',
        model: 'plain-1',
        reasoning: null,
        switches: {},
        sourceMessages: turns,
      };
      const estimate = yield* compaction.estimate({
        ...thread,
        account: null,
        fixedTokens: 0,
        history: turns,
        candidates: [small],
      });
      const result = yield* compaction.compact({ ...thread, summarizing: foreign([small]) });
      const announced = estimate.candidates[0]?.passes ?? 0;
      expect(announced).toBeGreaterThan(1);
      expect(result.summarizer?.passes).toBe(announced);
      expect(asked).toHaveLength(result.summarizer?.passes ?? 0);
      expect(asked[1]?.prompt).toContain(SUMMARY);
      expect(result.settlement?.checkpoint?.coveredMessageCount).toBe(16);
    }),
  );
});
