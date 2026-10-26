import { openModelClient } from '@runlith/llm/models/client';
import { lookupModels } from '@runlith/agent/thread/compaction/lookupModels';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { approvalModesLayer } from '@runlith/agent/modes/ApprovalModes';
import * as Memory from '@runlith/testbed/memory';
import { join } from 'node:path';
import { Clock, Context, Effect, FileSystem, Layer, Queue, Schema } from 'effect';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { Agent } from '@runlith/agent/Agent';
import { type AgentRunner, makeAgentRunner } from '@runlith/agent/AgentRunner';
import { Tool } from '@runlith/agent/tool';
import { deferredToolsSection } from '@runlith/agent/AgentDeferredTools';
import { modelRequester } from '@runlith/agent/ModelRequests';
import { renderWorldState, type WorldStateSnapshot } from '@runlith/agent/WorldState';
import { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { threadAgentsLayer, threadCompactorLayer, threadStorageLayer } from '@runlith/agent/thread/kernelPorts';
import { threadHostLayer } from '@runlith/agent/thread/ThreadPorts';
import { makeThreadCompaction } from '@runlith/agent/thread/compaction/ThreadCompaction';
import { makeThreadDigestStrategy } from '@runlith/agent/thread/compaction/digestStrategy';
import { makeThreadLiveFeed } from '@runlith/agent/thread/run/ThreadLiveFeed';
import { makeThreadSummaryStrategy } from '@runlith/agent/thread/compaction/summaryStrategy';
import { threadAgent, type ThreadToolContextInput } from '@runlith/agent/thread/agents/ThreadAgent';
import { registeredAgents } from '@runlith/agent/thread/conformance/agents';
import type { ThreadState } from '@runlith/agent/thread/state';
import { doorOf } from '@runlith/llm/route/transport/doorOf';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { Message } from '@runlith/llm/schema/messages';
import { subscriptionRegistration } from '@runlith/builtin-catalog/subscription/provider';
import { openaiSubscriptionRegistration } from '@runlith/adapter-openai/profiles/openai';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { openMemoryStorage } from '@runlith/agent/thread/conformance/memoryStorage';
import { inertAttachments, inertToolOutputs } from '@runlith/agent/thread/conformance/runLog/world';
import { COMPACTION_POLICY, COMPACTION_PROMPT, COMPACTION_TEXT } from '../../../native-harness/testing/doubles.js';
import { AGENT_IDLE_MS, LEASE_RHYTHM, REAPER_RHYTHM, SETTLEMENT_RHYTHM } from '../../../threads/testing/doubles.js';
import { RECORDED_PRODUCT } from '@runlith/llm/profiles/recordedProduct';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
type Answer =
  | {
      text: string;
    }
  | {
      call: {
        name: string;
        input: unknown;
      };
    };
const answers: Answer[] = [];
const sent: Array<{
  model: string;
  body: Record<string, unknown>;
}> = [];
let serial = 0;
let executed = 0;
class ProviderWorld extends Context.Service<
  ProviderWorld,
  {
    readonly storage: Effect.Success<ReturnType<typeof openMemoryStorage>>;
    readonly harness: AgentHarness;
  }
>()('test/ProviderWorld') {}
const credentials: ModelCredentials = {
  apiKey: async () => 'test-key',
  accessToken: async (_owner, _provider, account) => `test-token-${account ?? 'a'}`,
  credential: async (_owner, _provider, account) => ({
    accessToken: 'token',
    refreshToken: 'refresh',
    expiresAt: 0,
    scope: '',
    account: { uuid: account ?? 'a', email: `${account ?? 'a'}@example.com` },
    organization: { uuid: 'organization-uuid', name: '' },
    accountId: 'gpt-account',
  }),
};
const fixture = Layer.effect(
  ProviderWorld,
  Effect.gen(function* () {
    const storage = yield* openMemoryStorage();
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped();
    const fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        const path = new URL(request.url).pathname;
        if (path !== '/v1/messages' && path !== '/backend-api/codex/responses') throw new Error(`Unexpected request ${path}`);
        const body = (await request.json()) as Record<string, unknown>;
        sent.push({ model: String(body.model), body });
        const answer = answers.shift();
        if (answer === undefined) throw new Error('The model made an unplanned call');
        const id = ++serial;
        const call = 'call' in answer ? answer.call : undefined;
        const text = 'text' in answer ? answer.text : '';
        const anthropic = path === '/v1/messages';
        const frames = anthropic
          ? [
              { type: 'message_start', message: { id: `msg_${id}`, usage: { input_tokens: 20 } } },
              {
                type: 'content_block_start',
                index: 0,
                content_block:
                  call === undefined
                    ? { type: 'text', text }
                    : {
                        type: 'tool_use',
                        id: `call_${id}`,
                        name: call.name,
                        input: call.input,
                      },
              },
              ...(call === undefined
                ? []
                : [
                    {
                      type: 'content_block_delta',
                      index: 0,
                      delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) },
                    },
                  ]),
              { type: 'content_block_stop', index: 0 },
              { type: 'message_delta', delta: { stop_reason: call === undefined ? 'end_turn' : 'tool_use' }, usage: { output_tokens: 5 } },
            ]
          : [
              ...(call === undefined
                ? [
                    { type: 'response.output_item.added', item: { id: `text_${id}`, type: 'message', role: 'assistant', content: [] } },
                    { type: 'response.output_text.delta', item_id: `text_${id}`, delta: text },
                  ]
                : [
                    {
                      type: 'response.output_item.done',
                      item: {
                        id: `fc_${id}`,
                        type: 'function_call',
                        call_id: `call_${id}`,
                        name: call.name,
                        arguments: JSON.stringify(call.input),
                      },
                    },
                  ]),
              {
                type: 'response.completed',
                response: { id: `response_${id}`, status: 'completed', usage: { input_tokens: 20, output_tokens: 5 } },
              },
            ];
        return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
          headers: { 'content-type': 'text/event-stream', 'request-id': `req_${id}` },
        });
      },
      { preconnect: () => {} },
    ) as typeof globalThis.fetch;
    const catalog = modelCatalog([subscriptionRegistration, openaiSubscriptionRegistration(RECORDED_PRODUCT)]);
    const models = lookupModels({
      ...modelRequester(catalog, credentials, yield* openModelClient(doorOf(fetch))),
      capacity: (provider: string, model: string | null | undefined) => catalog.textModelCapacity(provider, model),
      cacheLifetime: (provider: string, model: string | null | undefined) => catalog.resolveTextModel(provider, model).cacheLifetime,
    });
    const runner = yield* makeAgentRunner({ models, idleMs: AGENT_IDLE_MS() });
    const tools = {
      read: Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Read the shared decision.',
        parameters: Schema.Struct({}),
        exposure: 'deferred',
        execute: () =>
          Effect.sync(() => {
            executed += 1;
            return { decision: 'Preserve the shared decision.' };
          }),
      }),
    };
    const agent = new Agent({
      id: 'tagma',
      name: 'Transitions',
      description: 'Provider transition contract.',
      instructions: () => 'Continue the requested work.',
      tools: () => tools,
      stopWhen: [],
    });
    const worlds = new Map<
      string,
      {
        snapshot: WorldStateSnapshot;
        checkpoint: string | null;
      }
    >();
    const compaction = makeThreadCompaction({
      models,
      checkpoints: storage.compaction,
      policy: () => Effect.succeed(COMPACTION_POLICY(0.2)),
      strategy: makeThreadSummaryStrategy({ models, prompt: COMPACTION_PROMPT() }),
      recovery: makeThreadDigestStrategy(),
      text: COMPACTION_TEXT(),
      transcriptLocation: Effect.fnUntraced(function* (threadId: string) {
        const head = yield* storage.eventLog.headPosition(threadId);
        const rows = yield* storage.eventLog.recordsAsOf(threadId, { head, afterPosition: 0, limit: head });
        const path = join(root, `${threadId}.jsonl`);
        yield* files.writeFileString(path, rows.map((row) => JSON.stringify(row)).join('\n')).pipe(Effect.orDie);
        return path;
      }),
    });
    const agents = yield* registeredAgents(
      [
        threadAgent({
          agent,
          runner,
          runPolicy: { userStartable: true, backgroundStartable: false },
          context: () => Effect.succeed({}),
          turnContext: Effect.fnUntraced(function* (_context: unknown, input: ThreadToolContextInput) {
            const checkpoint = (yield* storage.compaction.latestCheckpoint(input.thread.id))?.id ?? null;
            const previous = worlds.get(input.thread.id);
            const world = yield* renderWorldState(
              [deferredToolsSection(tools)],
              previous?.checkpoint === checkpoint ? previous.snapshot : {},
            );
            if (world.kind === 'unchanged') return null;
            return {
              message: Message.user(world.content),
              entry: {
                type: 'context' as const,
                id: crypto.randomUUID(),
                runId: input.run.id,
                text: world.text,
                occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
              },
              commit: () =>
                Effect.sync(() => {
                  worlds.set(input.thread.id, { snapshot: world.snapshot, checkpoint });
                }),
            };
          }),
        }),
      ],
      'test',
    );
    const harness = yield* AgentHarness.make(
      Layer.mergeAll(
        approvalModesLayer,
        Layer.succeed(ThreadEntryKinds, storage.kinds),
        threadStorageLayer({
          storage: storage.aggregate,
          eventLog: storage.eventLog,
          transitions: storage.transitions,
          createRuns: (ownerId) => storage.runs({ ownerId, scope: 'scope-a' }),
          attachments: inertAttachments(),
          inbox: storage.inbox,
          toolOutputs: inertToolOutputs(),
          ownerSettings: storage.ownerSettings,
        }),
        threadCompactorLayer(compaction),
        threadHostLayer({
          rhythms: { lease: LEASE_RHYTHM(), reaper: REAPER_RHYTHM(), settlement: SETTLEMENT_RHYTHM(), streamFlushIntervalMs: 0 },
        }),
        threadAgentsLayer(agents),
      ),
      yield* makeThreadLiveFeed<ThreadState>(),
    );
    yield* Effect.addFinalizer(() => harness.dispose());
    return ProviderWorld.of({ storage, harness });
  }),
);
const opened = Effect.gen(function* () {
  const { storage, harness } = yield* ProviderWorld;
  answers.length = 0;
  const thread = yield* storage.createThread({ ownerId: 'test-owner', scope: 'scope-a' });
  const handle = harness.threads.handle(thread.id, thread.ownerId);
  yield* Effect.addFinalizer(() => handle.delete().pipe(Effect.orDie));
  yield* handle.setAuthorityMode('trust');
  const select = (provider: string, selected: string, account = 'a') =>
    handle.setModelSettings({ provider, model: selected, account, reasoning: 'high', switches: {} });
  const send = Effect.fnUntraced(function* (text: string, plan: Answer[]) {
    const changes = yield* Effect.acquireRelease(Queue.unbounded<void>(), Queue.shutdown);
    yield* Effect.acquireRelease(
      Effect.sync(() => harness.reads.subscribe(thread.id, () => Queue.offerUnsafe(changes, undefined))),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    answers.push(...plan);
    const started = yield* text === '/compact' ? handle.compact() : handle.send(text);
    for (;;) {
      const state = yield* harness.reads.snapshot(thread.id);
      if (state.activeRun === null && state.latestRun?.id === started.runId && state.latestRun.status !== 'running') {
        const failed =
          state.latestRun.status === 'completed'
            ? undefined
            : (yield* storage.aggregate.find(thread.id))?.history.slice(-6).map((message) => message.content);
        expect(state.latestRun.status, JSON.stringify({ text, reason: state.latestRun.failureReason, failed })).toBe('completed');
        break;
      }
      yield* Queue.take(changes);
    }
    expect(answers).toHaveLength(0);
  }, Effect.scoped);
  return { select, send };
});

const MODEL = 'claude-sonnet-5-5';
const SUMMARY =
  'Shared decision and GPT work retained. The user asked both providers to continue the same work. GPT discovered the read tool and retrieved the shared decision. Claude used that tool and preserved the decision in its summary. GPT then continued from that summary. The next action is to return to Claude, read the decision again, and preserve all completed work while changing accounts. The read tool stays deferred until a search names it, so the next turn searches for it before reading. Nothing is blocked; both providers, both accounts and the earlier summary carry the same decision forward unchanged.';

layer(fixture.pipe(Layer.provide(Memory.layer)))('provider transitions', (it) => {
  it.effect('a provider change keeps the dialogue and the tool the earlier provider discovered', () =>
    Effect.gen(function* () {
      const { select, send } = yield* opened;
      const before = executed;
      yield* select('openai-oauth', 'gpt-5.6-sol');
      yield* send('Find the decision tool.', [
        { call: { name: 'tool_search', input: { query: 'select:read', max_results: 1 } } },
        { text: 'GPT discovered the decision tool.' },
      ]);
      yield* select('subscription', MODEL);
      yield* send('Continue with the discovered tool.', [{ call: { name: 'read', input: {} } }, { text: 'Claude applied the decision.' }]);
      expect(sent.at(-1)?.model).toBe(MODEL);
      expect(JSON.stringify(sent.at(-1)?.body.messages)).toContain('GPT discovered the decision tool.');
      expect(executed - before).toBe(1);
    }),
  );

  for (const [from, to, model, messages] of [
    ['subscription', 'openai-oauth', 'gpt-5.6-sol', 'input'],
    ['openai-oauth', 'subscription', MODEL, 'messages'],
  ] as const)
    it.effect(`a summary from ${from} reaches ${to}`, () =>
      Effect.gen(function* () {
        const { select, send } = yield* opened;
        yield* select(from, from === 'subscription' ? MODEL : 'gpt-5.6-sol');
        yield* send('Lay out the decision.', [{ text: 'Shared decision remains authoritative.' }]);
        yield* send('/compact', [{ text: SUMMARY }]);
        yield* select(to, model);
        yield* send('Continue from the summary.', [{ text: 'Continued from the summary.' }]);
        expect(JSON.stringify(sent.at(-1)?.body[messages])).toContain('Shared decision and GPT work retained.');
      }),
    );

  it.effect('changing accounts and returning to the earlier account keeps the intervening contribution', () =>
    Effect.gen(function* () {
      const { select, send } = yield* opened;
      yield* select('subscription', MODEL, 'b');
      yield* send('Continue on account B.', [{ text: 'Account B contribution.' }]);
      yield* select('subscription', MODEL, 'a');
      yield* send('Return to account A.', [{ text: 'Completed on account A.' }]);
      expect(JSON.stringify(sent.at(-1)?.body.messages)).toContain('Account B contribution.');
    }),
  );
});
