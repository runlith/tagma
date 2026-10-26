import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { approvalModesLayer } from '@runlith/agent/modes/ApprovalModes';
import { Agent } from '@runlith/agent/Agent';
import { agentOriginOf } from '@runlith/agent/AgentSignal';
import { makeAgentRunner } from '@runlith/agent/AgentRunner';
import { stepLimit } from '@runlith/agent/AgentStep';
import type { ModelRequest, ModelRequestInput } from '@runlith/agent/modelPort';
import { SUB_AGENT_DEPTH } from '@runlith/agent/collaboration/CollaborationConfig';
import { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { threadAgentsLayer, threadCompactorLayer, threadFeaturesLayer, threadStorageLayer } from '@runlith/agent/thread/kernelPorts';
import { threadHostLayer } from '@runlith/agent/thread/ThreadPorts';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { lookupModels } from '@runlith/agent/thread/compaction/lookupModels';
import { makeThreadCompaction } from '@runlith/agent/thread/compaction/ThreadCompaction';
import { makeThreadDigestStrategy } from '@runlith/agent/thread/compaction/digestStrategy';
import { makeThreadLiveFeed } from '@runlith/agent/thread/run/ThreadLiveFeed';
import { makeThreadSummaryStrategy } from '@runlith/agent/thread/compaction/summaryStrategy';
import { threadAgent } from '@runlith/agent/thread/agents/ThreadAgent';
import { registeredAgents } from '@runlith/agent/thread/conformance/agents';
import { openMemoryStorage } from '@runlith/agent/thread/conformance/memoryStorage';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import type { ThreadState } from '@runlith/agent/thread/state';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { openaiSubscriptionRegistration } from '@runlith/adapter-openai/profiles/openai';
import { RECORDED_PRODUCT } from '@runlith/llm/profiles/recordedProduct';
import { ModelID, ProviderID, type FinishReason } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import type { Message } from '@runlith/llm/schema/messages';
import * as MemoryFileSystem from '@runlith/testbed/memory';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Queue, Stream } from 'effect';
import { threadAttachmentStore } from '../../../threads/testing/doubles.js';
import { COMPACTION_POLICY, COMPACTION_PROMPT, COMPACTION_TEXT } from '../../../native-harness/testing/doubles.js';
import { AGENT_IDLE_MS, LEASE_RHYTHM, REAPER_RHYTHM, RECONCILE_INTERVAL_MS, SETTLEMENT_RHYTHM } from '../../../threads/testing/doubles.js';

const OWNER = 'test-owner';
const USAGE = new Usage({ inputTokens: 100, outputTokens: 10 });
const ORIGIN = new ModelIdentity({ provider: ProviderID.make('openai-oauth'), model: ModelID.make('gpt-5.6-sol') });
type Turn = { readonly text: string };
type FloorState = {
  readonly script: Map<string, Turn[]>;
  readonly heard: Map<string, (readonly Message[])[]>;
  serial: number;
  appendFailure: { readonly threadId: string; readonly failure: ThreadStorageFailed } | null;
};
class Floor extends Context.Service<
  Floor,
  {
    readonly storage: Effect.Success<ReturnType<typeof openMemoryStorage>>;
    readonly harness: AgentHarness;
    readonly state: FloorState;
    readonly calls: (threadId: string) => readonly (readonly Message[])[];
    readonly plan: (threadId: string, ...turns: Turn[]) => void;
  }
>()('test/requestObligation/Floor') {}

const finished = (reason: FinishReason): LLMEvent => ({ type: 'finish', reason, usage: USAGE });
function events(state: FloorState, turn: Turn): readonly LLMEvent[] {
  state.serial += 1;
  const id = `part-${state.serial}`;
  return [
    { type: 'step-start', index: 0 },
    { type: 'text-start', id },
    { type: 'text-delta', id, text: turn.text },
    { type: 'text-end', id },
    { type: 'step-finish', index: 0, reason: 'stop' },
    finished('stop'),
  ];
}
function request(state: FloorState, selection: ModelRequestInput): ModelRequest {
  const lane = selection.lane ?? 'no-lane';
  return {
    plannedOutputTokens: 32_000,
    origin: ORIGIN,
    text: () => Effect.die('The obligation floor streams only'),
    object: () => Effect.die('The obligation floor streams only'),
    stream: (input) =>
      Stream.suspend(() => {
        state.heard.set(lane, [...(state.heard.get(lane) ?? []), input.messages]);
        const turn = state.script.get(lane)?.shift();
        return turn === undefined ? Stream.die(`Thread ${lane} made an unplanned call`) : Stream.fromIterable(events(state, turn));
      }),
  };
}
const said = (messages: readonly Message[]) => JSON.stringify(messages);
const typed = (messages: readonly Message[]) =>
  messages
    .filter((message) => message.role === 'user' && agentOriginOf(message) === undefined)
    .map((message) => message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(''));
const settled = Effect.fnUntraced(function* (threadId: string, count: number) {
  const { harness, storage } = yield* Floor;
  const changes = yield* Effect.acquireRelease(Queue.sliding<void>(1), Queue.shutdown);
  yield* Effect.acquireRelease(
    Effect.sync(() => harness.reads.subscribe(threadId, () => Queue.offerUnsafe(changes, undefined))),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
  for (;;) {
    const read = yield* harness.reads.snapshot(threadId);
    if (read.latestRun?.settledNotifiedAt != null) {
      const runs = yield* storage.runs({ ownerId: OWNER, scope: 'scope-b' }).runsOf(threadId);
      if (runs.length === count) return;
    }
    yield* Queue.take(changes);
  }
}, Effect.scoped);
const floorLayer = Layer.effect(
  Floor,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'request-obligation-' });
    const storage = yield* openMemoryStorage();
    const state: FloorState = { script: new Map(), heard: new Map(), serial: 0, appendFailure: null };
    const calls = (threadId: string) => state.heard.get(threadId) ?? [];
    const plan = (threadId: string, ...turns: Turn[]) => state.script.set(threadId, [...(state.script.get(threadId) ?? []), ...turns]);
    const catalog = modelCatalog([openaiSubscriptionRegistration(RECORDED_PRODUCT)]);
    const models = lookupModels({
      request: (selection) => request(state, selection),
      capacity: (provider, model) => catalog.textModelCapacity(provider, model),
      cacheLifetime: (provider, model) => catalog.resolveTextModel(provider, model).cacheLifetime,
    });
    const runner = yield* makeAgentRunner({ models, idleMs: AGENT_IDLE_MS() });
    const agent = new Agent({
      id: 'tagma',
      name: 'Obligation floor',
      description: 'Runs tasks and reports their answers.',
      instructions: () => 'Do the work you are given.',
      stopWhen: [stepLimit(20)],
      tools: () => ({}),
    });
    const eventLog: typeof storage.eventLog = {
      ...storage.eventLog,
      append: (event, tx) => {
        if (state.appendFailure?.threadId === event.threadId) {
          const { failure } = state.appendFailure;
          state.appendFailure = null;
          return Effect.fail(failure);
        }
        return storage.eventLog.append(event, tx);
      },
    };
    const agents = yield* registeredAgents(
      [threadAgent({ agent, runner, runPolicy: { userStartable: true, backgroundStartable: true }, context: () => Effect.succeed({}) })],
      'test',
    );
    const attachments = yield* threadAttachmentStore(join(root, 'attachments')).pipe(Effect.provideService(FileSystem.FileSystem, files));
    const harness = yield* Effect.acquireRelease(
      AgentHarness.make(
        Layer.mergeAll(
          approvalModesLayer,
          Layer.succeed(ThreadEntryKinds, storage.kinds),
          threadStorageLayer({
            storage: storage.aggregate,
            eventLog,
            transitions: storage.transitions,
            createRuns: (ownerId) => storage.runs({ ownerId, scope: 'scope-b' }),
            attachments,
            inbox: storage.inbox,
            toolOutputs: {
              scope: () => ({
                tools: {},
                project: ({ output, modelOutput }) => Effect.succeed({ output, modelOutput }),
                projectMessages: (messages) => Effect.succeed(messages),
                retainInterrupted: ({ text, complete }) => Effect.succeed({ kind: 'text', text, complete }),
                retainOpen: ({ text }) => Effect.succeed({ input: { kind: 'text', text, complete: false }, chars: text.length }),
                commitReferenced: () => Effect.void,
                dispose: () => Effect.void,
              }),
              settleOpen: () => Effect.void,
            },
            ownerSettings: storage.ownerSettings,
          }),
          threadFeaturesLayer({
            collaboration: {
              models: () => catalog,
              subAgentDepth: () => Effect.succeed(SUB_AGENT_DEPTH.default),
              delegation: () => Effect.succeed({ allowed: true, setAt: null }),
              reconcileIntervalMs: RECONCILE_INTERVAL_MS(),
            },
          }),
          threadCompactorLayer(
            makeThreadCompaction({
              models,
              checkpoints: storage.compaction,
              policy: () => Effect.succeed(COMPACTION_POLICY(0.9)),
              strategy: makeThreadSummaryStrategy({ models, prompt: COMPACTION_PROMPT() }),
              recovery: makeThreadDigestStrategy(),
              text: COMPACTION_TEXT(),
            }),
          ),
          threadHostLayer({
            rhythms: { lease: LEASE_RHYTHM(), reaper: REAPER_RHYTHM(), settlement: SETTLEMENT_RHYTHM(), streamFlushIntervalMs: 0 },
            ownerId: OWNER,
          }),
          threadAgentsLayer(agents),
        ),
        yield* makeThreadLiveFeed<ThreadState>(),
      ),
      (made) => made.dispose(),
    );
    return Floor.of({ storage, harness, state, calls, plan });
  }),
);
const thread = Effect.fnUntraced(function* (name: string) {
  const { storage, harness } = yield* Floor;
  const row = yield* storage.createThread({ ownerId: OWNER, scope: 'scope-b' });
  const handle = harness.threads.handle(row.id, OWNER);
  yield* handle.setAuthorityMode('trust');
  yield* handle.setModelSettings({ provider: 'openai-oauth', model: 'gpt-5.6-sol', reasoning: 'high', switches: {} });
  const named: ThreadRow = { ...row, name };
  return named;
});

layer(floorLayer.pipe(Layer.provide(MemoryFileSystem.layer)))('request obligations', (it) => {
  it.effect('an accepted inbox item preserves a failed wake and retry reads it once', () =>
    Effect.gen(function* () {
      const { storage, harness, state, plan } = yield* Floor;
      const recipient = yield* thread('failed-wake');
      const sender = yield* thread('sender');
      state.appendFailure = {
        threadId: recipient.id,
        failure: new ThreadStorageFailed({ call: 'append', cause: new Error('Journal unavailable') }),
      };
      plan(recipient.id, { text: 'Read after storage recovered.' });
      const envelope = { id: 'envelope:failed-wake', senderThreadId: sender.id, intent: 'message', text: 'Read this.' } as const;
      const runsOf = storage.runs({ ownerId: OWNER, scope: 'scope-b' }).runsOf(recipient.id);
      yield* Effect.gen(function* () {
        const answer = yield* Effect.result(harness.inputs.deliver(recipient.id, OWNER, envelope));
        expect(answer._tag).toBe('Failure');
        expect(yield* runsOf).toEqual([]);
        expect(yield* storage.inbox.receipt(envelope.id)).toMatchObject({ threadId: recipient.id, state: 'queued' });
        expect((yield* harness.inputs.deliver(recipient.id, OWNER, envelope)).status).toBe('woken');
        yield* settled(recipient.id, 1);
        expect(yield* runsOf).toHaveLength(1);
        expect(yield* storage.inbox.receipt(envelope.id)).toMatchObject({ threadId: recipient.id, state: 'acknowledged' });
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            state.appendFailure = null;
          }),
        ),
      );
    }),
  );
  it.effect('a plain child receives raw operator words, reports tasks and leaves ordinary messages unreported', () =>
    Effect.gen(function* () {
      const { storage, harness, calls, plan } = yield* Floor;
      const parent = yield* thread('lead');
      plan(parent.id, { text: 'Noted the gate.' });
      const child = yield* harness.collaboration.spawn({
        parentThreadId: parent.id,
        ownerId: OWNER,
        requestId: 'plain-spawn',
        agentId: 'tagma',
        task: 'Patch the gate.',
        name: 'patcher',
        plain: true,
      });
      plan(child.threadId, { text: 'The gate is patched.' });
      yield* Effect.all([settled(child.threadId, 1), settled(parent.id, 1)], { concurrency: 'unbounded' });
      expect(typed(calls(child.threadId)[0]!)).toEqual(['Patch the gate.']);
      expect(said(calls(parent.id)[0]!)).toContain('The gate is patched.');
      plan(child.threadId, { text: 'The latch is checked.' });
      yield* harness.collaboration.collaborate(parent.id, OWNER, (verbs) =>
        verbs.messaging.send({ to: [child.threadId], intent: 'message', text: 'Also check the latch.', key: 'plain-latch' }),
      );
      yield* settled(child.threadId, 2);
      expect(typed(calls(child.threadId).at(-1)!)).toEqual(['Patch the gate.', 'Also check the latch.']);
      expect(yield* storage.inbox.pending(parent.id)).toEqual([]);
      expect(yield* storage.runs({ ownerId: OWNER, scope: 'scope-b' }).runsOf(parent.id)).toHaveLength(1);
    }),
  );
});
