import { openModelClient } from '@runlith/llm/models/client';
import { it } from '@runlith/effect-test';
import { describe, expect, test } from 'bun:test';
import { Cause, Clock, Context, Deferred, Effect, Exit, Fiber, Schema, Stream } from 'effect';
import type { HttpClient } from 'effect/http';
import * as AnthropicMessages from '@runlith/llm/protocols/anthropic-messages';
import type { ModelRequest } from '../../agent/modelPort';
import { modelRequester } from '../../agent/ModelRequests';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { recordedRegistrations } from '@runlith/builtin-catalog/registrations';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import {
  ThreadCompactionExhaustedError,
  type ThreadCheckpointWrite,
  type ThreadCompactionStorage,
  type ThreadPrunedToolCall,
  ThreadCompactionConflictError,
  ThreadCompactionOffError,
  ThreadSummaryFailedError,
} from '../storage/compaction';
import { LLMResponse, Usage } from '@runlith/llm/schema/events';
import { LLMError, RateLimitReason } from '@runlith/llm/schema/errors';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import { Message, ToolCallPart, ToolDefinition, ToolResultPart } from '@runlith/llm/schema/messages';
import type { FinishReason } from '@runlith/llm/schema/ids';
import { type AgentSkillPool, loadedAgentSkillIds } from '../../agent/AgentSkill';
import { LOAD_SKILL_TOOL } from '../../agent/skillWords';
import { agentOriginOf, agentRuntimeGuidanceMessage, agentSignalMessage, withAgentOrigin, agentInputSkills } from '../../agent/AgentSignal';
import { pairedForProvider } from './toolPairing';
import { ThreadNotFoundError } from '../storage/aggregate';
import { RegistryAbsent } from '../../registry/Registry';
import { ThreadCallBroke } from '../ThreadBorder';
import { makeThreadCompaction, ThreadCompactor, type ThreadCompaction, type ThreadCompactionDecision } from './ThreadCompaction';
import { projectThreadOverflowRecovery } from '../compaction/overflow';
import { estimateThreadTokens } from '../compaction/measurement';
import { type ThreadCompactionPolicy, resolveCompactionTrigger, threadUsableTokens } from '../compaction/policy';
import type { ModelCompactionTrigger } from '@runlith/llm/models/description';
import { ThreadRequestMeter } from '../compaction/ThreadRequestMeter';
import { makeThreadContextAnchors } from './ThreadContextAnchor';
import { ThreadCompactionRuns } from './ThreadCompactionRuns';
import { ThreadAttachments } from '../ThreadPorts';
import { projectToolResultMessages } from '../../agent/ToolOutput';
import type { AgentHostFailed } from '../../agent/AgentFailure';
import type { ThreadCompactionEntry } from '../../transcript/entries';
import type { ThreadContextReading } from '../rows';
import { selectThreadCompactionPrefix } from '../compaction/prefix';
import { projectThreadHistory, threadCheckpointHead } from '../compaction/projection';
import { pictureLocations, pruneToolOutputs, clearToolOutputs, threadPruneProtection } from '../compaction/prune';
import { TOOL_SEARCH_TOOL } from '../../agent/AgentDeferredTools';
import { ThreadTokenCalibration } from '../compaction/calibration';
import { CONTEXT_CORPUS, corpusBaseline } from '../compaction/corpus';
import { makeThreadDigestStrategy } from '../compaction/digestStrategy';
import type { ThreadCompactionSegment, ThreadCompactionStrategy } from '../compaction/strategy';
import type { ThreadCompactionText } from '../compaction/text';
import { makeThreadSummaryStrategy, selectThreadCompactionPrompt, type ThreadCompactionPrompt } from '../compaction/summaryStrategy';
import type { CompactionModels } from '../compaction/CompactionModels';
import { lookupModels } from '../compaction/lookupModels';
import { answering } from '@runlith/llm/route/transport/answering';
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
const pruningLimits = {
  ...threadPruneProtection({ context: 200_000, output: 32_000 }, policy),
  recentUserTurns: policy.recentUserTurns,
};
const prompt: ThreadCompactionPrompt = {
  instructions: 'Summarize the thread segment.',
  template: 'Use exactly these sections:\n## State',
};
const text: ThreadCompactionText = {
  checkpointMarker: 'Continue from the anchored thread state below.',
  prunedToolOutput: '[Old tool result content cleared]',
  overflowMediaGuidance: 'Attached media was omitted from this retry.',
  omittedMedia: (mediaType) => `[Attached ${mediaType ?? 'media'} omitted.]`,
};
const offPathCheckpoints = {
  latestCheckpoint: () => Effect.succeed(null),
  prunedToolCalls: () => Effect.succeed(new Set<string>()),
  prunedToolCallVolume: () => Effect.succeed({ count: 0, tokens: 0 }),
  compactionCount: () => Effect.succeed(0),
  markToolCallsPrunedIn: () => Effect.void,
  retirePrunedToolCallsIn: () => Effect.die(new Error('a compaction persists nothing; the settling owner retires a mark')),
  writeCheckpointIn: () => Effect.die(new Error('a compaction persists nothing; the settling owner writes')),
} satisfies ThreadCompactionStorage;
const uncallable: ModelRequest = {
  plannedOutputTokens: 32_000,
  stream: () => Stream.die(new Error('The deterministic strategy must not call a model.')),
  text: () => Effect.die(new Error('The deterministic strategy must not call a model.')),
  object: () => Effect.die(new Error('The deterministic strategy must not call a model.')),
};
describe('profile-selected compaction', () => {
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
  const catalog = modelCatalog([recordedRegistrations.anthropicConsole, recordedRegistrations.subscription]);
  const history = [
    Message.user('First task'),
    Message.make({ id: 'msg_first', requestId: 'req_first', role: 'assistant', content: 'First answer' }),
    Message.user('Second task'),
    Message.make({ id: 'msg_last', requestId: 'req_last', role: 'assistant', content: 'Last answer' }),
  ];
  const input = (provider: string) => ({
    threadId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    ownerId: 'synthetic',
    cacheGroup: crypto.randomUUID(),
    provider,
    model: 'claude-sonnet-5-5',
    reasoning: null,
    switches: {},
    sourceMessages: history,
    envelope: Effect.succeed({
      instructions: 'Caller instructions',
      tools: [],
      transcriptLocation: '/synthetic/transcript.jsonl',
      lower: (messages: readonly Message[]) => Effect.succeed(messages.map(hydrated)),
    }),
  });
  const attachmentReference = '/api/threads/t-1/attachments/01a09390-bbde-7a10-948b-79f5a64e8edc.png';
  const attachmentBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const hydrated = (message: Message): Message =>
    message.role !== 'user'
      ? message
      : Message.make({
          ...message,
          content: message.content.map((part) =>
            part.type === 'media' && part.data === attachmentReference ? { ...part, data: attachmentBytes } : part,
          ),
        });
  const response = (reason = 'end_turn') =>
    new Response(
      [
        { type: 'message_start', message: { id: 'msg_summary', usage: { input_tokens: 10 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Retained state' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 20 } },
        { type: 'message_stop' },
      ]
        .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        .join(''),
      {
        headers: { 'content-type': 'text/event-stream', 'request-id': 'req_summary' },
      },
    );
  const owner = Effect.fnUntraced(function* (fetch: HttpClient.HttpClient) {
    const requester = modelRequester(catalog, credentials, yield* openModelClient(fetch));
    const models: CompactionModels = lookupModels({
      ...requester,
      capacity: (provider, model) => catalog.textModelCapacity(provider, model),
      cacheLifetime: (provider, model) => catalog.resolveTextModel(provider, model).cacheLifetime,
      compactionTrigger: (provider, model) => catalog.resolveTextModel(provider, model).compactionTrigger,
    });
    const strategy: ThreadCompactionStrategy = {
      summarize: (segment) => Effect.succeed({ coveredMessageCount: segment.coveredMessageCount, summary: 'Product state', usage: null }),
    };
    return makeThreadCompaction({
      models,
      checkpoints: offPathCheckpoints,
      policy: () => Effect.succeed(policy),
      strategy,
      recovery: strategy,
      text,
    });
  });
  it.live(
    'OAuth overrides the product strategy while API uses it over the same history',
    Effect.fnUntraced(function* () {
      const fetch = answering((sent) =>
        new URL(sent.url).pathname === '/v1/messages' ? response() : Response.json({ data: [], next_page: null }),
      );
      const compactor = yield* owner(fetch);
      const api = yield* compactor.compact(input('anthropic'));
      const oauth = yield* compactor.compact(input('subscription'));
      expect(api.settlement?.checkpoint?.summary).toBe('Product state');
      expect(api.settlement?.replaced.keepFrom).toBe(history.length);
      expect(oauth.settlement?.checkpoint?.summary).toBe('Retained state');
      expect(oauth.settlement?.replaced.keepFrom).toBe(history.length - 1);
      const checkpoint = oauth.settlement?.replaced.messages.find((message) => message.compaction !== undefined);
      expect(checkpoint?.compaction?.previousRequestId).toBe('req_last');
      expect(checkpoint?.compaction?.previousMessageId).toBe('msg_last');
      const folded = [...(oauth.settlement?.replaced.messages ?? []), ...history.slice(oauth.settlement?.replaced.keepFrom)];
      expect(folded.length - 1 - folded.findIndex((message) => message.compaction !== undefined)).toBe(
        checkpoint?.compaction?.preservedCount ?? -1,
      );
      expect(oauth.settlement?.covers(history)).toBe(true);
      expect(oauth.settlement?.covers([Message.user('Replaced'), ...history.slice(1)])).toBe(false);
    }),
  );
  it.live(
    'a rejected summary leaves its source history intact',
    Effect.fnUntraced(function* () {
      const fetch = answering((sent) =>
        new URL(sent.url).pathname === '/v1/messages' ? response('max_tokens') : Response.json({ data: [], next_page: null }),
      );
      const before = JSON.stringify(history);
      const failed = yield* Effect.exit((yield* owner(fetch)).compact(input('subscription')));
      expect(Exit.isFailure(failed)).toBe(true);
      expect(JSON.stringify(history)).toBe(before);
    }),
  );
  it.live(
    "a profile's summary the provider refused ends its compaction activity with the provider reason",
    Effect.fnUntraced(function* () {
      const fetch = answering((sent) =>
        new URL(sent.url).pathname === '/v1/messages'
          ? new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'unsupported field' } }), { status: 400 })
          : Response.json({ data: [], next_page: null }),
      );
      const recording = activityRecording();
      const refused = yield* (yield* owner(fetch))
        .compact(input('subscription'))
        .pipe(Effect.provideService(ActivityLog, recording.log), Effect.flip);
      expect(refused).toBeInstanceOf(ThreadSummaryFailedError);
      expect(recording.activities().find((activity) => activity.opened.kind === 'compaction')?.ended).toMatchObject({
        outcome: 'failed',
        reason: 'InvalidRequest',
      });
    }),
  );
  it.live(
    'an overflowing summary retreats at a history boundary and preserves the larger tail',
    Effect.fnUntraced(function* () {
      const bodies: Array<{
        messages: readonly {
          role: string;
        }[];
      }> = [];
      const fetch = answering((request) => {
        if (new URL(request.url).pathname !== '/v1/messages') return Response.json({ data: [], next_page: null });
        bodies.push(Schema.decodeUnknownSync(AnthropicMessages.protocol.body.schema)(JSON.parse(request.text)));
        return bodies.length === 1
          ? new Response(
              JSON.stringify({ error: { type: 'invalid_request_error', message: 'prompt is too long: 210000 tokens > 200000 maximum' } }),
              { status: 400 },
            )
          : response();
      });
      const result = yield* (yield* owner(fetch)).compact(input('subscription'));
      expect(result.settlement?.replaced.keepFrom).toBe(2);
      const checkpoint = result.settlement?.replaced.messages.find((message) => message.compaction !== undefined);
      expect(checkpoint?.compaction?.preservedCount).toBe(2);
      expect(bodies).toHaveLength(2);
      expect(history.slice(result.settlement?.replaced.keepFrom)).toEqual(history.slice(2));
    }),
  );
  it.live(
    'a picture the history holds by reference leaves as its bytes, and stays a reference in the fold',
    Effect.fnUntraced(function* () {
      const attached = [
        Message.user([
          { type: 'text', text: 'Look at this' },
          { type: 'media', mediaType: 'image/png', data: attachmentReference },
        ]),
        Message.make({ id: 'msg_last', requestId: 'req_last', role: 'assistant', content: 'Seen' }),
      ];
      const bodies: Array<Schema.Schema.Type<typeof AnthropicMessages.protocol.body.schema>> = [];
      const fetch = answering((request) => {
        if (new URL(request.url).pathname !== '/v1/messages') return Response.json({ data: [], next_page: null });
        bodies.push(Schema.decodeUnknownSync(AnthropicMessages.protocol.body.schema)(JSON.parse(request.text)));
        return response();
      });
      const result = yield* (yield* owner(fetch)).compact({ ...input('subscription'), sourceMessages: attached });
      const blocks = bodies[0]?.messages.flatMap((message) => (typeof message.content === 'string' ? [] : [...message.content])) ?? [];
      const image = blocks.find((block) => block.type === 'image');
      expect(image !== undefined && 'data' in image.source ? image.source.data : null).toBe(
        Buffer.from(attachmentBytes).toString('base64'),
      );
      expect(result.settlement?.covers(attached)).toBe(true);
      expect(attached[0]?.content.find((part) => part.type === 'media')?.data).toBe(attachmentReference);
    }),
  );
  it.live(
    'a call the stored history never answered is answered in the compaction request',
    Effect.fnUntraced(function* () {
      const unanswered = [
        Message.user('First task'),
        Message.make({
          id: 'msg_call',
          requestId: 'req_call',
          role: 'assistant',
          content: [ToolCallPart.from({ id: 'call-1', name: 'bash', input: { command: 'ls' } })],
        }),
        Message.user('Second task'),
        Message.make({ id: 'msg_last', requestId: 'req_last', role: 'assistant', content: 'Last answer' }),
      ];
      const bodies: Array<Schema.Schema.Type<typeof AnthropicMessages.protocol.body.schema>> = [];
      const fetch = answering((request) => {
        if (new URL(request.url).pathname !== '/v1/messages') return Response.json({ data: [], next_page: null });
        bodies.push(Schema.decodeUnknownSync(AnthropicMessages.protocol.body.schema)(JSON.parse(request.text)));
        return response();
      });
      const result = yield* (yield* owner(fetch)).compact({ ...input('subscription'), sourceMessages: unanswered });
      const sent = bodies[0]?.messages ?? [];
      const blocks = (message: (typeof sent)[number] | undefined) =>
        message === undefined || typeof message.content === 'string' ? [] : [...message.content];
      const at = sent.findIndex((message) => blocks(message).some((block) => block.type === 'tool_use' && block.id === 'call-1'));
      expect(at).toBeGreaterThanOrEqual(0);
      expect(blocks(sent[at + 1]).flatMap((block) => (block.type === 'tool_result' ? [block.tool_use_id] : []))).toEqual(['call-1']);
      expect(result.settlement?.replaced.keepFrom).toBe(unanswered.length - 1);
      expect(unanswered[1]?.content).toHaveLength(1);
    }),
  );
  it.live(
    'cancellation closes the summary transport and leaves the source history intact',
    Effect.fnUntraced(function* () {
      const started = yield* Deferred.make<void>();
      let aborted = false;
      const fetch = answering((request) => {
        if (new URL(request.url).pathname !== '/v1/messages') return Response.json({ data: [], next_page: null });
        Deferred.doneUnsafe(started, Effect.void);
        return new Promise<Response>((_resolve, reject) => {
          const stop = () => {
            aborted = true;
            reject(new Error('aborted'));
          };
          if (request.signal.aborted) stop();
          else request.signal.addEventListener('abort', stop, { once: true });
        });
      });
      const before = JSON.stringify(history);
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild((yield* owner(fetch)).compact(input('subscription')));
          yield* Deferred.await(started);
          yield* Fiber.interrupt(fiber);
          return yield* Fiber.await(fiber);
        }),
      );
      expect(Exit.isFailure(result)).toBe(true);
      expect(aborted).toBe(true);
      expect(JSON.stringify(history)).toBe(before);
    }),
  );
});
describe('ThreadCompaction policy', () => {
  test('reads a trigger as a share of the window, a ceiling as a ceiling, and the older reading apart', () => {
    const percent = (trigger: number): ModelCompactionTrigger => ({ strategy: 'percent', trigger });
    const reserved: ModelCompactionTrigger = { strategy: 'reserve-output' };
    expect(threadUsableTokens({ context: 262_000, output: 128_000 }, 128_000, policy, percent(0.9))).toBe(235_800);
    expect(threadUsableTokens({ context: 262_000, output: 128_000 }, 128_000, policy, reserved)).toBe(134_000);
    expect(threadUsableTokens({ context: 262_000, output: 128_000 }, 8_192, policy, percent(0.9))).toBe(235_800);
    expect(threadUsableTokens({ context: 272_000, input: 144_000, output: 128_000 }, 128_000, policy, percent(0.9))).toBe(124_000);
    expect(threadUsableTokens({ context: 272_000, input: 144_000, output: 128_000 }, 128_000, policy, percent(0.4))).toBe(108_800);
    expect(threadUsableTokens({ context: 200_000, output: 8_192 }, 8_192, policy, percent(1))).toBe(200_000);
  });
  test('resolves the pair first, then the row, then the standing value', () => {
    const overrides = [{ provider: 'acme-oauth', model: 'model-a', strategy: 'percent' as const, trigger: 0.4 }];
    const withOverride = { ...policy, compactionTrigger: { strategy: 'percent' as const, trigger: 0.9 }, compactionOverrides: overrides };
    expect(resolveCompactionTrigger({ provider: 'acme-oauth', model: 'model-a', policy: withOverride })).toEqual({
      strategy: 'percent',
      trigger: 0.4,
      source: 'override',
    });
    expect(resolveCompactionTrigger({ provider: 'openai-oauth', model: 'model-a', policy: withOverride }).source).toBe('global');
    const row = { strategy: 'percent' as const, trigger: 0.7 };
    expect(resolveCompactionTrigger({ provider: 'acme-oauth', model: 'model-a', policy: policy, row }).source).toBe('row');
    expect(resolveCompactionTrigger({ provider: 'acme-oauth', model: 'model-a', policy: withOverride, row })).toEqual({
      strategy: 'percent',
      trigger: 0.4,
      source: 'override',
    });
    const twice = {
      ...withOverride,
      compactionOverrides: [...overrides, { provider: 'acme-oauth', model: 'model-a', strategy: 'reserve-output' as const }],
    };
    expect(resolveCompactionTrigger({ provider: 'acme-oauth', model: 'model-a', policy: twice }).strategy).toBe('reserve-output');
  });
  test('keeps provider input ceilings separate from total context and output capacity', () => {
    expect(threadUsableTokens({ context: 400_000, input: 272_000, output: 128_000 }, 32_000, policy, policy.compactionTrigger)).toBe(
      252_000,
    );
    expect(threadUsableTokens({ context: 1_000_000, output: 128_000 }, 64_000, policy, policy.compactionTrigger)).toBe(936_000);
  });
  it.live(
    'refuses a tool-output protection share outside the open unit interval',
    Effect.fnUntraced(function* () {
      const models = lookupModels({
        request: () => {
          throw new Error('policy construction opens no model call');
        },
        capacity: () => ({ context: 200_000, output: 32_000 }),
      });
      const construct = (toolPruneProtectShare: number) =>
        makeThreadCompaction({
          models,
          policy: () => Effect.succeed({ ...policy, toolPruneProtectShare }),
          strategy: makeThreadDigestStrategy(),
          recovery: makeThreadDigestStrategy(),
          text,
          checkpoints: offPathCheckpoints,
        });
      expect(
        yield* Effect.matchCause(construct(0).policy({ threadId: 'thread-0' }), { onFailure: Cause.squash, onSuccess: () => null }),
      ).toBeInstanceOf(RangeError);
      expect(
        yield* Effect.matchCause(construct(1).policy({ threadId: 'thread-1' }), { onFailure: Cause.squash, onSuccess: () => null }),
      ).toBeInstanceOf(RangeError);
    }),
  );
  it.live(
    'empty manual compaction stops before policy; every nonempty entry preserves its typed failure',
    Effect.fnUntraced(function* () {
      const models = lookupModels({
        request: () => {
          throw new Error('a failed policy opens no model call');
        },
        capacity: () => ({ context: 200_000, output: 32_000 }),
      });
      const compaction = makeThreadCompaction({
        models,
        policy: ({ threadId }) => Effect.fail(new ThreadNotFoundError(threadId)),
        strategy: makeThreadDigestStrategy(),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: offPathCheckpoints,
      });
      const messages = [Message.user('Read policy before compacting this history.')];
      expect(
        yield* compaction.compact({
          threadId: 'empty-thread',
          runId: 'empty-run',
          ownerId: 'owner-1',
          provider: 'openai-oauth',
          model: 'gpt-5.6-sol',
          reasoning: null,
          switches: {},
          sourceMessages: [],
        }),
      ).toEqual({ compacted: false, usage: null });
      const prepare = yield* Effect.flip(
        compaction.prepare({
          threadId: 'prepare-thread',
          runId: 'prepare-run',
          stepNumber: 0,
          ownerId: 'owner-1',
          provider: 'openai-oauth',
          model: 'gpt-5.6-sol',
          reasoning: null,
          switches: {},
          history: messages,
          tools: [],
          plannedOutputTokens: 32_000,
          overflow: false,
          meter: new ThreadRequestMeter(),
        }),
      );
      const compact = yield* Effect.flip(
        compaction.compact({
          threadId: 'compact-thread',
          runId: 'compact-run',
          ownerId: 'owner-1',
          provider: 'openai-oauth',
          model: 'gpt-5.6-sol',
          reasoning: null,
          switches: {},
          sourceMessages: messages,
        }),
      );
      for (const [failure, threadId] of [
        [prepare, 'prepare-thread'],
        [compact, 'compact-thread'],
      ] as const) {
        expect(failure).toBeInstanceOf(ThreadNotFoundError);
        if (!(failure instanceof ThreadNotFoundError)) return yield* Effect.die(new Error('expected a typed thread absence'));
        expect(failure.threadId).toBe(threadId);
      }
    }),
  );
  test('uses the OpenCode four-character token estimate and retains recent user turns', () => {
    expect(estimateThreadTokens('12345678')).toBe(2);
    const messages = turns(5, 3_000);
    const covered = selectThreadCompactionPrefix(messages, 0, 20_000, policy);
    expect(covered).toBe(6);
  });
  test('counts an attached image as one declared figure in both of its forms', () => {
    const withImages: ThreadCompactionPolicy = { ...policy, imageTokens: 1_600 };
    const referenced = [Message.user([{ type: 'media', mediaType: 'image/png', data: 'https://host/a.png' }])];
    const hydrated = [Message.user([{ type: 'media', mediaType: 'image/png', data: new Uint8Array(1024 * 1024) }])];
    expect(estimateThreadTokens(hydrated, withImages.imageTokens)).toBeLessThan(1_700);
    expect(estimateThreadTokens(hydrated, withImages.imageTokens)).toBe(estimateThreadTokens(referenced, withImages.imageTokens));
  });
  test("prices a part's provider carry at nothing, and its text as text", () => {
    const text = 'x'.repeat(4_000);
    const bare = [Message.assistant([{ type: 'reasoning', text }])];
    const signed = [Message.assistant([{ type: 'reasoning', text, providerMetadata: { anthropic: { signature: 's'.repeat(40_000) } } }])];
    expect(estimateThreadTokens(signed)).toBe(estimateThreadTokens(bare));
    expect(estimateThreadTokens(bare)).toBeGreaterThan(1_000);
  });
  test('splits an oversized current turn at a model-message boundary', () => {
    const messages: Message[] = [Message.user('u'.repeat(20_000)), Message.assistant('a'.repeat(4_000))];
    expect(selectThreadCompactionPrefix(messages, 0, 20_000, { ...policy, maxOpeningTokens: 0 })).toBe(1);
  });
  test('never starts a retained tail with an orphan tool result', () => {
    const messages: Message[] = [
      Message.user('u'.repeat(20_000)),
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            id: 'call-1',
            name: 'inspect',
            input: { query: 'q'.repeat(20_000) },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            id: 'call-1',
            name: 'inspect',
            result: { type: 'text', value: 'x'.repeat(12_000) },
          },
        ],
      },
    ];
    expect(selectThreadCompactionPrefix(messages, 0, 20_000, policy)).toBe(messages.length);
    const firstTwo = selectThreadCompactionPrompt({
      messages,
      alreadyCovered: 0,
      coveredMessageCount: 2,
      priorSummary: null,
      inputTokenLimit: Number.POSITIVE_INFINITY,
      fixedRequestTokens: 0,
      template: prompt.template,
    });
    if (!firstTwo) throw new Error('Expected assistant tool-call prefix.');
    const fitted = selectThreadCompactionPrompt({
      messages,
      alreadyCovered: 0,
      coveredMessageCount: 3,
      priorSummary: null,
      inputTokenLimit: estimateThreadTokens(firstTwo.prompt),
      fixedRequestTokens: 0,
      template: prompt.template,
    });
    expect(fitted?.coveredMessageCount).toBe(1);
    const projected = projectThreadHistory(
      messages,
      {
        coveredMessageCount: fitted?.coveredMessageCount ?? 0,
        summary: 'Anchored state.',
      },
      text.checkpointMarker,
      policy,
    );
    expect(projected.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant', 'tool']);
  });
  test('a fold carries the covered prefix deferred-tool inventory onto its marker', () => {
    const inventory = { type: 'text' as const, text: 'Deferred tools:\n- read_block', deferredTools: ['read_block'] };
    const messages: Message[] = [
      Message.user([{ type: 'text', text: '<workspace>fresh</workspace>' }, inventory]),
      Message.user('First task'),
      Message.assistant('First answer'),
      Message.user('Second task'),
      Message.assistant('Second answer'),
    ];
    const projected = projectThreadHistory(messages, { coveredMessageCount: 3, summary: 'Anchored state.' }, text.checkpointMarker, policy);
    expect(projected.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    const carried = projected[0]?.content.find((part) => part.type === 'text' && part.deferredTools !== undefined);
    expect(carried).toEqual(inventory);
    const bare = projectThreadHistory(
      messages.slice(1),
      { coveredMessageCount: 2, summary: 'Anchored state.' },
      text.checkpointMarker,
      policy,
    );
    expect(bare[0]?.content).toEqual([{ type: 'text', text: text.checkpointMarker }]);
  });
  test('keeps the recent OpenCode tool-output budget and clears older results', () => {
    const messages: Message[] = [
      Message.user('Investigate the repository from the first turn.'),
      ...Array.from({ length: 8 }, (_, index): Message => ({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            id: `call-${index}`,
            name: 'read_source',
            result: { type: 'text', value: `${index}:${'x'.repeat(50_000)}` },
          },
        ],
      })),
      Message.user('Continue from the second turn.'),
      Message.assistant('Continuing.'),
      Message.user('Start the newest turn.'),
    ];
    const before = structuredClone(messages);
    const pruned = pruneToolOutputs(messages, pruningLimits, new Set(), text.prunedToolOutput);
    expect(messages).toEqual(before);
    expect(pruned.prunedResults).toBeGreaterThan(0);
    expect(pruned.prunedTokens).toBeGreaterThan(20_000);
    expect(pruned.newlyPruned.length).toBe(pruned.prunedResults);
    const oldest = pruned.messages[1];
    const newest = pruned.messages[8];
    if (oldest?.role !== 'tool' || newest?.role !== 'tool') throw new Error('Expected tool messages.');
    const oldestResult = oldest.content[0];
    const newestResult = newest.content[0];
    const originalNewest = before[8];
    if (
      oldestResult?.type !== 'tool-result' ||
      newestResult?.type !== 'tool-result' ||
      originalNewest?.role !== 'tool' ||
      originalNewest.content[0]?.type !== 'tool-result'
    ) {
      throw new Error('Expected tool results.');
    }
    expect(oldestResult.result).toEqual({ type: 'text', value: '[Old tool result content cleared]' });
    expect(newestResult.result).toEqual(originalNewest.content[0].result);
  });
  test('a decided result stays cleared below every volume gate, and nothing new joins', () => {
    const messages: Message[] = [
      Message.user('First turn.'),
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            id: 'call-old',
            name: 'read_source',
            result: { type: 'text', value: 'small output' },
          },
        ],
      },
      Message.user('Second turn.'),
      Message.user('Newest turn.'),
    ];
    const pruned = pruneToolOutputs(messages, pruningLimits, new Set(['call-old']), text.prunedToolOutput);
    expect(pruned.newlyPruned).toEqual([]);
    expect(pruned.prunedResults).toBe(1);
    const tool = pruned.messages[1];
    if (tool?.role !== 'tool' || tool.content[0]?.type !== 'tool-result') throw new Error('Expected a tool result.');
    expect(tool.content[0].result).toEqual({ type: 'text', value: '[Old tool result content cleared]' });
  });
  test('clearing a search result carries its revealed names as references, and nothing else gains them', () => {
    const messages: Message[] = [
      Message.user('First turn.'),
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            id: 'call-search',
            name: TOOL_SEARCH_TOOL,
            result: {
              type: 'json',
              value: { status: 'revealed', tools: [{ name: 'verify_block', description: 'Attest.' }], missing: [], truncated: [] },
            },
          },
          {
            type: 'tool-result',
            id: 'call-read',
            name: 'read_source',
            result: { type: 'text', value: 'small output' },
          },
        ],
      },
      Message.user('Second turn.'),
    ];
    const cleared = clearToolOutputs(messages, new Set(['call-search', 'call-read']), text.prunedToolOutput);
    expect(cleared.changed).toBe(true);
    const tool = cleared.messages[1];
    if (tool?.role !== 'tool') throw new Error('Expected a tool message.');
    const [search, read] = tool.content;
    if (search?.type !== 'tool-result' || read?.type !== 'tool-result') throw new Error('Expected tool results.');
    expect(search.result).toEqual({ type: 'text', value: '[Old tool result content cleared]' });
    expect(search.toolReferences).toEqual(['verify_block']);
    expect(read.result).toEqual({ type: 'text', value: '[Old tool result content cleared]' });
    expect(read.toolReferences).toBeUndefined();
  });
  test('the pruned region only grows: a second pass re-clears the first decision and adds nothing', () => {
    const messages: Message[] = [
      Message.user('Investigate the repository from the first turn.'),
      ...Array.from({ length: 8 }, (_, index): Message => ({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            id: `call-${index}`,
            name: 'read_source',
            result: { type: 'text', value: `${index}:${'x'.repeat(50_000)}` },
          },
        ],
      })),
      Message.user('Continue from the second turn.'),
      Message.assistant('Continuing.'),
      Message.user('Start the newest turn.'),
    ];
    const first = pruneToolOutputs(messages, pruningLimits, new Set(), text.prunedToolOutput);
    expect(first.newlyPruned.length).toBeGreaterThan(0);
    const second = pruneToolOutputs(
      messages,
      pruningLimits,
      new Set(first.newlyPruned.map((call) => call.toolCallId)),
      text.prunedToolOutput,
    );
    expect(second.newlyPruned).toEqual([]);
    expect(second.prunedResults).toBe(first.prunedResults);
    expect(second.messages).toEqual(first.messages);
  });
  test('a pass writes down what each result held, because the text will not be there to measure', () => {
    const output = 'x'.repeat(40_000);
    const messages: Message[] = [
      Message.user('Investigate the repository from the first turn.'),
      ...Array.from({ length: 8 }, (_, index): Message => ({
        role: 'tool',
        content: [{ type: 'tool-result', id: `call-${index}`, name: 'read_source', result: { type: 'text', value: output } }],
      })),
      Message.user('Continue from the second turn.'),
      Message.assistant('Continuing.'),
      Message.user('Start the newest turn.'),
    ];
    const pass = pruneToolOutputs(messages, pruningLimits, new Set(), text.prunedToolOutput);
    expect(pass.newlyPruned.length).toBeGreaterThan(0);
    for (const call of pass.newlyPruned) expect(call.tokens).toBe(estimateThreadTokens(output));
    expect(pass.newlyPruned.reduce((sum, call) => sum + call.tokens, 0)).toBe(pass.prunedTokens);
  });
  it.live(
    'prepare carries what it decided in its settlement, and the settlement lands it with the fold',
    Effect.fnUntraced(function* () {
      const marked: string[][] = [];
      let decided: ReadonlySet<string> = new Set<string>();
      const models = lookupModels({
        request: () => {
          throw new Error('the fast path never reaches the model');
        },
        capacity: () => ({ context: 200_000, output: 32_000 }),
      });
      const compaction = makeThreadCompaction({
        models,
        policy: () => Effect.succeed(policy),
        strategy: makeThreadSummaryStrategy({ models, prompt }),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: {
          latestCheckpoint: () => Effect.succeed(null),
          prunedToolCalls: () => Effect.sync(() => decided),
          prunedToolCallVolume: () => Effect.sync(() => ({ count: decided.size, tokens: 0 })),
          compactionCount: () => Effect.succeed(0),
          markToolCallsPrunedIn: (_threadId, calls) =>
            Effect.sync(() => {
              marked.push(calls.map((call) => call.toolCallId));
              decided = new Set([...decided, ...calls.map((call) => call.toolCallId)]);
            }),
          retirePrunedToolCallsIn: () => Effect.void,
          writeCheckpointIn: () => Effect.die(new Error('the fast path never writes a checkpoint')),
        } satisfies ThreadCompactionStorage,
      });
      const messages: Message[] = [
        Message.user('Investigate the repository from the first turn.'),
        ...Array.from({ length: 8 }, (_, index): Message => ({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              id: `call-${index}`,
              name: 'read_source',
              result: { type: 'text', value: `${index}:${'x'.repeat(50_000)}` },
            },
          ],
        })),
        Message.user('Continue from the second turn.'),
        Message.assistant('Continuing.'),
        Message.user('Start the newest turn.'),
      ];
      const input = {
        threadId: 'thread-1',
        runId: 'run-1',
        stepNumber: 0,
        ownerId: 'owner-1',
        provider: 'openai-oauth',
        model: 'gpt-5.6-luna',
        reasoning: null,
        switches: {},
        history: messages,
        tools: [],
        plannedOutputTokens: 32_000,
        overflow: false,
        meter: new ThreadRequestMeter(),
      };
      const first = yield* compaction.prepare(input);
      expect(first.compacted).toBe(false);
      expect(marked).toEqual([]);
      expect(first.settlement?.prunedToolCalls.length).toBeGreaterThan(0);
      expect(JSON.stringify(first.messages)).toContain('[Old tool result content cleared]');
      yield* compaction.settleIn(first.settlement!, 'the-caller-unit');
      expect(marked).toHaveLength(1);
      const second = yield* compaction.prepare(input);
      expect(second.settlement?.prunedToolCalls ?? []).toEqual([]);
      expect(second.messages).toEqual(first.messages);
    }),
  );
  it.live(
    'pictures past the provider request budget clear their oldest results once, keeping the latest turn',
    Effect.fnUntraced(function* () {
      let decided: ReadonlySet<string> = new Set<string>();
      const marked: string[][] = [];
      const models = lookupModels({
        request: () => {
          throw new Error('the fast path never reaches the model');
        },
        capacity: () => ({ context: 1_000_000, output: 32_000 }),
        requestLimits: () => ({ bytes: 32 * 1024 * 1024, media: 100 }),
      });
      const compaction = makeThreadCompaction({
        models,
        policy: () => Effect.succeed(policy),
        strategy: makeThreadSummaryStrategy({ models, prompt }),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: {
          latestCheckpoint: () => Effect.succeed(null),
          prunedToolCalls: () => Effect.sync(() => decided),
          prunedToolCallVolume: () => Effect.sync(() => ({ count: decided.size, tokens: 0 })),
          compactionCount: () => Effect.succeed(0),
          markToolCallsPrunedIn: (_threadId, calls) =>
            Effect.sync(() => {
              marked.push(calls.map((call) => call.toolCallId));
              decided = new Set([...decided, ...calls.map((call) => call.toolCallId)]);
            }),
          retirePrunedToolCallsIn: () => Effect.void,
          writeCheckpointIn: () => Effect.die(new Error('the fast path never writes a checkpoint')),
        } satisfies ThreadCompactionStorage,
      });
      const shot = (index: number): Message => ({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            id: `shot-${index}`,
            name: 'take_screenshot',
            result: { type: 'content', value: [{ type: 'file', uri: `/shots/${index}.png`, mime: 'image/png' }] },
          },
        ],
      });
      const history: Message[] = [
        Message.user('Check the page.'),
        ...Array.from({ length: 20 }, (_, index) => [
          Message.assistant([{ type: 'tool-call', id: `shot-${index}`, name: 'take_screenshot', input: {} }]),
          shot(index),
        ]).flat(),
        Message.assistant('Here is what changed.'),
        Message.user([
          { type: 'text', text: 'And this one.' },
          { type: 'media', mediaType: 'image/png', data: '/latest.png' },
        ]),
      ];
      const sizes = new Map<string, number>([
        ...Array.from({ length: 20 }, (_, index) => [`/shots/${index}.png`, 1_500_000] as const),
        ['/latest.png', 100_000],
      ]);
      const input = {
        threadId: 'thread-1',
        runId: 'run-1',
        stepNumber: 0,
        ownerId: 'owner-1',
        provider: 'subscription',
        model: 'claude-opus-5-5',
        reasoning: null,
        switches: {},
        history,
        tools: [],
        plannedOutputTokens: 32_000,
        overflow: false,
        meter: new ThreadRequestMeter(),
        pictureSizes: (locations: readonly string[]) =>
          Effect.succeed(
            new Map(locations.flatMap((location) => (sizes.has(location) ? [[location, sizes.get(location)!] as const] : []))),
          ),
      };
      const first = yield* compaction.prepare(input);
      const kept = (messages: readonly Message[]) => pictureLocations(messages);
      yield* compaction.settleIn(first.settlement!, 'the-caller-unit');
      expect(marked).toHaveLength(1);
      expect(kept(first.messages)).toEqual(['/shots/16.png', '/shots/17.png', '/shots/18.png', '/shots/19.png', '/latest.png']);
      const second = yield* compaction.prepare(input);
      expect(second.settlement?.prunedToolCalls ?? []).toEqual([]);
      expect(second.messages).toEqual(first.messages);
    }),
  );
  it.live(
    'operator pictures past the provider request budget leave the record oldest first, the latest turn keeps its own, and the next request is the same',
    Effect.fnUntraced(function* () {
      const models = lookupModels({
        request: () => {
          throw new Error('the fast path never reaches the model');
        },
        capacity: () => ({ context: 1_000_000, output: 32_000 }),
        requestLimits: () => ({ bytes: 32 * 1024 * 1024, media: 100 }),
      });
      const compaction = makeThreadCompaction({
        models,
        policy: () => Effect.succeed(policy),
        strategy: makeThreadSummaryStrategy({ models, prompt }),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: offPathCheckpoints,
      });
      const photos = (turn: number) =>
        Array.from({ length: 4 }, (_, index) => ({
          type: 'media' as const,
          mediaType: 'image/jpeg',
          data: `/photos/${turn}-${index}.jpg`,
        }));
      const history: Message[] = [
        ...Array.from({ length: 30 }, (_, turn) => [
          Message.user([{ type: 'text', text: `Page ${turn}.` }, ...photos(turn)]),
          Message.assistant(`Read page ${turn}.`),
        ]).flat(),
        Message.user([{ type: 'text', text: 'And these.' }, ...photos(30)]),
      ];
      const input = (messages: readonly Message[]) => ({
        threadId: 'thread-1',
        runId: 'run-1',
        stepNumber: 0,
        ownerId: 'owner-1',
        provider: 'subscription',
        model: 'claude-opus-5-5',
        reasoning: null,
        switches: {},
        history: messages,
        tools: [],
        plannedOutputTokens: 32_000,
        overflow: false,
        meter: new ThreadRequestMeter(),
        pictureSizes: (locations: readonly string[]) => Effect.succeed(new Map(locations.map((location) => [location, 400_000] as const))),
      });
      const first = yield* compaction.prepare(input(history));
      const settlement = first.settlement;
      if (!settlement) return yield* Effect.die(new Error('pictures cleared for the budget must be folded into the record'));
      const record = [...settlement.replaced.messages, ...history.slice(settlement.replaced.keepFrom)];
      const kept = pictureLocations(first.messages);
      expect(kept.slice(-4)).toEqual(photos(30).map((photo) => photo.data));
      expect(kept.length * Math.ceil(400_000 / 3) * 4).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(kept).toEqual(pictureLocations(history).slice(-kept.length));
      expect(record).toEqual([...first.messages]);
      const next = yield* compaction.prepare(input([...record, Message.assistant('Read them.'), Message.user('Thanks.')]));
      expect(next.settlement).toBeUndefined();
      expect(next.messages.slice(0, record.length)).toEqual(record);
      const pile = [
        Message.user([{ type: 'text', text: 'All of these.' }, ...Array.from({ length: 6 }, (_, turn) => photos(turn)).flat()]),
      ];
      const heavy = {
        ...input(pile),
        pictureSizes: (locations: readonly string[]) =>
          Effect.succeed(new Map(locations.map((location) => [location, 2_000_000] as const))),
      };
      const sent = pictureLocations((yield* compaction.prepare(heavy)).messages);
      expect(sent.length * Math.ceil(2_000_000 / 3) * 4).toBeLessThanOrEqual(0.75 * 32 * 1024 * 1024);
      expect(sent).toEqual(pictureLocations(pile).slice(-sent.length));
    }),
  );
  it.live(
    'scales the pruning boundary and addresses a live share by thread',
    Effect.fnUntraced(function* () {
      let capacity: {
        context: number;
        input?: number;
        output?: number;
      } = {
        context: 200_000,
        output: 32_000,
      };
      const sharesByThread = new Map<string, number>();
      const prunedByThread = new Map<string, ReadonlySet<string>>();
      const models = lookupModels({
        request: () => {
          throw new Error('the fast path never reaches the model');
        },
        capacity: () => capacity,
      });
      const compaction = makeThreadCompaction({
        models,
        policy: ({ threadId }) => Effect.succeed({ ...policy, toolPruneProtectShare: sharesByThread.get(threadId) ?? 0.2 }),
        strategy: makeThreadDigestStrategy(),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: {
          latestCheckpoint: () => Effect.succeed(null),
          prunedToolCalls: (threadId) => Effect.sync(() => prunedByThread.get(threadId) ?? new Set<string>()),
          prunedToolCallVolume: (threadId) =>
            Effect.sync(() => ({
              count: prunedByThread.get(threadId)?.size ?? 0,
              tokens: 0,
            })),
          compactionCount: () => Effect.succeed(0),
          markToolCallsPrunedIn: (threadId, calls) =>
            Effect.sync(() => {
              prunedByThread.set(threadId, new Set([...(prunedByThread.get(threadId) ?? []), ...calls.map((call) => call.toolCallId)]));
            }),
          retirePrunedToolCallsIn: () => Effect.void,
          writeCheckpointIn: () => Effect.die(new Error('the fast path never writes a checkpoint')),
        } satisfies ThreadCompactionStorage,
      });
      const outputs = (count: number): Message[] => [
        Message.user('Investigate the repository from the first turn.'),
        ...Array.from({ length: count }, (_, index): Message => ({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              id: `call-${index}`,
              name: 'read_source',
              result: { type: 'text', value: `${index}:${'x'.repeat(50_000)}` },
            },
          ],
        })),
        Message.user('Continue from the second turn.'),
        Message.user('Start the newest turn.'),
      ];
      const run = Effect.fnUntraced(function* (threadId: string, count: number) {
        const messages = outputs(count);
        const prepared = yield* compaction.prepare({
          threadId,
          runId: `run-${threadId}`,
          stepNumber: 0,
          ownerId: 'owner-1',
          provider: 'openai-oauth',
          model: 'gpt-5.6-sol',
          reasoning: null,
          switches: {},
          history: messages,
          tools: [],
          plannedOutputTokens: 32_000,
          overflow: false,
          meter: new ThreadRequestMeter(),
        });
        if (prepared.settlement) yield* compaction.settleIn(prepared.settlement, 'the-caller-unit');
        return prepared;
      });
      sharesByThread.set('live-share', 0.2);
      expect((yield* compaction.policy({ threadId: 'live-share' })).toolPruneProtectShare).toBe(0.2);
      sharesByThread.set('live-share', 0.3);
      expect((yield* compaction.policy({ threadId: 'live-share' })).toolPruneProtectShare).toBe(0.3);
      yield* run('200k-below-old-gate', 4);
      expect(prunedByThread.has('200k-below-old-gate')).toBe(false);
      yield* run('200k-above-old-gate', 5);
      expect(prunedByThread.get('200k-above-old-gate')?.size).toBeGreaterThan(0);
      sharesByThread.set('200k-six-at-20', 0.2);
      sharesByThread.set('200k-six-at-30', 0.3);
      yield* run('200k-six-at-20', 6);
      expect(prunedByThread.get('200k-six-at-20')?.size).toBeGreaterThan(0);
      yield* run('200k-six-at-30', 6);
      expect((yield* compaction.policy({ threadId: '200k-six-at-30' })).toolPruneProtectShare).toBe(0.3);
      expect(prunedByThread.has('200k-six-at-30')).toBe(false);
      const sol = { context: 872_000, input: 744_000, output: 128_000 };
      expect(threadPruneProtection(sol, policy)).toEqual({
        protectTokens: 148_800,
        minimumTokens: 74_400,
      });
      capacity = sol;
      yield* run('sol-below-half-share', 16);
      expect(prunedByThread.has('sol-below-half-share')).toBe(false);
      yield* run('sol-above-half-share', 17);
      expect(prunedByThread.get('sol-above-half-share')?.size).toBeGreaterThan(0);
    }),
  );
  test('reduces an oversized summary request only at model-message boundaries', () => {
    const messages = turns(3, 2_000);
    const oneTurn = selectThreadCompactionPrompt({
      messages,
      alreadyCovered: 0,
      coveredMessageCount: 2,
      priorSummary: null,
      inputTokenLimit: Number.POSITIVE_INFINITY,
      fixedRequestTokens: 0,
      template: prompt.template,
    });
    if (!oneTurn) throw new Error('Expected one complete turn to fit.');
    const fitted = selectThreadCompactionPrompt({
      messages,
      alreadyCovered: 0,
      coveredMessageCount: 4,
      priorSummary: null,
      inputTokenLimit: estimateThreadTokens(oneTurn.prompt),
      fixedRequestTokens: 0,
      template: prompt.template,
    });
    expect(fitted?.coveredMessageCount).toBe(2);
  });
  test('projects a checkpoint without mutating or deleting the durable history', () => {
    const history = turns(3, 10);
    const before = structuredClone(history);
    const projected = projectThreadHistory(
      history,
      {
        coveredMessageCount: 2,
        summary: '## Objective\n- Continue the task.',
      },
      text.checkpointMarker,
      policy,
    );
    expect(history).toEqual(before);
    expect(projected.slice(2)).toEqual(history.slice(2));
    expect(projected[1]?.role).toBe('assistant');
    expect(projected[1]?.content).toEqual(Message.assistant('## Objective\n- Continue the task.').content);
    expect(projected.slice(0, 2).map(agentOriginOf)).toEqual(['summary', 'summary']);
  });
  it.live(
    're-locks a skill when its instruction payload leaves model-visible history',
    Effect.fnUntraced(function* () {
      const context = { scope: 'repository' };
      const instructions = 'Inspect the repository before acting.';
      const skills = [
        {
          id: 'repository',
          description: 'Inspect repository source.',
          instructions: () => instructions,
        },
      ] satisfies AgentSkillPool<typeof context, 'repository'>;
      const history: Message[] = [
        Message.user('Inspect the repository.'),
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              id: 'load-repository',
              name: LOAD_SKILL_TOOL,
              input: { skill: 'repository' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              id: 'load-repository',
              name: LOAD_SKILL_TOOL,
              result: {
                type: 'json',
                value: { status: 'loaded', skill: 'repository', instructions },
              },
            },
          ],
        },
        Message.assistant('The repository is inspected.'),
        Message.user('Continue with the next task.'),
      ];
      const before = structuredClone(history);
      expect(yield* loadedAgentSkillIds(skills, context, history)).toEqual(new Set(['repository']));
      const projected = projectThreadHistory(
        history,
        {
          coveredMessageCount: 4,
          summary: '## Objective\n- Continue with the next task.',
        },
        text.checkpointMarker,
        policy,
      );
      expect(history).toEqual(before);
      expect(projected.slice(2)).toEqual(history.slice(4));
      expect(yield* loadedAgentSkillIds(skills, context, projected)).toEqual(new Set());
    }),
  );
  test('removes media before the latest turn only from the overflow projection and leaves durable history unchanged', () => {
    const history: Message[] = [
      Message.user([
        { type: 'text', text: 'Inspect this.' },
        { type: 'media', mediaType: 'image/png', data: '/api/thread-attachments/image-1' },
      ]),
      Message.assistant([{ type: 'tool-call', id: 'call-1', name: 'read', input: { path: 'shot.png' } }]),
      Message.tool({
        id: 'call-1',
        name: 'read',
        result: {
          type: 'content',
          value: [
            { type: 'text', text: 'shot.png' },
            { type: 'file', uri: '/api/threads/t/attachments/shot.png', mime: 'image/png', name: 'shot.png' },
          ],
        },
      }),
      Message.assistant('I will inspect it.'),
      Message.user([
        { type: 'text', text: 'Now this one.' },
        { type: 'media', mediaType: 'image/png', data: '/api/thread-attachments/image-2' },
      ]),
    ];
    const before = structuredClone(history);
    const recovered = projectThreadOverflowRecovery(history, text);
    expect(history).toEqual(before);
    expect(recovered.omittedMedia).toBe(2);
    expect(recovered.messages).toHaveLength(history.length + 1);
    expect(recovered.messages[4]).toEqual(history[4]);
    expect(JSON.stringify(recovered.messages.slice(0, 4))).not.toContain('"type":"media"');
    expect(JSON.stringify(recovered.messages.slice(0, 4))).not.toContain('"type":"file"');
  });
  it.live(
    'lets a refused model read surface instead of projecting a partial summary as state',
    Effect.fnUntraced(function* () {
      let modelCalls = 0;
      const models: CompactionModels = lookupModels({
        request: () => ({
          ...uncallable,
          text: () => {
            modelCalls += 1;
            return Effect.succeed(summaryResponse('## Objective\n- Continue the task.', 'length'));
          },
        }),
        capacity: () => ({ context: 200_000, output: 32_000 }),
        cacheLifetime: () => ({ promisedSeconds: null, prior: null }),
        compactionTrigger: () => undefined,
      });
      const compaction = makeThreadCompaction({
        models,
        policy: () => Effect.succeed(policy),
        strategy: makeThreadSummaryStrategy({ models, prompt }),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: {
          latestCheckpoint: () => Effect.succeed(null),
          prunedToolCalls: () => Effect.succeed(new Set<string>()),
          prunedToolCallVolume: () => Effect.succeed({ count: 0, tokens: 0 }),
          compactionCount: () => Effect.succeed(0),
          markToolCallsPrunedIn: () => Effect.void,
          retirePrunedToolCallsIn: () => Effect.void,
          writeCheckpointIn: () => Effect.die(new Error('the refused read must never reach a checkpoint write')),
        } satisfies ThreadCompactionStorage,
      });
      const stored = [Message.user('u'.repeat(400_000)), Message.assistant('a'.repeat(400_000))];
      const summary = compaction.prepare({
        threadId: 'thread-1',
        runId: 'run-1',
        stepNumber: 0,
        ownerId: 'owner-1',
        provider: 'openai-oauth',
        model: 'gpt-5.6-luna',
        reasoning: null,
        switches: {},
        history: [...stored, Message.user('u'.repeat(400_000)), Message.assistant('Recent reply.')],
        tools: [],
        plannedOutputTokens: 4_096,
        overflow: false,
        meter: new ThreadRequestMeter(),
        measuredRequest: { ...measuredOver(stored), model: 'gpt-5.6-luna' },
      });
      expect(yield* Effect.matchCause(summary, { onFailure: Cause.squash, onSuccess: () => null })).toMatchObject({
        message: expect.stringContaining('finish reason: length'),
      });
      expect(modelCalls).toBe(1);
    }),
  );
});
describe('ThreadSummaryStrategy keep hint', () => {
  it.live(
    'the keep section rides the summary prompt when the caller named one, and only then',
    Effect.fnUntraced(function* () {
      const prompts: string[] = [];
      const models: CompactionModels = lookupModels({
        request: () => ({
          ...uncallable,
          text: (input: { messages: readonly Message[] }) => {
            prompts.push(
              input.messages
                .flatMap((message) => message.content)
                .map((part) => (part.type === 'text' ? part.text : ''))
                .join(''),
            );
            return Effect.succeed(
              summaryResponse('## Objective\n- Continue the task.\n' + '- kept detail of the covered turns\\n'.repeat(40), 'stop'),
            );
          },
        }),
        capacity: () => ({ context: 200_000, output: 32_000 }),
        cacheLifetime: () => ({ promisedSeconds: null, prior: null }),
        compactionTrigger: () => undefined,
      });
      const segment = (keep?: string) => ({
        threadId: 'thread-1',
        ownerId: 'owner-1',
        provider: 'openai-oauth',
        model: 'gpt-5.6-luna',
        reasoning: null,
        switches: {},
        messages: turns(2, 100),
        alreadyCovered: 0,
        coveredMessageCount: 2,
        priorSummary: null,
        usableTokens: () => 100_000,
        summaryBudgetTokens: 3_000,
        keep: keep,
      });
      const hinted = yield* makeThreadSummaryStrategy({ models, prompt }).summarize(
        segment('the three files edited and the spec 6a686491'),
      );
      const bare = yield* makeThreadSummaryStrategy({ models, prompt }).summarize(segment());
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain('<keep>\nthe three files edited and the spec 6a686491\n</keep>');
      expect(prompts[0]!.indexOf(prompt.template)).toBeLessThan(prompts[0]!.indexOf('<keep>'));
      expect(prompts[0]!.indexOf('<keep>')).toBeLessThan(prompts[0]!.indexOf('<thread-segment>'));
      expect(prompts[1]).not.toContain('<keep>');
      expect(hinted.coveredMessageCount).toBe(bare.coveredMessageCount);
    }),
  );
});
describe('ThreadSummaryStrategy request budget', () => {
  test('the fixed request bytes move the boundary back inside the selector', () => {
    const messages = turns(3, 2_000);
    const oneTurn = selectThreadCompactionPrompt({
      messages,
      alreadyCovered: 0,
      coveredMessageCount: 2,
      priorSummary: null,
      inputTokenLimit: Number.POSITIVE_INFINITY,
      fixedRequestTokens: 0,
      template: prompt.template,
    });
    if (!oneTurn) throw new Error('Expected one complete turn to fit.');
    const limit = estimateThreadTokens(oneTurn.prompt);
    expect(
      selectThreadCompactionPrompt({
        messages,
        alreadyCovered: 0,
        coveredMessageCount: 2,
        priorSummary: null,
        inputTokenLimit: limit,
        fixedRequestTokens: 0,
        template: prompt.template,
      })?.coveredMessageCount,
    ).toBe(2);
    expect(
      selectThreadCompactionPrompt({
        messages,
        alreadyCovered: 0,
        coveredMessageCount: 2,
        priorSummary: null,
        inputTokenLimit: limit,
        fixedRequestTokens: 1,
        template: prompt.template,
      })?.coveredMessageCount,
    ).toBe(1);
  });
  it.live(
    'a heavy fixed prefix shrinks the segment before the first call, not through an overflow',
    Effect.fnUntraced(function* () {
      const calls: number[] = [];
      function modelsWithSystem(system: string | undefined): CompactionModels {
        return lookupModels({
          request: () => ({
            ...uncallable,
            system: system || undefined,
            text: () => {
              calls.push(1);
              return Effect.succeed(
                summaryResponse('## Objective\n- Continue the task.\n' + '- kept detail of the covered turns\\n'.repeat(40), 'stop'),
              );
            },
          }),
          capacity: () => ({ context: 200_000, output: 32_000 }),
          cacheLifetime: () => ({ promisedSeconds: null, prior: null }),
          compactionTrigger: () => undefined,
        });
      }
      const segment = (models: CompactionModels) =>
        makeThreadSummaryStrategy({ models, prompt }).summarize({
          threadId: 'thread-1',
          ownerId: 'owner-1',
          provider: 'openai-oauth',
          model: 'gpt-5.6-luna',
          reasoning: null,
          switches: {},
          messages: turns(3, 2_000),
          alreadyCovered: 0,
          coveredMessageCount: 6,
          priorSummary: null,
          usableTokens: () => 12_000,
          summaryBudgetTokens: 20_000,
        });
      const unburdened = yield* segment(modelsWithSystem(undefined));
      expect(unburdened.coveredMessageCount).toBe(6);
      calls.length = 0;
      const burdened = yield* segment(modelsWithSystem('s'.repeat(40_000)));
      expect(burdened.coveredMessageCount).toBeLessThan(6);
      expect(burdened.coveredMessageCount).toBeGreaterThan(0);
      expect(calls).toHaveLength(1);
    }),
  );
});
describe('ThreadCompaction overflow recovery', () => {
  const neverModels = lookupModels({
    request: () => uncallable,
    capacity: () => ({ context: 200_000, output: 32_000 }),
  });
  function overflowInput(messages: readonly Message[]) {
    return {
      threadId: 'thread-1',
      runId: 'run-1',
      stepNumber: 0,
      ownerId: 'owner-1',
      provider: 'openai-oauth',
      model: 'gpt-5.6-luna',
      reasoning: null,
      switches: {},
      history: messages,
      tools: [],
      plannedOutputTokens: 32_000,
      overflow: true,
      meter: new ThreadRequestMeter(),
    };
  }
  it.live(
    'a text overflow settles a digest checkpoint without a model call',
    Effect.fnUntraced(function* () {
      const compaction = makeThreadCompaction({
        models: neverModels,
        policy: () => Effect.succeed({ ...policy, maxOpeningTokens: 0 }),
        strategy: makeThreadSummaryStrategy({ models: neverModels, prompt }),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: offPathCheckpoints,
      });
      const result = yield* compaction.prepare(overflowInput(turns(20, 20_000)));
      expect(result.compacted).toBe(true);
      const checkpoint = result.settlement?.checkpoint;
      if (!checkpoint) return yield* Effect.die(new Error('an overflow recovery must answer a settlement'));
      expect(checkpoint.usage).toBeNull();
      expect(checkpoint.summary).toContain('[truncated]');
      expect(checkpoint.summary).toContain('[User]: 19:');
      expect(checkpoint.summary).not.toContain('[User]: 0:');
    }),
  );
  it.live(
    'media omission alone recovers before any reduction is spent: the turn the run answers keeps its pictures, and the record keeps the omission',
    Effect.fnUntraced(function* () {
      const compaction = makeThreadCompaction({
        models: neverModels,
        policy: () => Effect.succeed(policy),
        strategy: makeThreadSummaryStrategy({ models: neverModels, prompt }),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: {
          latestCheckpoint: () => Effect.succeed(null),
          prunedToolCalls: () => Effect.succeed(new Set<string>()),
          prunedToolCallVolume: () => Effect.succeed({ count: 0, tokens: 0 }),
          compactionCount: () => Effect.succeed(0),
          markToolCallsPrunedIn: () => Effect.void,
          retirePrunedToolCallsIn: () => Effect.void,
          writeCheckpointIn: () => Effect.die(new Error('a sufficient media omission must never write a checkpoint')),
        } satisfies ThreadCompactionStorage,
      });
      const messages: Message[] = [
        Message.user([
          { type: 'text', text: 'Inspect this.' },
          { type: 'media', mediaType: 'image/png', data: '/api/thread-attachments/image-1' },
        ]),
        Message.assistant('I inspected it.'),
        Message.user([
          { type: 'text', text: 'Now these.' },
          { type: 'media', mediaType: 'image/png', data: '/api/thread-attachments/image-2' },
        ]),
        Message.assistant([ToolCallPart.from({ id: 'call-1', name: 'read_block', input: {} })]),
        Message.tool({ id: 'call-1', name: 'read_block', result: { type: 'text', value: 'a block' } }),
      ];
      const result = yield* compaction.prepare(overflowInput(messages));
      const settlement = result.settlement;
      if (!settlement) return yield* Effect.die(new Error('a recovery that omitted media must fold the omission into the record'));
      const record = [...settlement.replaced.messages, ...messages.slice(settlement.replaced.keepFrom)];
      expect(result.compacted).toBe(false);
      expect(pictureLocations(result.messages)).toEqual(['/api/thread-attachments/image-2']);
      expect(agentOriginOf(result.messages.at(-1)!)).toBe('guidance');
      expect(record).toEqual(result.messages.slice(0, -1));
      expect(settlement.covers(messages)).toBe(true);
    }),
  );
  it.live(
    'a request whose fixed prefix alone outgrows the window, with no media left, is the one explicit refusal',
    Effect.fnUntraced(function* () {
      const compaction = makeThreadCompaction({
        models: neverModels,
        policy: () => Effect.succeed(policy),
        strategy: makeThreadSummaryStrategy({ models: neverModels, prompt }),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: offPathCheckpoints,
      });
      const history = [Message.user('the first question'), Message.assistant('the first answer')];
      expect(
        yield* Effect.matchCause(compaction.prepare({ ...overflowInput(history), system: 's'.repeat(800_000) }), {
          onFailure: Cause.squash,
          onSuccess: () => null,
        }),
      ).toBeInstanceOf(ThreadCompactionExhaustedError);
    }),
  );
});
describe('ThreadTokenCalibration', () => {
  test('converges toward the reported ratio one damped step at a time', () => {
    const calibration = new ThreadTokenCalibration();
    expect(calibration.weight('openai-oauth', 'gpt-5.6-sol')).toBe(1);
    calibration.observe('openai-oauth', 'gpt-5.6-sol', 1_000, 2_000);
    const once = calibration.weight('openai-oauth', 'gpt-5.6-sol');
    expect(once).toBeGreaterThan(1);
    expect(once).toBeLessThanOrEqual(1.15);
    for (let index = 0; index < 50; index += 1) {
      calibration.observe('openai-oauth', 'gpt-5.6-sol', 1_000, 2_000);
    }
    expect(calibration.weight('openai-oauth', 'gpt-5.6-sol')).toBeCloseTo(2, 3);
  });
  test('caps a single massive anomaly and keeps weights per provider and model', () => {
    const calibration = new ThreadTokenCalibration();
    calibration.observe('openai-oauth', 'gpt-5.6-sol', 1_000, 50_000);
    expect(calibration.weight('openai-oauth', 'gpt-5.6-sol')).toBeLessThanOrEqual(1.15);
    expect(calibration.weight('openai-oauth', 'gpt-5.6-luna')).toBe(1);
  });
});
describe('ThreadCompaction calibrated decision', () => {
  it.live(
    'a learned undercount flips the fast path into a compaction',
    Effect.fnUntraced(function* () {
      const models = lookupModels({
        request: () => uncallable,
        capacity: () => ({ context: 200_000, output: 32_000 }),
      });
      const compaction = makeThreadCompaction({
        models,
        policy: () => Effect.succeed(policy),
        strategy: makeThreadDigestStrategy(),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: offPathCheckpoints,
      });
      const input = {
        threadId: 'thread-1',
        runId: 'run-1',
        stepNumber: 0,
        ownerId: 'owner-1',
        provider: 'openai-oauth',
        model: 'gpt-5.6-sol',
        reasoning: null,
        switches: {},
        history: turns(14, 20_000),
        tools: [],
        plannedOutputTokens: 32_000,
        overflow: false,
        meter: new ThreadRequestMeter(),
      };
      const usable = threadUsableTokens({ context: 200_000, output: 32_000 }, 32_000, policy, policy.compactionTrigger);
      const before = yield* compaction.prepare(input);
      expect(before.compacted).toBe(false);
      const raw = rawOf(input.history);
      expect(raw).toBeGreaterThan(0);
      for (let index = 0; index < 10; index += 1) {
        compaction.observeReportedUsage({
          provider: 'openai-oauth',
          model: 'gpt-5.6-sol',
          rawEstimatedTokens: raw,
          reportedInputTokens: raw * 2,
        });
      }
      const after = yield* compaction.prepare(input);
      expect(before.correctedTokens).toBeLessThanOrEqual(usable);
      expect(after.compacted).toBe(true);
      expect(after.decision?.cause).toBe('projected');
      expect(after.decision!.projectedTokens).toBeGreaterThan(usable);
      expect(after.correctedTokens).toBeLessThanOrEqual(usable);
    }),
  );
  it.live(
    'what one process learned, the next one decides by',
    Effect.fnUntraced(function* () {
      let saved: Record<string, number> | undefined;
      const profile = {
        load: () => saved,
        save: (weights: Record<string, number>) =>
          Effect.sync(() => {
            saved = weights;
          }),
      };
      const owner = () =>
        makeThreadCompaction({
          models: calibrationModels,
          policy: () => Effect.succeed(policy),
          strategy: makeThreadDigestStrategy(),
          recovery: makeThreadDigestStrategy(),
          text,
          checkpoints: offPathCheckpoints,
          calibration: { store: profile },
        });
      const first = owner();
      const before = yield* first.prepare(calibrationInput());
      expect(before.compacted).toBe(false);
      const raw = rawOf(calibrationInput().history);
      for (let index = 0; index < 10; index += 1) {
        first.observeReportedUsage({
          provider: 'openai-oauth',
          model: 'gpt-5.6-sol',
          rawEstimatedTokens: raw,
          reportedInputTokens: raw * 2,
        });
      }
      yield* first.persistCalibration();
      const after = yield* owner().prepare(calibrationInput());
      expect(after.compacted).toBe(true);
      expect(after.decision!.projectedTokens).toBeGreaterThan(before.correctedTokens);
      expect(after.decision!.projectedTokens).toBeGreaterThan(
        threadUsableTokens({ context: 200_000, output: 32_000 }, 32_000, policy, policy.compactionTrigger),
      );
    }),
  );
  it.live(
    'a fresh owner corrects its first estimate by what the corpus measured',
    Effect.fnUntraced(function* () {
      const measured = CONTEXT_CORPUS.map((fixture) => ({
        fixtureId: fixture.id,
        provider: 'openai-oauth',
        model: 'gpt-5.6-sol',
        reportedInputTokens: Math.round(estimateThreadTokens(fixture.request) * 1.5),
      }));
      const owner = (baseline: ReturnType<typeof corpusBaseline>) =>
        makeThreadCompaction({
          models: calibrationModels,
          policy: () => Effect.succeed(policy),
          strategy: makeThreadDigestStrategy(),
          recovery: makeThreadDigestStrategy(),
          text,
          checkpoints: offPathCheckpoints,
          calibration: { baseline },
        });
      const unmeasured = yield* owner(corpusBaseline([])).prepare(calibrationInput());
      const cold = yield* owner(corpusBaseline(measured)).prepare(calibrationInput());
      expect(unmeasured.compacted).toBe(false);
      expect(unmeasured.correctedTokens).toBe(rawOf(calibrationInput().history));
      expect(cold.compacted).toBe(true);
      expect(cold.decision!.projectedTokens).toBeGreaterThan(unmeasured.correctedTokens);
      expect(cold.decision!.projectedTokens).toBeGreaterThan(
        threadUsableTokens({ context: 200_000, output: 32_000 }, 32_000, policy, policy.compactionTrigger),
      );
    }),
  );
});
const calibrationModels = lookupModels({
  request: () => uncallable,
  capacity: () => ({ context: 200_000, output: 32_000 }),
  cacheLifetime: () => ({ promisedSeconds: null, prior: null }),
  compactionTrigger: () => undefined,
});
describe('ThreadCompaction decision', () => {
  const owner = (weight: number) =>
    makeThreadCompaction({
      models: calibrationModels,
      policy: () => Effect.succeed(policy),
      strategy: makeThreadDigestStrategy(),
      recovery: makeThreadDigestStrategy(),
      text,
      checkpoints: offPathCheckpoints,
      calibration: { baseline: () => weight },
    });
  it.live(
    'the comparison is the one taken before anything was reduced',
    Effect.fnUntraced(function* () {
      const told: unknown[] = [];
      const input = calibrationInput();
      const result = yield* owner(1.5).prepare({
        ...input,
        measuredRequest: { ...measuredOver(input.history.slice(0, -2)), inputTokens: 160_000 },
        onCompacting: (decision) => Effect.sync(() => told.push(decision)),
      });
      expect(result.compacted).toBe(true);
      const decision = result.decision!;
      expect(decision.cause).toBe('projected');
      expect(decision.projectedTokens).toBeGreaterThan(decision.usableTokens);
      expect(result.correctedTokens).toBeLessThan(decision.projectedTokens);
      expect(told).toEqual([decision]);
    }),
  );
  it.live(
    'a provider refusal stays the cause even where the forecast fitted',
    Effect.fnUntraced(function* () {
      const result = yield* owner(1).prepare({ ...calibrationInput(), overflow: true });
      expect(result.compacted).toBe(true);
      expect(result.decision?.cause).toBe('overflow');
      expect(result.decision?.contextWindow).toBe(200_000);
    }),
  );
  it.live(
    'a request that was sent as it stood decided nothing',
    Effect.fnUntraced(function* () {
      const result = yield* owner(1).prepare(calibrationInput());
      expect(result.compacted).toBe(false);
      expect(result.decision).toBeNull();
    }),
  );
  it.live(
    'a measurement this request cannot be sized against decides nothing about it',
    Effect.fnUntraced(function* () {
      const unprovable = {
        inputTokens: 900_000,
        cachedInputTokens: null,
        provider: 'openai-oauth',
        model: 'gpt-5.6-sol',
        footprint: {
          messages: 2,
          messageDigest: 'a prefix this request does not open on',
          promptDigest: 'p',
          toolDigests: ['t'],
        },
      };
      const result = yield* owner(1).prepare({ ...calibrationInput(), measuredRequest: unprovable });
      expect(result.compacted).toBe(false);
      expect(result.decision).toBeNull();
    }),
  );
  it.effect(
    'a request that no longer sends a tool its measurement carried is sized from that measurement, not re-estimated whole',
    Effect.fnUntraced(function* () {
      const tool = (name: string) =>
        ToolDefinition.make({
          name,
          description: `does ${name}`,
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        });
      const meter = new ThreadRequestMeter();
      const history = turns(14, 20_000);
      const sent = meter.request(
        { system: 'rules', messages: history, tools: [tool('search'), tool('read')], providerOptions: undefined },
        0,
      );
      const measured = Math.round(sent.tokens * 0.75);
      const result = yield* owner(1.5).prepare({
        ...calibrationInput(),
        meter,
        system: 'rules',
        history: [...history, Message.user('continue')],
        tools: [tool('search')],
        measuredRequest: { ...measuredOver(history), inputTokens: measured, footprint: sent.footprint },
      });
      expect(result.compacted).toBe(false);
      expect(result.decision).toBeNull();
      expect(result.correctedTokens).toBeGreaterThanOrEqual(measured);
      expect(result.correctedTokens).toBeLessThan(measured + 100);
    }),
  );
  it.effect(
    'a replaced prompt is no reason to price the thread above its measured ratio',
    Effect.fnUntraced(function* () {
      const meter = new ThreadRequestMeter();
      const history = turns(4, 20_000);
      const sent = meter.request({ system: 'p'.repeat(160_000), messages: history, tools: [], providerOptions: undefined }, 0);
      const result = yield* owner(1).prepare({
        ...calibrationInput(),
        meter,
        system: 'q'.repeat(160_000),
        history: [...history, ...turns(4, 20_000)],
        measuredRequest: { ...measuredOver(history), inputTokens: sent.tokens, footprint: sent.footprint },
      });
      expect(result.compacted).toBe(false);
      expect(result.correctedTokens).toBeLessThanOrEqual(sent.tokens + rawOf(turns(4, 20_000)) + 40_100);
    }),
  );
  it.effect(
    'a history pruned under its measurement is sized at the ratio its stored form was measured at',
    Effect.fnUntraced(function* () {
      const stored = [
        Message.user('start'),
        Message.assistant([ToolCallPart.from({ id: 'old', name: 'read', input: {} })]),
        Message.make({ role: 'tool', content: [ToolResultPart.from({ id: 'old', name: 'read', result: 'x'.repeat(400_000) })] }),
        ...turns(12, 20_000),
      ];
      const meter = new ThreadRequestMeter();
      const sent = meter.request({ system: undefined, messages: stored, tools: [], providerOptions: undefined }, policy.imageTokens);
      const result = yield* owner(1.5).prepare({
        ...calibrationInput(),
        meter,
        history: stored,
        measuredRequest: { ...measuredOver(stored), inputTokens: Math.round(sent.tokens * 0.6), footprint: sent.footprint },
      });
      expect(result.settlement?.covers(stored)).toBe(true);
      expect(result.compacted).toBe(false);
      expect(result.decision).toBeNull();
      expect(result.correctedTokens).toBeLessThan(Math.round(rawOf(result.messages) * 0.61));
    }),
  );
  it.live(
    'a provable measurement already at the budget is what the record names',
    Effect.fnUntraced(function* () {
      const meter = new ThreadRequestMeter();
      const input = { ...calibrationInput(), meter };
      const priced = yield* meter.requestHashed(
        { system: undefined, messages: input.history, tools: [], providerOptions: undefined },
        policy.imageTokens,
      );
      const result = yield* owner(1).prepare({
        ...input,
        measuredRequest: {
          inputTokens: 900_000,
          cachedInputTokens: 120_000,
          provider: 'openai-oauth',
          model: 'gpt-5.6-sol',
          footprint: priced.footprint,
        },
      });
      expect(result.compacted).toBe(true);
      expect(result.decision?.cause).toBe('measured');
      expect(result.decision?.measuredTokens).toBe(900_000);
      expect(result.decision?.projectedTokens).toBeGreaterThanOrEqual(900_000);
      expect(result.decision?.cachedInputTokens).toBe(120_000);
    }),
  );
  it.live(
    'a history over the budget folds before its request leaves, though nothing was measured for the model it goes to',
    Effect.fnUntraced(function* () {
      const history = turns(20, 20_000);
      const result = yield* owner(1).prepare({
        ...calibrationInput(),
        history,
        measuredRequest: { ...measuredOver(history), model: 'gpt-5.5' },
      });
      expect(result.compacted).toBe(true);
      expect(result.decision?.cause).toBe('projected');
      expect(result.decision?.measuredTokens).toBeNull();
      expect(result.decision!.projectedTokens).toBeGreaterThan(result.decision!.usableTokens);
      expect(result.correctedTokens).toBeLessThanOrEqual(result.decision!.usableTokens);
    }),
  );
});
type RecordedThread = {
  stored: readonly Message[];
  readonly entries: ThreadCompactionEntry[];
  settles: boolean;
};
function recordedThread(stored: readonly Message[]): RecordedThread {
  return { stored, entries: [], settles: true };
}
function anchorOver(
  compactor: ThreadCompaction,
  thread: RecordedThread,
  options: {
    readonly runId?: string;
    readonly model?: string | null;
    readonly strategy?: string;
    readonly contextReading?: ThreadContextReading | null;
    readonly projectMessages?: (messages: readonly Message[]) => Effect.Effect<readonly Message[], AgentHostFailed>;
  } = {},
) {
  const unexpected = (): never => {
    throw new Error('not part of context projection');
  };
  const fold = (replaced: { readonly keepFrom: number; readonly messages: readonly Message[] }) => {
    thread.stored = [...replaced.messages, ...thread.stored.slice(replaced.keepFrom)];
  };
  return Effect.map(
    Effect.provide(
      makeThreadContextAnchors,
      Context.make(ThreadCompactor, compactor).pipe(
        Context.add(ThreadCompactionRuns, {
          opening: unexpected,
          work: unexpected,
          recordEntry: (_, entry) =>
            Effect.sync(() => {
              thread.entries.push(entry);
            }),
          settle: (_, settlement, entry) =>
            Effect.sync(() => {
              if (!thread.settles || !settlement.covers(thread.stored)) return false;
              fold(settlement.replaced);
              thread.entries.push(entry);
              return true;
            }),
          foldPruning: (_, settlement) =>
            Effect.sync(() => {
              if (!thread.settles || !settlement.covers(thread.stored)) return false;
              fold(settlement.replaced);
              return true;
            }),
        }),
        Context.add(ThreadAttachments, {
          keep: unexpected,
          resolve: unexpected,
          addressed: unexpected,
          hydrate: (_, messages) => Effect.succeed([...messages]),
          sizes: () => Effect.succeed(new Map()),
        }),
      ),
    ),
    (make) =>
      make({
        thread: { id: 'thread-1', cacheGroup: 'cache-1', contextReading: options.contextReading ?? null },
        runId: options.runId ?? 'run-1',
        model: {
          ownerId: 'owner-1',
          provider: 'openai-oauth',
          model: options.model === undefined ? 'gpt-5.6-sol' : options.model,
          reasoning: null,
          switches: {},
        },
        strategy: options.strategy,
        outputScope: {
          tools: {},
          project: unexpected,
          projectMessages: options.projectMessages ?? ((messages) => Effect.succeed(messages)),
          retainInterrupted: unexpected,
          retainOpen: unexpected,
          commitReferenced: unexpected,
          dispose: unexpected,
        },
        history: Effect.sync(() => thread.stored),
        requests: undefined,
        onProgress: undefined,
      }),
  );
}
function stepOf(stepNumber: number, carried: readonly Message[] = []) {
  return {
    messages: carried,
    tools: [],
    plannedOutputTokens: 64_000,
    provider: 'openai-oauth',
    model: 'gpt-5.6-sol',
    stepNumber,
    contextOverflow: false,
  };
}
const digestOwner = (weight = 1) =>
  makeThreadCompaction({
    models: calibrationModels,
    policy: () => Effect.succeed(policy),
    strategy: makeThreadDigestStrategy(),
    recovery: makeThreadDigestStrategy(),
    text,
    checkpoints: offPathCheckpoints,
    calibration: { baseline: () => weight },
  });
describe('ThreadContextAnchor projects the thread’s recorded history', () => {
  it.live(
    'a step is sent what the thread recorded, never what the loop carried',
    Effect.fnUntraced(function* () {
      const signal = agentSignalMessage({
        id: 'peer-1',
        type: 'message',
        text: 'A peer wrote mid-run.',
        occurredAt: '2026-10-01T18:00:00Z',
      });
      const guidance = agentRuntimeGuidanceMessage('Notes over the file just read.');
      const thread = recordedThread([
        Message.user('do the work'),
        Message.assistant('working'),
        signal,
        guidance,
        Message.assistant('more'),
      ]);
      const carried = [Message.user('do the work'), Message.assistant('working'), guidance, signal, Message.assistant('more')];
      const sent = yield* (yield* anchorOver(digestOwner(), thread)).project(stepOf(3, carried));
      expect(sent.messages).toEqual(thread.stored);
    }),
  );
  it.live(
    'a fold taken mid-run stands in the thread’s history, and the next run — on any model — opens on it',
    Effect.fnUntraced(function* () {
      const thread = recordedThread([...turns(18, 20_000), Message.user('the newest request')]);
      const before = thread.stored;
      const anchor = yield* anchorOver(digestOwner(), thread);
      const folded = yield* anchor.project(stepOf(7));
      expect(thread.entries.map((entry) => `${entry.id} ${entry.status}`)).toEqual([
        'compaction:run-1:7 running',
        'compaction:run-1:7 completed',
      ]);
      expect(folded.messages).toEqual(thread.stored);
      expect(thread.stored.length).toBeLessThan(before.length);
      const next = yield* (yield* anchorOver(digestOwner(), thread, { runId: 'run-2', model: 'gpt-5.5' })).project(stepOf(0));
      expect(next.messages).toEqual(thread.stored);
      expect(next.estimate!.tokens).toBeLessThan(
        threadUsableTokens({ context: 200_000, output: 32_000 }, 64_000, policy, policy.compactionTrigger),
      );
    }),
  );
  it.live(
    'a fold the thread refuses fails the step, and no projection stands that the thread does not hold',
    Effect.fnUntraced(function* () {
      const thread = recordedThread([...turns(18, 20_000), Message.user('the newest request')]);
      thread.settles = false;
      const before = thread.stored;
      const failed = yield* (yield* anchorOver(digestOwner(), thread)).project(stepOf(2)).pipe(Effect.flip);
      expect(failed._tag).toBe('AgentHostFailed');
      expect(failed.cause).toBeInstanceOf(ThreadCompactionConflictError);
      expect(thread.entries.map((entry) => entry.status)).toEqual(['running', 'failed']);
      expect(thread.stored).toBe(before);
    }),
  );
  it.live(
    'a call retried inside its step is sent the same projection, and an overflow replay starts from what the step folded',
    Effect.fnUntraced(function* () {
      let summaries = 0;
      const counting: ThreadCompactionStrategy = {
        summarize: (segment) =>
          Effect.sync(() => {
            summaries += 1;
            return { coveredMessageCount: segment.coveredMessageCount, summary: 'Anchored state.', usage: null };
          }),
      };
      const compactor = makeThreadCompaction({
        models: calibrationModels,
        policy: () => Effect.succeed(policy),
        strategy: counting,
        recovery: counting,
        text,
        checkpoints: offPathCheckpoints,
        calibration: { baseline: () => 1 },
      });
      const thread = recordedThread([...turns(16, 20_000), Message.user('the newest request')]);
      const anchor = yield* anchorOver(compactor, thread);
      const step = { ...stepOf(4), plannedOutputTokens: 8_000 };
      const injected = Message.user('what this step recorded beside its call');
      const first = yield* anchor.project(step);
      thread.stored = [...thread.stored, injected];
      const retried = yield* anchor.project(step);
      expect(summaries).toBe(0);
      const replayed = yield* anchor.project({ ...step, contextOverflow: true });
      expect(retried).toBe(first);
      expect(summaries).toBe(1);
      expect(replayed.messages.slice(0, 2).map(agentOriginOf)).toEqual(['summary', 'summary']);
      expect(replayed.messages).not.toContainEqual(injected);
      expect(thread.stored.at(-1)).toEqual(injected);
      expect(thread.stored.slice(0, -1)).toEqual([...replayed.messages]);
    }),
  );
  it.live(
    'provider pairing stays on the wire while the projection keeps the recorded form',
    Effect.fnUntraced(function* () {
      const thread = recordedThread([
        Message.user('earlier task'),
        Message.assistant([ToolCallPart.from({ id: 'interrupted', name: 'read', input: {} })]),
        Message.user('resume after interruption'),
        Message.assistant([ToolCallPart.from({ id: 'retained', name: 'read', input: {} })]),
        Message.make({ role: 'tool', content: [ToolResultPart.from({ id: 'retained', name: 'read', result: 'retained full result' })] }),
      ]);
      const anchor = yield* anchorOver(digestOwner(), thread, {
        projectMessages: (messages) =>
          projectToolResultMessages(messages, (input) =>
            Effect.succeed({ output: input.output, modelOutput: { type: 'text', value: 'bounded preview' } }),
          ),
      });
      const sent = yield* anchor.project(stepOf(0));
      const wire = yield* anchor.lower(sent.messages);
      expect(sent.messages).toEqual(thread.stored);
      expect(pairedForProvider(wire)).toBe(wire);
      expect(
        wire.flatMap((message) => message.content).find((part) => part.type === 'tool-result' && part.id === 'retained'),
      ).toMatchObject({
        result: { type: 'text', value: 'bounded preview' },
      });
    }),
  );
});
describe('ThreadContextAnchor call boundaries', () => {
  const unexpected = (): never => {
    throw new Error('not part of context projection');
  };
  const makeAnchor = (
    compactor: ThreadCompaction,
    thread: RecordedThread,
    model: string | null = 'gpt-5.6-sol',
    contextReading: ThreadContextReading | null = null,
  ) => anchorOver(compactor, thread, { model, contextReading });
  const projection = (messages: readonly Message[], stepNumber = 0) => ({
    messages,
    tools: [],
    plannedOutputTokens: 64_000,
    provider: 'openai-oauth',
    model: 'gpt-5.6-sol',
    stepNumber,
    contextOverflow: false,
  });
  it.live(
    'the next projection uses the latest bill even while no measurement has been recorded',
    Effect.fnUntraced(function* () {
      const compactor = makeThreadCompaction({
        models: lookupModels({
          request: unexpected,
          capacity: () => ({ context: 1_000_000, output: 64_000 }),
          cacheLifetime: () => ({ promisedSeconds: null, prior: null }),
          compactionTrigger: () => undefined,
        }),
        policy: () => Effect.succeed(policy),
        strategy: makeThreadDigestStrategy(),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: offPathCheckpoints,
        calibration: { baseline: () => 1.5 },
      });
      const sent = [Message.user('a measured request')];
      const thread = recordedThread(sent);
      const anchor = yield* makeAnchor(compactor, thread, null);
      yield* anchor.project(projection(sent));
      const actual = (messages: readonly Message[], stepNumber: number) => ({
        runId: 'run-1',
        stepNumber,
        attempt: 0,
        provider: 'openai-oauth',
        model: 'gpt-5.6-sol',
        system: undefined,
        messages,
        tools: [],
        providerOptions: undefined,
        plannedOutputTokens: 64_000,
        sentAt: '2026-09-10T10:00:00.000Z',
        cache: undefined,
      });
      const measured = yield* anchor.observe(actual(sent, 0), new Usage({ inputTokens: 639_480, outputTokens: 64_000 }));
      const next = [...sent, Message.assistant('done'), Message.user('continue')];
      thread.stored = next;
      const first = yield* anchor.project(projection(next, 1));
      expect(measured?.usage.inputTokens).toBe(639_480);
      expect(first.estimate?.tokens).toBeGreaterThanOrEqual(639_480);
      expect(first.estimate!.tokens).toBeLessThan(640_000);
      expect(first.messages).toEqual(next);
      yield* anchor.observe(actual(next, 1), new Usage({ inputTokens: 700_000 }));
      const second = yield* anchor.project(projection(next, 2));
      expect(second.estimate?.tokens).toBe(700_000);
      expect(second.messages).toEqual(next);
      const restored = yield* makeAnchor(compactor, recordedThread(sent), null, { ...measured!, stale: false });
      expect((yield* restored.project(projection(sent))).estimate?.tokens).toBe(639_480);
      const switched = yield* anchor.project({ ...projection(next, 3), model: 'gpt-5.5' });
      expect(switched.estimate?.tokens).toBe(Math.round(rawOf(next) * 1.5));
    }),
  );
  it.live(
    'a measurement records when it was sent and the ttl its prefix was written under: the policy`s own, else the row`s promise',
    Effect.fnUntraced(function* () {
      const compactor = makeThreadCompaction({
        models: lookupModels({
          request: unexpected,
          capacity: () => ({ context: 1_000_000, output: 64_000 }),
          cacheLifetime: (provider) => ({ promisedSeconds: provider === 'subscription' ? 3_600 : null, prior: null }),
          compactionTrigger: () => undefined,
        }),
        policy: () => Effect.succeed(policy),
        strategy: makeThreadDigestStrategy(),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: offPathCheckpoints,
        calibration: { baseline: () => 1.5 },
      });
      const sent = [Message.user('a measured request')];
      const anchor = yield* makeAnchor(compactor, recordedThread(sent), null);
      yield* anchor.project(projection(sent));
      const actual = (
        provider: string,
        cache:
          | 'auto'
          | {
              ttlSeconds: number;
            }
          | undefined,
      ) => ({
        runId: 'run-1',
        stepNumber: 0,
        attempt: 0,
        provider,
        model: 'm',
        system: undefined,
        messages: sent,
        tools: [],
        providerOptions: undefined,
        plannedOutputTokens: 64_000,
        sentAt: '2026-09-10T10:00:00.000Z',
        cache,
      });
      const usage = new Usage({ inputTokens: 50_000 });
      const promised = yield* anchor.observe(actual('subscription', undefined), usage);
      expect(promised).toMatchObject({ sentAt: '2026-09-10T10:00:00.000Z', cache: { ttlSeconds: 3_600 } });
      const unpromised = yield* anchor.observe(actual('openai-oauth', 'auto'), usage);
      expect(unpromised?.cache).toEqual({ ttlSeconds: null });
      const named = yield* anchor.observe(actual('subscription', { ttlSeconds: 300 }), usage);
      expect(named?.cache).toEqual({ ttlSeconds: 300 });
    }),
  );
  it.live(
    'learning prices the full actual request, including narrowed tools and injected guidance',
    Effect.fnUntraced(function* () {
      let weights: Record<string, number> = {};
      const compactor = makeThreadCompaction({
        models: calibrationModels,
        policy: () => Effect.succeed(policy),
        strategy: makeThreadDigestStrategy(),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: offPathCheckpoints,
        calibration: {
          store: {
            load: () => weights,
            save: (next) =>
              Effect.sync(() => {
                weights = next;
              }),
          },
        },
      });
      const messages = [Message.user('history'.repeat(100)), Message.user('injected guidance'.repeat(100))];
      const anchor = yield* makeAnchor(compactor, recordedThread(messages.slice(0, 1)));
      const actual = {
        runId: 'run-1',
        stepNumber: 0,
        attempt: 0,
        provider: 'openai-oauth',
        model: 'gpt-5.6-sol',
        system: 'system',
        messages,
        tools: [{ name: 'read', description: 'read', inputSchema: { type: 'object', properties: {} } }],
        providerOptions: undefined,
        plannedOutputTokens: 32_000,
        sentAt: '2026-09-10T10:00:00.000Z',
        cache: undefined,
      };
      yield* anchor.project({ ...projection(messages.slice(0, 1)), tools: [...actual.tools, { ...actual.tools[0]!, name: 'write' }] });
      const raw = new ThreadRequestMeter().request(actual, policy.imageTokens).tokens;
      for (let stepNumber = 0; stepNumber < 2; stepNumber++) {
        yield* anchor.observe({ ...actual, stepNumber }, new Usage({ inputTokens: Math.round(raw * 1.25) }));
      }
      yield* compactor.persistCalibration();
      expect(weights['openai-oauth/gpt-5.6-sol']).toBeCloseTo(1.09, 3);
    }),
  );
  it.live(
    'running and completed receipts keep pre-reduction pressure apart from the returned estimate',
    Effect.fnUntraced(function* () {
      const compactor = makeThreadCompaction({
        models: calibrationModels,
        policy: () => Effect.succeed(policy),
        strategy: makeThreadDigestStrategy(),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: offPathCheckpoints,
        calibration: { baseline: () => 1.5 },
      });
      const phases: string[] = [];
      const history = calibrationInput().history;
      const thread = recordedThread(history);
      const result = yield* (yield* makeAnchor(compactor, thread, 'gpt-5.6-sol', readingOver(history))).project({
        ...projection([]),
        phase: (phase) =>
          Effect.sync(() => {
            phases.push(phase);
          }),
      });
      const { entries } = thread;
      expect(phases).toEqual(['compacting', 'preparing']);
      expect(entries.map((entry) => entry.status)).toEqual(['running', 'completed']);
      expect(entries[0]?.receipt).toEqual(entries[1]?.receipt);
      expect(entries[0]?.occurredAt).toBe(entries[1]?.occurredAt);
      const receipt = entries[0]!.receipt!;
      expect(receipt.projectedTokens!).toBeGreaterThan(receipt.usableTokens!);
      expect(result.estimate!.tokens).toBeLessThan(receipt.projectedTokens!);
      expect(result.messages).toEqual(thread.stored);
    }),
  );
  it.live(
    'a reduction failure leaves its original running receipt for lifecycle settlement',
    Effect.fnUntraced(function* () {
      const compactor = makeThreadCompaction({
        models: calibrationModels,
        policy: () => Effect.succeed(policy),
        strategy: { summarize: () => Effect.fail(new ThreadCompactionExhaustedError('thread-1')) },
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: offPathCheckpoints,
        calibration: { baseline: () => 1.5 },
      });
      const history = calibrationInput().history;
      const thread = recordedThread(history);
      const result = yield* (yield* makeAnchor(compactor, thread, 'gpt-5.6-sol', readingOver(history)))
        .project(projection([]))
        .pipe(Effect.flip);
      const { entries } = thread;
      expect(result._tag).toBe('AgentHostFailed');
      expect(entries.map((entry) => entry.status)).toEqual(['running']);
      expect(entries[0]?.receipt?.cause).toBe('measured');
      expect(entries[0]!.receipt!.projectedTokens!).toBeGreaterThan(entries[0]!.receipt!.usableTokens!);
      expect(thread.stored).toBe(history);
    }),
  );
});
function rawOf(messages: readonly Message[]) {
  return new ThreadRequestMeter().request({ system: undefined, messages, tools: [], providerOptions: undefined }, policy.imageTokens)
    .tokens;
}
function measuredOver(messages: readonly Message[]) {
  return {
    inputTokens: 170_000,
    cachedInputTokens: null,
    provider: 'openai-oauth',
    model: 'gpt-5.6-sol',
    footprint: new ThreadRequestMeter().request({ system: undefined, messages, tools: [], providerOptions: undefined }, policy.imageTokens)
      .footprint,
  };
}
function readingOver(messages: readonly Message[]): ThreadContextReading {
  const measured = measuredOver(messages);
  return {
    usage: new Usage({ inputTokens: measured.inputTokens, totalTokens: measured.inputTokens }),
    contextWindow: 200_000,
    inputLimit: null,
    footprint: measured.footprint,
    runId: 'run-0',
    stepNumber: 0,
    provider: measured.provider,
    model: measured.model,
    measuredAt: '2026-09-10T10:00:00.000Z',
    stale: false,
  };
}
function calibrationInput() {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    stepNumber: 0,
    ownerId: 'owner-1',
    provider: 'openai-oauth',
    model: 'gpt-5.6-sol',
    reasoning: null,
    switches: {},
    history: turns(14, 20_000),
    tools: [],
    plannedOutputTokens: 32_000,
    overflow: false,
    meter: new ThreadRequestMeter(),
  };
}
describe('ThreadCompaction folds over the recorded history', () => {
  const compaction = () =>
    makeThreadCompaction({
      models: lookupModels({
        request: () => uncallable,
        capacity: () => ({ context: 200_000, output: 32_000 }),
      }),
      policy: () => Effect.succeed(policy),
      strategy: makeThreadDigestStrategy(),
      recovery: makeThreadDigestStrategy(),
      text,
      checkpoints: {
        latestCheckpoint: () => Effect.succeed(null),
        prunedToolCalls: () => Effect.succeed(new Set<string>()),
        prunedToolCallVolume: () => Effect.succeed({ count: 0, tokens: 0 }),
        compactionCount: () => Effect.succeed(0),
        markToolCallsPrunedIn: () => Effect.void,
        retirePrunedToolCallsIn: () => Effect.void,
        writeCheckpointIn: () => Effect.die(new Error('a compaction persists nothing; the settling owner writes')),
      } satisfies ThreadCompactionStorage,
    });
  function historyInput(history: readonly Message[], measuredPrefix: readonly Message[] = history) {
    return {
      threadId: 'thread-1',
      runId: 'run-1',
      stepNumber: 12,
      ownerId: 'owner-1',
      provider: 'openai-oauth',
      model: 'gpt-5.6-sol',
      reasoning: null,
      switches: {},
      history,
      tools: [],
      plannedOutputTokens: 32_000,
      overflow: false,
      meter: new ThreadRequestMeter(),
      measuredRequest: measuredOver(measuredPrefix),
    };
  }
  function measuredAt(inputTokens: number, cachedInputTokens: number | null) {
    return {
      inputTokens,
      cachedInputTokens,
      provider: 'openai-oauth',
      model: 'gpt-5.6-sol',
      footprint: {
        messages: 4,
        messageDigest: 'a request this projection does not open on',
        promptDigest: 'p',
        toolDigests: ['t'],
      },
    };
  }
  it.live(
    'a pass that only clears tool output folds the cleared text into the recorded history',
    Effect.fnUntraced(function* () {
      const stored = [
        Message.user('start'),
        Message.assistant([ToolCallPart.from({ id: 'old', name: 'read', input: {} })]),
        Message.make({ role: 'tool', content: [ToolResultPart.from({ id: 'old', name: 'read', result: 'x'.repeat(400_000) })] }),
        ...turns(2, 50),
      ];
      const result = yield* compaction().prepare({
        ...historyInput(stored),
        measuredRequest: null,
      });
      expect(result.compacted).toBe(false);
      const settlement = result.settlement;
      expect(settlement?.covers(stored)).toBe(true);
      if (!settlement) return yield* Effect.die(new Error('the cleared record must be persisted'));
      expect([...settlement.replaced.messages, ...stored.slice(settlement.replaced.keepFrom)]).toEqual([...result.messages]);
    }),
  );
  it.live(
    'a fold that also clears tool output still settles against the unmodified record',
    Effect.fnUntraced(function* () {
      const stored = [
        Message.user('start'),
        Message.assistant([ToolCallPart.from({ id: 'old', name: 'read', input: {} })]),
        Message.make({ role: 'tool', content: [ToolResultPart.from({ id: 'old', name: 'read', result: 'x'.repeat(400_000) })] }),
        ...turns(18, 20_000),
      ];
      const result = yield* compaction().prepare({
        ...historyInput(stored),
        overflow: true,
      });
      expect(result.compacted).toBe(true);
      expect(result.settlement?.covers(stored)).toBe(true);
      expect(result.settlement?.covers([Message.user('edited'), ...stored.slice(1)])).toBe(false);
    }),
  );
  it.live(
    'a cut answers a settlement the owner can commit',
    Effect.fnUntraced(function* () {
      const stored = turns(18, 20_000);
      const result = yield* compaction().prepare(historyInput(stored, stored.slice(0, 28)));
      expect(result.compacted).toBe(true);
      const settlement = result.settlement;
      if (!settlement) return yield* Effect.die(new Error('a cut inside the stored history must answer a settlement'));
      const checkpoint = settlement.checkpoint;
      if (!checkpoint) return yield* Effect.die(new Error('a summarized prefix names a checkpoint row'));
      expect(settlement.covers(stored)).toBe(true);
      const covered = checkpoint.coveredMessageCount;
      expect(settlement.covers([...stored.slice(0, covered - 1), Message.user('edited'), ...stored.slice(covered)])).toBe(false);
      const { replaced } = settlement;
      expect([...replaced.messages, ...stored.slice(replaced.keepFrom)]).toEqual([
        ...projectThreadHistory(
          stored,
          { coveredMessageCount: checkpoint.coveredMessageCount, summary: checkpoint.summary },
          text.checkpointMarker,
          policy,
        ),
      ]);
    }),
  );
  it.live(
    'a prefix the history no longer has fails its own check',
    Effect.fnUntraced(function* () {
      const stored = turns(18, 20_000);
      const result = yield* compaction().prepare(historyInput(stored, stored.slice(0, 28)));
      const settlement = result.settlement;
      if (!settlement) return yield* Effect.die(new Error('a cut inside the stored history must answer a settlement'));
      const moved = [Message.user('a different opening'), ...stored.slice(1)];
      expect(settlement.covers(moved)).toBe(false);
    }),
  );
  it.live(
    'the full context and the input ceiling are answered apart',
    Effect.fnUntraced(function* () {
      const capacityOf = (capacity: { context: number; input?: number; output?: number }) =>
        makeThreadCompaction({
          models: lookupModels({
            request: () => uncallable,
            capacity: () => capacity,
          }),
          policy: () => Effect.succeed(policy),
          strategy: makeThreadDigestStrategy(),
          recovery: makeThreadDigestStrategy(),
          text,
          checkpoints: offPathCheckpoints,
        });
      const stored = turns(1, 10);
      const declared = yield* capacityOf({ context: 872_000, input: 744_000, output: 128_000 }).prepare(historyInput(stored));
      expect(declared.contextWindow).toBe(872_000);
      expect(declared.inputLimit).toBe(744_000);
      const undeclared = yield* capacityOf({ context: 1_000_000, output: 128_000 }).prepare(historyInput(stored));
      expect(undeclared.contextWindow).toBe(1_000_000);
      expect(undeclared.inputLimit).toBeNull();
    }),
  );
  it.live(
    'media leaves before a prefix does, and no provider has to refuse first',
    Effect.fnUntraced(function* () {
      const priced = makeThreadCompaction({
        models: lookupModels({
          request: () => uncallable,
          capacity: () => ({ context: 200_000, output: 32_000 }),
        }),
        policy: () => Effect.succeed({ ...policy, imageTokens: 100_000 }),
        strategy: makeThreadDigestStrategy(),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: offPathCheckpoints,
      });
      const withPictures = [
        Message.user([
          { type: 'media', mediaType: 'image/png', data: 'p'.repeat(700_000) },
          { type: 'text', text: 'what is in this screenshot' },
        ]),
        Message.user([{ type: 'media', mediaType: 'image/png', data: 'q'.repeat(700_000) }]),
        ...turns(2, 200),
      ];
      const result = yield* priced.prepare({ ...historyInput(withPictures), overflow: false });
      expect(result.compacted).toBe(false);
      expect(result.settlement).toBeUndefined();
      expect(JSON.stringify(result.messages)).not.toContain('ppppp');
      expect(JSON.stringify(result.messages)).toContain('what is in this screenshot');
    }),
  );
  it.live(
    'a summary that abandoned the work is refused, not settled',
    Effect.fnUntraced(function* () {
      const abandoning = makeThreadSummaryStrategy({
        models: lookupModels({
          request: () => ({
            ...uncallable,
            text: () => Effect.succeed(summaryResponse('The user asked about a bug.', 'stop')),
          }),
          capacity: () => ({ context: 200_000, output: 32_000 }),
          cacheLifetime: () => ({ promisedSeconds: null, prior: null }),
          compactionTrigger: () => undefined,
        }),
        prompt,
      });
      expect(
        yield* Effect.matchCause(
          abandoning.summarize({
            threadId: 'thread-1',
            ownerId: 'owner-1',
            provider: 'openai-oauth',
            model: 'gpt-5.6-sol',
            reasoning: null,
            switches: {},
            messages: turns(20, 4_000),
            alreadyCovered: 0,
            coveredMessageCount: 30,
            priorSummary: null,
            usableTokens: () => 150_000,
            summaryBudgetTokens: 32_000,
          }),
          { onFailure: Cause.squash, onSuccess: () => null },
        ),
      ).toMatchObject({ message: expect.stringMatching(/kept too little/) });
    }),
  );
  it.live(
    'a warm prefix standing exactly at the budget is sent as it stands; a cold one folds',
    Effect.fnUntraced(function* () {
      const atBudget = (cachedInputTokens: number | null) => {
        const meter = new ThreadRequestMeter();
        const stored = turns(24, 900);
        const priced = meter.request({ system: undefined, messages: stored, tools: [], providerOptions: undefined }, policy.imageTokens);
        return {
          ...historyInput(stored),
          stepNumber: 0,
          overflow: false,
          meter,
          measuredRequest: {
            inputTokens: 168_000,
            cachedInputTokens,
            provider: 'openai-oauth',
            model: 'gpt-5.6-sol',
            footprint: priced.footprint,
          },
        };
      };
      const warm = yield* compaction().prepare(atBudget(120_000));
      expect(warm.compacted).toBe(false);
      expect(warm.decision).toBeNull();
      const cold = yield* compaction().prepare(atBudget(null));
      expect(cold.compacted).toBe(true);
      expect(cold.decision?.cause).toBe('measured');
      expect(cold.decision?.measuredTokens).toBe(168_000);
    }),
  );
  it.live(
    'a measurement of another request neither sizes nor compacts this one',
    Effect.fnUntraced(function* () {
      const stored = turns(6, 4_000);
      const base = { ...historyInput(stored), overflow: false };
      const cold = yield* compaction().prepare({ ...base, measuredRequest: measuredAt(900_000, null) });
      const warm = yield* compaction().prepare({ ...base, measuredRequest: measuredAt(900_000, 120_000) });
      expect(cold.compacted).toBe(false);
      expect(warm.compacted).toBe(false);
    }),
  );
  test('a count past the end has no identity, so it can never satisfy a shorter history', () => {
    const stored = turns(2, 10);
    const projected = [...stored, Message.user('what overflow recovery appended')];
    const pastTheRecord = projected.length;
    const meter = new ThreadRequestMeter();
    expect(meter.prefixDigest(projected, pastTheRecord, 0)).not.toBeNull();
    expect(meter.prefixDigest(stored, pastTheRecord, 0)).toBeNull();
    expect(meter.prefixDigest(stored, pastTheRecord, 0)).not.toBe(meter.prefixDigest(projected, pastTheRecord, 0));
  });
  it.effect(
    'a pass that has to cut twice settles one fold that covers both cuts, and the thread holds exactly what was sent',
    Effect.fnUntraced(function* () {
      const halves: number[] = [];
      const weak: ThreadCompactionStrategy = {
        summarize: (segment: ThreadCompactionSegment) =>
          Effect.sync(() => {
            const coveredMessageCount = Math.max(1, Math.floor(segment.coveredMessageCount / 2));
            halves.push(coveredMessageCount);
            return { coveredMessageCount, summary: 'w'.repeat(120_000), usage: null };
          }),
      };
      const compaction = makeThreadCompaction({
        models: lookupModels({
          request: () => uncallable,
          capacity: () => ({ context: 200_000, output: 32_000 }),
        }),
        policy: () => Effect.succeed(policy),
        strategy: weak,
        recovery: weak,
        text,
        checkpoints: offPathCheckpoints,
      });
      const stored = turns(30, 20_000);
      const result = yield* compaction.prepare({
        ...historyInput(stored),
        measuredRequest: { ...measuredOver(stored), inputTokens: rawOf(stored) },
      });
      expect(halves.length).toBeGreaterThan(1);
      expect(result.compacted).toBe(true);
      const settlement = result.settlement;
      if (!settlement?.checkpoint) return yield* Effect.die('a summarized prefix names a checkpoint row');
      expect(settlement.covers(stored)).toBe(true);
      expect(settlement.checkpoint.coveredMessageCount).toBeGreaterThan(halves[0]!);
      expect([...settlement.replaced.messages, ...stored.slice(settlement.replaced.keepFrom)]).toEqual([...result.messages]);
      expect(result.decision?.projectedTokens).toBeGreaterThan(result.decision!.usableTokens);
      expect(result.correctedTokens).toBeLessThanOrEqual(result.decision!.usableTokens);
    }),
  );
  it.live(
    'a refused request is never handed back unreduced, whatever the forecast says of it',
    Effect.fnUntraced(function* () {
      const stored = turns(8, 900);
      const before = new ThreadRequestMeter().request(
        { system: undefined, messages: stored, tools: [], providerOptions: undefined },
        policy.imageTokens,
      );
      const result = yield* compaction().prepare({ ...historyInput(stored), overflow: true });
      expect(result.compacted).toBe(true);
      expect(result.decision?.cause).toBe('overflow');
      expect(result.decision?.projectedTokens).toBeGreaterThan(result.correctedTokens);
      const after = new ThreadRequestMeter().request(
        { system: undefined, messages: result.messages, tools: [], providerOptions: undefined },
        policy.imageTokens,
      );
      expect(after.tokens).toBeLessThan(before.tokens);
    }),
  );
  it.live(
    'a cut that drops the basis is progress, however the forecast reads afterwards',
    Effect.fnUntraced(function* () {
      const meter = new ThreadRequestMeter();
      const stored = turns(30, 20_000);
      const priced = meter.request(
        { system: undefined, messages: stored.slice(0, 10), tools: [], providerOptions: undefined },
        policy.imageTokens,
      );
      const whole = meter.request({ system: undefined, messages: stored, tools: [], providerOptions: undefined }, policy.imageTokens);
      const owner = makeThreadCompaction({
        models: lookupModels({
          request: () => uncallable,
          capacity: () => ({ context: 200_000, output: 32_000 }),
        }),
        policy: () => Effect.succeed(policy),
        strategy: makeThreadDigestStrategy(),
        recovery: makeThreadDigestStrategy(),
        text,
        checkpoints: offPathCheckpoints,
        calibration: { baseline: () => 2 },
      });
      const result = yield* owner.prepare({
        ...historyInput(stored),
        meter,
        measuredRequest: {
          inputTokens: 150_000,
          cachedInputTokens: null,
          provider: 'openai-oauth',
          model: 'gpt-5.6-sol',
          footprint: priced.footprint,
        },
      });
      expect(result.compacted).toBe(true);
      const rawOfResult = meter.request(
        { system: undefined, messages: result.messages, tools: [], providerOptions: undefined },
        policy.imageTokens,
      ).tokens;
      expect(rawOfResult).toBeLessThan(whole.tokens);
    }),
  );
});
describe('ThreadDigestStrategy', () => {
  it.live(
    'keeps the prior state ahead of the newest lines inside the budget',
    Effect.fnUntraced(function* () {
      const messages: Message[] = Array.from({ length: 10 }, (_, index): Message =>
        Message.make({ role: index % 2 === 0 ? 'user' : 'assistant', content: `${index}:${'x'.repeat(4_000)}` }),
      );
      const result = yield* makeThreadDigestStrategy().summarize({
        threadId: 'thread-1',
        ownerId: 'owner-1',
        provider: 'openai-oauth',
        model: 'gpt-5.6-luna',
        reasoning: null,
        switches: {},
        messages,
        alreadyCovered: 0,
        coveredMessageCount: messages.length,
        priorSummary: '## Objective\n- Continue the task.',
        usableTokens: () => Number.POSITIVE_INFINITY,
        summaryBudgetTokens: 3_000,
      });
      expect(result.coveredMessageCount).toBe(messages.length);
      expect(result.usage).toBeNull();
      expect(result.summary.startsWith('## Objective')).toBe(true);
      expect(result.summary).toContain('[truncated]');
      expect(result.summary).toContain('9:');
      expect(result.summary).not.toContain('0:');
      expect(estimateThreadTokens(result.summary)).toBeLessThanOrEqual(3_000);
    }),
  );
});
describe('ThreadCompaction pruning fold', () => {
  const models = lookupModels({
    request: () => uncallable,
    capacity: () => ({ context: 200_000, output: 32_000 }),
  });
  const prunable = (): Message[] => [
    Message.user('Investigate the repository from the first turn.'),
    ...Array.from({ length: 8 }, (_, index): Message => ({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          id: `call-${index}`,
          name: 'read_source',
          result: { type: 'text', value: `${index}:${'x'.repeat(50_000)}` },
        },
      ],
    })),
    Message.user('Continue from the second turn.'),
    Message.assistant('Continuing.'),
    Message.user('Start the newest turn.'),
  ];
  function storage(overrides: Partial<ThreadCompactionStorage> = {}) {
    let decided = new Set<string>();
    const retired: {
      threadId: string;
      toolCallIds: readonly string[];
      tx: unknown;
    }[] = [];
    const written: ThreadCheckpointWrite[] = [];
    const faces: ThreadCompactionStorage = {
      latestCheckpoint: () => Effect.succeed(null),
      prunedToolCalls: () => Effect.sync(() => decided),
      prunedToolCallVolume: () => Effect.sync(() => ({ count: decided.size, tokens: 0 })),
      compactionCount: () => Effect.succeed(0),
      markToolCallsPrunedIn: (_threadId: string, calls: readonly ThreadPrunedToolCall[]) =>
        Effect.sync(() => {
          decided = new Set([...decided, ...calls.map((call) => call.toolCallId)]);
        }),
      retirePrunedToolCallsIn: (threadId: string, toolCallIds: readonly string[], tx: unknown) =>
        Effect.sync(() => {
          retired.push({ threadId, toolCallIds: [...toolCallIds], tx });
        }),
      writeCheckpointIn: (input: ThreadCheckpointWrite) =>
        Effect.map(Clock.currentTimeMillis, (now) => {
          written.push(input);
          return {
            id: 'checkpoint-1',
            threadId: input.threadId,
            sourceRunId: input.sourceRunId,
            coveredMessageCount: input.coveredMessageCount,
            coveredPrefixHash: input.coveredPrefixHash,
            summary: input.summary,
            usage: input.usage,
            createdAt: new Date(now),
          };
        }),
      ...overrides,
    };
    return { faces, retired, written, decided: () => decided };
  }
  const owner = (checkpoints: ReturnType<typeof storage>) =>
    makeThreadCompaction({
      models,
      policy: () => Effect.succeed(policy),
      strategy: makeThreadDigestStrategy(),
      recovery: makeThreadDigestStrategy(),
      text,
      checkpoints: checkpoints.faces,
    });
  const request = (history: readonly Message[]) => ({
    threadId: 'thread-1',
    runId: 'run-1',
    stepNumber: 0,
    ownerId: 'owner-1',
    provider: 'openai-oauth',
    model: 'gpt-5.6-luna',
    reasoning: null,
    switches: {},
    sourceMessages: history,
    history,
    tools: [],
    plannedOutputTokens: 32_000,
    overflow: false,
    meter: new ThreadRequestMeter(),
  });
  it.live(
    'a turn that only pruned answers a fold over the stored history, and no row',
    Effect.fnUntraced(function* () {
      const history = prunable();
      const checkpoints = storage();
      const result = yield* owner(checkpoints).prepare(request(history));
      expect(result.compacted).toBe(false);
      const settlement = result.settlement;
      if (!settlement) return yield* Effect.die(new Error('a pruned turn owes the record a fold'));
      expect(settlement.checkpoint).toBeUndefined();
      expect(settlement.retiredToolCalls).toEqual([]);
      expect(settlement.replaced.keepFrom).toBe(history.length);
      expect(settlement.replaced.messages).toEqual(result.messages as Message[]);
      expect(JSON.stringify(settlement.replaced.messages)).toContain(text.prunedToolOutput);
      expect(JSON.stringify(settlement.replaced.messages).length).toBeLessThan(JSON.stringify(history).length / 2);
    }),
  );
  it.live(
    'the fold keeps what was appended after it was computed, and refuses a record that moved',
    Effect.fnUntraced(function* () {
      const history = prunable();
      const settlement = (yield* owner(storage()).prepare(request(history))).settlement;
      if (!settlement) return yield* Effect.die(new Error('a pruned turn owes the record a fold'));
      const grown = [...history, Message.user('what the run appended after the projection')];
      expect(settlement.covers(grown)).toBe(true);
      const folded = [...settlement.replaced.messages, ...grown.slice(settlement.replaced.keepFrom)];
      expect(folded.at(-1)).toEqual(Message.user('what the run appended after the projection'));
      expect(settlement.covers([Message.user('a different opening'), ...history.slice(1)])).toBe(false);
      expect(settlement.covers(history.slice(0, 4))).toBe(false);
    }),
  );
  it.live(
    'a record already reading as its markers is folded by nothing',
    Effect.fnUntraced(function* () {
      const history = prunable();
      const checkpoints = storage();
      const compaction = owner(checkpoints);
      const first = yield* compaction.prepare(request(history));
      const folded = first.settlement?.replaced.messages;
      if (!folded) return yield* Effect.die(new Error('the first turn folds the record'));
      const second = yield* compaction.prepare(request(folded));
      expect(second.settlement).toBeUndefined();
      expect(second.messages).toEqual(folded as Message[]);
    }),
  );
  it.live(
    'a summarized prefix takes its pruned calls with it, and the marks end there',
    Effect.fnUntraced(function* () {
      const history = prunable();
      const checkpoints = storage();
      const compaction = owner(checkpoints);
      const prepared = yield* compaction.prepare(request(history));
      yield* compaction.settleIn(prepared.settlement!, 'the-caller-unit');
      const compacted = yield* compaction.compact({
        threadId: 'thread-1',
        runId: 'run-2',
        ownerId: 'owner-1',
        provider: 'openai-oauth',
        model: 'gpt-5.6-luna',
        reasoning: null,
        switches: {},
        sourceMessages: history,
      });
      const settlement = compacted.settlement;
      if (!settlement) return yield* Effect.die(new Error('an explicit compaction answers a settlement'));
      expect(settlement.checkpoint).toBeDefined();
      expect([...settlement.retiredToolCalls].sort()).toEqual([...checkpoints.decided()].sort());
      yield* compaction.settleIn(settlement, 'the-caller-unit');
      expect(checkpoints.written).toHaveLength(1);
      expect(checkpoints.retired).toEqual([
        {
          threadId: 'thread-1',
          toolCallIds: [...settlement.retiredToolCalls],
          tx: 'the-caller-unit',
        },
      ]);
    }),
  );
  it.effect(
    'settlement carries reader skill requests through repeated compaction and later reader replacement',
    Effect.fnUntraced(function* () {
      const compaction = owner(storage());
      const history = [Message.user('Use $review and $review.'), Message.assistant('Working.')];
      const first = yield* compaction.compact(request(history));
      const folded = first.settlement?.replaced.messages;
      if (!folded) return yield* Effect.die('manual compaction must propose its durable fold');
      expect(agentInputSkills(folded[0]!)).toEqual(new Set(['review']));
      const second = yield* compaction.compact(request(folded));
      expect(agentInputSkills(second.settlement!.replaced.messages[0]!)).toEqual(new Set(['review']));
      const later = [
        Message.user('Continue without a skill request.'),
        Message.assistant('Continuing.'),
        Message.user('Next.'),
        Message.assistant('Next done.'),
        Message.user('Last.'),
      ];
      const replaced = yield* compaction.compact(request([...folded, ...later]));
      expect(agentInputSkills(replaced.settlement!.replaced.messages[0]!)).toBeNull();
    }),
  );
  it.live(
    'a pruning fold writes no checkpoint row when the owner settles it',
    Effect.fnUntraced(function* () {
      const checkpoints = storage({
        writeCheckpointIn: () => Effect.die(new Error('a pruning fold has no row to write')),
      });
      const result = yield* owner(checkpoints).prepare(request(prunable()));
      const settlement = result.settlement;
      if (!settlement) return yield* Effect.die(new Error('a pruned turn owes the record a fold'));
      yield* owner(checkpoints).settleIn(settlement, 'the-caller-unit');
      expect(checkpoints.written).toEqual([]);
      expect(checkpoints.retired).toEqual([]);
    }),
  );
});
describe('ThreadCompaction split-turn opening', () => {
  const brief = Message.user(
    `Build the parser behind PARSE-17. Keep the grammar in docs/grammar.md. ${'One more constraint to honour. '.repeat(110)}`,
  );
  const step = (id: string, chars: number): Message[] => [
    Message.assistant([ToolCallPart.from({ id, name: 'read', input: { path: `${id}.ts` } })]),
    Message.tool({ id, name: 'read', result: { type: 'text', value: 'x'.repeat(chars) } }),
  ];
  const running = [
    Message.user('Earlier task'),
    Message.assistant('Earlier answer'),
    brief,
    ...step('c1', 16_000),
    ...step('c2', 16_000),
    ...step('c3', 16_000),
  ];
  const owner = (
    options: {
      readonly figure?: number;
      readonly summary?: string;
    } = {},
  ) => {
    const anchored: ThreadCompactionStrategy = {
      summarize: (segment) =>
        Effect.succeed({
          coveredMessageCount: segment.coveredMessageCount,
          summary: options.summary ?? 'Anchored state.',
          usage: null,
        }),
    };
    return makeThreadCompaction({
      models: lookupModels({
        request: () => uncallable,
        capacity: () => ({ context: 200_000, output: 32_000 }),
      }),
      policy: () => Effect.succeed({ ...policy, maxOpeningTokens: options.figure ?? policy.maxOpeningTokens }),
      strategy: anchored,
      recovery: anchored,
      text,
      checkpoints: offPathCheckpoints,
    });
  };
  const requested = (messages: readonly Message[]) => ({
    threadId: 'thread-1',
    runId: 'run-1',
    stepNumber: 4,
    ownerId: 'owner-1',
    provider: 'openai-oauth',
    model: 'gpt-5.6-sol',
    reasoning: null,
    switches: {},
    history: messages,
    tools: [],
    plannedOutputTokens: 32_000,
    overflow: false,
    meter: new ThreadRequestMeter(),
    requested: {},
  });
  const explicit = (messages: readonly Message[]) => ({
    threadId: 'thread-1',
    runId: 'run-1',
    ownerId: 'owner-1',
    provider: 'openai-oauth',
    model: 'gpt-5.6-sol',
    reasoning: null,
    switches: {},
    sourceMessages: messages,
  });
  const committed = (
    history: readonly Message[],
    settlement:
      | {
          readonly replaced: {
            readonly keepFrom: number;
            readonly messages: readonly Message[];
          };
        }
      | undefined,
  ) => {
    if (settlement === undefined) throw new Error('a summarized cut answers a fold');
    return [...settlement.replaced.messages, ...history.slice(settlement.replaced.keepFrom)];
  };
  const copiesOf = (messages: readonly Message[], message: Message) =>
    messages.filter((each) => JSON.stringify(each) === JSON.stringify(message)).length;
  it.live(
    'a cut inside the turn keeps its opening verbatim after the summary, in the projection and the fold alike, and still fits',
    Effect.fnUntraced(function* () {
      const result = yield* owner().prepare(requested(running));
      expect(result.compacted).toBe(true);
      expect(result.settlement?.checkpoint?.coveredMessageCount).toBe(running.length - 2);
      expect(result.messages.slice(0, 2).map(agentOriginOf)).toEqual(['summary', 'summary']);
      expect(result.messages[2]).toBe(brief);
      expect(result.messages.slice(3)).toEqual(running.slice(-2));
      expect(committed(running, result.settlement)).toEqual([...result.messages]);
      expect(result.correctedTokens).toBeLessThanOrEqual(result.decision!.usableTokens);
    }),
  );
  it.live(
    'a cut covering the whole recorded history pins nothing',
    Effect.fnUntraced(function* () {
      const record = [Message.user('Earlier task'), Message.assistant('Earlier answer'), brief, ...step('c1', 40_000)];
      const result = yield* owner().prepare({ ...requested(record), stepNumber: 0 });
      expect(result.settlement?.checkpoint?.coveredMessageCount).toBe(record.length);
      expect(committed(record, result.settlement)).toEqual([...result.messages]);
      expect(copiesOf(result.messages, brief)).toBe(0);
    }),
  );
  it.live(
    'an opening over the host figure is not pinned, not even in part, and one at the figure is',
    Effect.fnUntraced(function* () {
      const size = estimateThreadTokens(brief, policy.imageTokens);
      const over = yield* owner({ figure: size - 1 }).prepare(requested(running));
      const at = yield* owner({ figure: size }).prepare(requested(running));
      expect(over.messages.slice(2)).toEqual(running.slice(-2));
      expect(committed(running, over.settlement)).toEqual([...over.messages]);
      expect(JSON.stringify(over.messages)).not.toContain('PARSE-17');
      expect(at.messages[2]).toBe(brief);
    }),
  );
  it.live(
    'a cut on a turn boundary pins nothing',
    Effect.fnUntraced(function* () {
      const history = [
        Message.user('Earlier task'),
        Message.assistant('e'.repeat(40_000)),
        Message.user('Next task'),
        Message.assistant('Done.'),
      ];
      const result = yield* owner().compact(explicit(history));
      const folded = committed(history, result.settlement);
      expect(result.settlement?.checkpoint?.coveredMessageCount).toBe(2);
      expect(folded).toHaveLength(4);
      expect(folded.slice(2)).toEqual(history.slice(2));
    }),
  );
  it.live(
    'a cut that would fold nothing but the opening covers it as before, so the pass still reduces',
    Effect.fnUntraced(function* () {
      const opening = Message.user(`Paste: ${'p'.repeat(20_000)}`);
      const turn = [
        opening,
        withAgentOrigin(Message.user(`<workspace>${'w'.repeat(6_000)}</workspace>`), 'orientation'),
        ...step('c1', 8_000),
        ...step('c2', 8_000),
      ];
      const mid = yield* owner().prepare(requested(turn));
      const idle = yield* owner().compact(explicit(turn));
      expect(mid.compacted).toBe(true);
      expect(mid.settlement?.checkpoint?.coveredMessageCount).toBe(1);
      expect(mid.messages.slice(2)).toEqual(turn.slice(1));
      expect(estimateThreadTokens(committed(turn, idle.settlement))).toBeLessThan(estimateThreadTokens(turn));
    }),
  );
  it.live(
    'an envelope between the opening and the cut — a steer, a task that woke the thread — keeps an older opening from speaking last',
    Effect.fnUntraced(function* () {
      const steer = agentSignalMessage({
        id: 'steer-1',
        type: 'user-message',
        addressee: 'reader',
        text: 'Also use $writer.',
        occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      });
      const woken = agentSignalMessage({
        id: 'task-1',
        type: 'task',
        text: 'New task: write the release notes.',
        occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      });
      const steered = [...running.slice(0, 5), steer, ...running.slice(5)];
      const rewoken = [Message.user('Old task: build the parser.'), Message.assistant('Built.'), woken, ...running.slice(3)];
      for (const history of [steered, rewoken]) {
        const result = yield* owner().prepare(requested(history));
        expect(result.compacted).toBe(true);
        expect(result.messages.slice(2)).toEqual(history.slice(-2));
        expect(committed(history, result.settlement)).toEqual([...result.messages]);
      }
    }),
  );
  it.live(
    'on an overflow retry the pin is decided over the history the fold commits, and a pinned opening keeps the picture of the turn it opens',
    Effect.fnUntraced(function* () {
      const pictured = Message.user([
        { type: 'text', text: 'Build the parser behind PARSE-17 from this sketch.' },
        { type: 'media', mediaType: 'image/png', data: '/api/threads/t-1/attachments/sketch.png' },
      ]);
      const history = [Message.user('Earlier task'), Message.assistant('e'.repeat(700_000)), pictured, ...running.slice(3)];
      const size = estimateThreadTokens(pictured, 1_600);
      const withPictures = (figure: number) => {
        const anchored: ThreadCompactionStrategy = {
          summarize: (segment) =>
            Effect.succeed({ coveredMessageCount: segment.coveredMessageCount, summary: 'Anchored state.', usage: null }),
        };
        return makeThreadCompaction({
          models: lookupModels({ request: () => uncallable, capacity: () => ({ context: 200_000, output: 32_000 }) }),
          policy: () => Effect.succeed({ ...policy, imageTokens: 1_600, maxOpeningTokens: figure }),
          strategy: anchored,
          recovery: anchored,
          text,
          checkpoints: offPathCheckpoints,
        });
      };
      const { requested: _asked, ...unasked } = requested(history);
      const overflowing = { ...unasked, overflow: true, measuredRequest: measuredOver(history) };
      for (const figure of [size, size - 1]) {
        const result = yield* withPictures(figure).prepare(overflowing);
        const pinned = figure === size;
        expect(result.compacted).toBe(true);
        expect(committed(history, result.settlement)[2] === pictured).toBe(pinned);
        expect(result.messages[2]?.content[0]).toEqual(pinned ? pictured.content[0] : history.at(-2)?.content[0]);
        expect(JSON.stringify(result.messages).includes('sketch.png')).toBe(pinned);
      }
    }),
  );
  it.live(
    'runtime guidance opens no turn: a tail starting on it still pins the words that opened the work',
    Effect.fnUntraced(function* () {
      const guidance = agentRuntimeGuidanceMessage('Notes over the file just read.');
      const history = [
        Message.user('Earlier task'),
        Message.assistant('Earlier answer'),
        brief,
        ...step('c1', 40_000),
        guidance,
        ...step('c2', 400),
      ];
      const result = yield* owner().compact(explicit(history));
      const folded = committed(history, result.settlement);
      expect(result.settlement?.checkpoint?.coveredMessageCount).toBe(5);
      expect(folded[2]).toBe(brief);
      expect(folded.slice(3)).toEqual(history.slice(5));
    }),
  );
  it.live(
    'a second compaction over a pinned history carries the opening once while its turn is retained',
    Effect.fnUntraced(function* () {
      const first = yield* owner().prepare(requested(running));
      const pinned = committed(running, first.settlement);
      const grown = [...pinned, ...step('c4', 16_000), ...step('c5', 16_000)];
      const again = yield* owner().prepare(requested(grown));
      expect(again.compacted).toBe(true);
      expect(again.messages[2]).toBe(brief);
      expect(copiesOf(again.messages, brief)).toBe(1);
      expect(copiesOf(committed(grown, again.settlement), brief)).toBe(1);
      expect(again.messages.slice(3)).toEqual(grown.slice(-2));
    }),
  );
  it.live(
    'a second cut landing on the pinned opening keeps it as the tail start, once',
    Effect.fnUntraced(function* () {
      const longer = [...running, ...step('c4', 16_000), ...step('c5', 16_000)];
      const first = yield* owner({ summary: 's'.repeat(40_000) }).prepare(requested(longer));
      const pinned = committed(longer, first.settlement);
      const grown = [...pinned, Message.assistant('Nearly done.')];
      const again = yield* owner().compact(explicit(grown));
      const folded = committed(grown, again.settlement);
      expect(again.settlement?.checkpoint?.coveredMessageCount).toBe(2);
      expect(folded.slice(2)).toEqual(grown.slice(2));
      expect(copiesOf(folded, brief)).toBe(1);
    }),
  );
  test('every cut the selector may answer leaves a provider-paired request: marker, summary, at most the pinned opening, then the tail', () => {
    const history = [
      Message.user('Earlier task'),
      Message.assistant('Earlier answer'),
      brief,
      Message.assistant([
        ToolCallPart.from({ id: 'p1', name: 'read', input: { path: 'a.ts' } }),
        ToolCallPart.from({ id: 'p2', name: 'read', input: { path: 'b.ts' } }),
      ]),
      Message.make({
        role: 'tool',
        content: [
          ToolResultPart.from({ id: 'p1', name: 'read', result: { type: 'text', value: 'a' } }),
          ToolResultPart.from({ id: 'p2', name: 'read', result: { type: 'text', value: 'b' } }),
        ],
      }),
      agentRuntimeGuidanceMessage('Notes over the files just read.'),
      Message.assistant('Reading on.'),
      ...step('p3', 400),
      Message.assistant('Done.'),
      Message.user('Next task'),
      ...step('p4', 400),
    ];
    let pins = 0;
    for (let covered = 1; covered <= history.length; covered += 1) {
      if (history[covered]?.role === 'tool') continue;
      const projected = projectThreadHistory(
        history,
        { coveredMessageCount: covered, summary: 'Anchored state.' },
        text.checkpointMarker,
        policy,
      );
      const between = projected.slice(2, projected.length - (history.length - covered));
      expect(pairedForProvider(projected)).toBe(projected);
      expect(projected.slice(0, 2).map((message) => message.role)).toEqual(['user', 'assistant']);
      expect(projected.slice(2 + between.length)).toEqual(history.slice(covered));
      expect(between.length).toBeLessThanOrEqual(1);
      expect(between.every((message) => message.role === 'user')).toBe(true);
      pins += between.length;
    }
    expect(pins).toBeGreaterThan(0);
  });
});
describe('ThreadCompaction strategy choice', () => {
  const counted = (calls: { count: number }): ThreadCompactionStrategy => ({
    summarize: (segment) =>
      Effect.sync(() => {
        calls.count += 1;
        return { coveredMessageCount: segment.coveredMessageCount, summary: 'Anchored state.', usage: null };
      }),
  });
  const failing: ThreadCompactionStrategy = {
    summarize: (segment) => Effect.fail(new ThreadSummaryFailedError(segment.threadId, 'empty', 'the model gave no summary.')),
  };
  const owner = (strategy: ThreadCompactionStrategy) =>
    makeThreadCompaction({
      models: calibrationModels,
      policy: () => Effect.succeed({ ...policy, compactionTrigger: { strategy: 'percent', trigger: 0.5 } }),
      strategy,
      recovery: makeThreadDigestStrategy(),
      text,
      checkpoints: offPathCheckpoints,
      calibration: { baseline: () => 1 },
    });
  const long = () => [...turns(18, 20_000), Message.user('the newest request')];
  const fitting = () => [...turns(13, 20_000), Message.user('the newest request')];
  it.live(
    'a definition with compaction off sends an over-long thread as it is, and refuses an overflow replay and a request typed',
    Effect.fnUntraced(function* () {
      const calls = { count: 0 };
      const compactor = owner(counted(calls));
      const thread = recordedThread(long());
      const sent = yield* (yield* anchorOver(compactor, thread, { strategy: 'off' })).project(stepOf(2));
      expect(sent.messages).toEqual(thread.stored);
      expect(thread.entries).toEqual([]);
      const replay = yield* (yield* anchorOver(compactor, thread, { strategy: 'off' }))
        .project({ ...stepOf(2), contextOverflow: true })
        .pipe(Effect.flip);
      expect(replay.cause).toBeInstanceOf(ThreadCompactionExhaustedError);
      const asked = yield* compactor
        .compact({
          threadId: 'thread-1',
          runId: 'run-1',
          ownerId: 'owner-1',
          provider: 'openai-oauth',
          model: 'gpt-5.6-sol',
          reasoning: null,
          switches: {},
          sourceMessages: long(),
          strategy: 'off',
        })
        .pipe(Effect.flip);
      expect(asked).toBeInstanceOf(ThreadCompactionOffError);
      expect(calls.count).toBe(0);
    }),
  );
  it.live(
    'a definition names its strategy from the registry, and a name nobody registered fails typed',
    Effect.fnUntraced(function* () {
      const standing = { count: 0 };
      const named = { count: 0 };
      const compactor = owner(counted(standing));
      yield* compactor.strategies.register('test', 'noted', counted(named));
      yield* (yield* anchorOver(compactor, recordedThread(long()), { strategy: 'noted' })).project(stepOf(2));
      expect([named.count, standing.count]).toEqual([1, 0]);
      yield* (yield* anchorOver(compactor, recordedThread(long()))).project(stepOf(2));
      expect([named.count, standing.count]).toEqual([1, 1]);
      const unknown = yield* (yield* anchorOver(compactor, recordedThread(long()), { strategy: 'ghost' }))
        .project(stepOf(2))
        .pipe(Effect.flip);
      expect(unknown.cause).toBeInstanceOf(ThreadCallBroke);
      expect((unknown.cause as ThreadCallBroke).cause).toBeInstanceOf(RegistryAbsent);
    }),
  );
  it.live(
    'an automatic compaction that fails continues the step when the request fits the provider, and refuses typed when it does not',
    Effect.fnUntraced(function* () {
      const compactor = owner(failing);
      const fits = recordedThread(fitting());
      const continued = yield* (yield* anchorOver(compactor, fits)).project(stepOf(2));
      expect(continued.messages).toEqual(fits.stored);
      expect(fits.entries.map((entry) => entry.status)).toEqual(['running', 'failed']);
      const over = recordedThread(long());
      const refused = yield* (yield* anchorOver(compactor, over)).project(stepOf(2)).pipe(Effect.flip);
      expect(refused.cause).toBeInstanceOf(ThreadSummaryFailedError);
      expect(over.entries.map((entry) => entry.status)).toEqual(['running']);
      expect(over.stored).toEqual(long());
    }),
  );
  it.live(
    'a summary the model refused ends its compaction activity with the provider reason',
    Effect.fnUntraced(function* () {
      const limited = new LLMError({ module: 'LLM', method: 'text', reason: new RateLimitReason({ message: 'slow down' }) });
      const compactor = owner({
        summarize: (segment) => Effect.fail(new ThreadSummaryFailedError(segment.threadId, 'model', limited.message, limited)),
      });
      const recording = activityRecording();
      const refused = yield* compactor
        .compact({
          threadId: 'thread-1',
          runId: 'run-1',
          ownerId: 'owner-1',
          provider: 'openai-oauth',
          model: 'gpt-5.6-sol',
          reasoning: null,
          switches: {},
          sourceMessages: [Message.user('work'), Message.assistant('done')],
        })
        .pipe(Effect.provideService(ActivityLog, recording.log), Effect.flip);
      expect(refused).toBeInstanceOf(ThreadSummaryFailedError);
      expect(recording.activities().find((activity) => activity.opened.kind === 'compaction')?.ended).toMatchObject({
        outcome: 'failed',
        reason: 'RateLimit',
      });
    }),
  );
});
function turns(count: number, textLength: number): Message[] {
  return Array.from({ length: count }, (_, index) => [
    Message.user(`${index}:${'u'.repeat(textLength)}`),
    Message.assistant(`${index}:${'a'.repeat(textLength)}`),
  ]).flat();
}
function summaryResponse(text: string, finishReason: FinishReason): LLMResponse {
  return new LLMResponse({
    message: Message.assistant(text),
    events: [{ type: 'text-delta', id: 'text-1', text }],
    usage: new Usage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
    finishReason,
  });
}
