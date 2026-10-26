import { lookupModels } from '@runlith/agent/thread/compaction/lookupModels';
import { expect } from 'bun:test';
import { it, layer } from '@runlith/effect-test';
import { approvalModesLayer } from '@runlith/agent/modes/ApprovalModes';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Clock, Context, Deferred, Effect, Fiber, Layer, Schema, Scope, Stream } from 'effect';
import { Agent } from '@runlith/agent/Agent';
import { makeAgentCalls } from '@runlith/agent/AgentCalls';
import { makeAgentRunner } from '@runlith/agent/AgentRunner';
import { Tool, ToolAnswer, ToolFailed, type Claim } from '@runlith/agent/tool';
import type { CallControl, CallControlResult, CallEvent, CallRecord } from '@runlith/agent/callProgress';
import type { ModelRequest, ModelRequester } from '@runlith/agent/modelPort';
import { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { threadAgentsLayer, threadCompactorLayer, threadStorageLayer } from '@runlith/agent/thread/kernelPorts';
import { threadHostLayer } from '@runlith/agent/thread/ThreadPorts';
import { makeThreadCompaction } from '@runlith/agent/thread/compaction/ThreadCompaction';
import { makeThreadDigestStrategy } from '@runlith/agent/thread/compaction/digestStrategy';
import { makeThreadLiveFeed } from '@runlith/agent/thread/run/ThreadLiveFeed';
import { makeThreadSummaryStrategy } from '@runlith/agent/thread/compaction/summaryStrategy';
import { threadAgent } from '@runlith/agent/thread/agents/ThreadAgent';
import { registeredAgents } from '@runlith/agent/thread/conformance/agents';
import type { ThreadState } from '@runlith/agent/thread/state';
import type { ThreadQuestionEntry } from '@runlith/agent/transcript/entries';
import { THREAD_TOOL_CANCEL_VALUE, THREAD_TOOL_CONFIRM_KIND, THREAD_TOOL_CONFIRM_VALUE } from '@runlith/agent/transcript/parts';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { randomUUID } from 'node:crypto';
import { LLMError, UnknownProviderReason } from '@runlith/llm/schema/errors';
import { Message } from '@runlith/llm/schema/messages';
import { ModelID, ProviderID, type FinishReason } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { subscriptionRegistration } from '@runlith/builtin-catalog/subscription/provider';
import { openaiSubscriptionRegistration } from '@runlith/adapter-openai/profiles/openai';
import { openThreadStore } from '../storageHarness.js';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import { asCommandSignalSend, callEndings, owedCallRows, threadAttachmentStore } from '../../../threads/testing/doubles.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { CallAddress } from '@runlith/agent/callProgress';
import { Queue } from 'effect';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import {
  threadToolOutputStore,
  callActivity,
  callDelivery,
  COMPACTION_POLICY,
  COMPACTION_PROMPT,
  COMPACTION_TEXT,
} from '../../../native-harness/testing/doubles.js';
import { asNativeThreadState } from '../../../threads/testing/doubles.js';
import { AGENT_IDLE_MS, LEASE_RHYTHM, REAPER_RHYTHM, SETTLEMENT_RHYTHM } from '../../../threads/testing/doubles.js';
import { RECORDED_PRODUCT } from '@runlith/llm/profiles/recordedProduct';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
const PROJECT = 1;
const OWNER = 'operator';
const SLOW = 'slow';
const LONG = 'long';
const SIBLING = 'sibling';
const SLOW_CALL = 'call-slow';
const SIBLING_CALL = 'call-sibling';
const WRITE = 'write';
const EDIT = 'edit';
const NOTES = { on: { kind: 'file', path: '/work/a.txt' }, access: 'write' } as const satisfies Claim;
const USAGE = new Usage({
  inputTokens: 100,
  nonCachedInputTokens: 100,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 10,
  reasoningTokens: 0,
  totalTokens: 110,
});
type ScriptedTurn = {
  readonly events: readonly LLMEvent[];
};
const finished = (reason: FinishReason): LLMEvent => ({ type: 'finish', reason, usage: USAGE });
const writesOwn = (key: string) => (): Effect.Effect<readonly Claim[]> => Effect.succeed([{ on: { kind: 'key', key }, access: 'write' }]);
const callsTurn = (
  calls: readonly {
    name: string;
    id: string;
    input?: Record<string, unknown>;
  }[],
): ScriptedTurn => ({
  events: [
    { type: 'step-start', index: 0 },
    ...calls.flatMap(({ name, id, input }) => [
      { type: 'tool-input-start' as const, id, name },
      { type: 'tool-call' as const, id, name, input: input ?? {} },
    ]),
    { type: 'step-finish', index: 0, reason: 'tool-calls' },
    finished('tool-calls'),
  ],
});
const textTurn = (text: string): ScriptedTurn => ({
  events: [
    { type: 'step-start', index: 0 },
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', text },
    { type: 'text-end', id: 'text-1' },
    { type: 'step-finish', index: 0, reason: 'stop' },
    finished('stop'),
  ],
});
const wire = (asked: Message[][], turns: ScriptedTurn[]): ModelRequester => ({
  request: (): ModelRequest => ({
    plannedOutputTokens: 32_000,
    origin: new ModelIdentity({ provider: ProviderID.make('openai-oauth'), model: ModelID.make('gpt-5.6-sol') }),
    text: () => {
      throw new Error('this harness opens no one-shot call');
    },
    object: () => {
      throw new Error('this harness opens no structured call');
    },
    stream: (input) =>
      Stream.suspend(() => {
        asked.push([...input.messages]);
        const turn = turns.shift();
        return turn === undefined
          ? Stream.fail(
              new LLMError({
                module: 'Provider',
                method: 'stream',
                reason: new UnknownProviderReason({ message: 'The scripted model has no turn left.', status: 500 }),
              }),
            )
          : Stream.fromIterable(turn.events);
      }),
  }),
});
const catalog = modelCatalog([subscriptionRegistration, openaiSubscriptionRegistration(RECORDED_PRODUCT)]);
const compactionModels = lookupModels({
  request: (input: Parameters<ModelRequester['request']>[0]) => wire([], []).request(input),
  capacity: (provider: string, model: string | null | undefined) => catalog.textModelCapacity(provider, model),
  cacheLifetime: (provider: string, model: string | null | undefined) => catalog.resolveTextModel(provider, model).cacheLifetime,
});
class CallStore extends Context.Service<CallStore, Effect.Success<ReturnType<typeof openThreadStore>>>()('test/CallStore') {}
const callStore = Layer.effect(CallStore, openThreadStore());
const openWorld = Effect.fnUntraced(function* (turns: ScriptedTurn[], mode: 'trust' | 'review' = 'trust', oweFails = false) {
  const root = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp('/tmp/tagma-call-lifecycle-')),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  );
  const store = yield* CallStore;
  yield* store.reset();
  const storage = store.storage;
  const asked: Message[][] = [];
  const entered = yield* Deferred.make<void>();
  const released = yield* Deferred.make<string>();
  const ran = { sibling: 0, cleaned: false, finished: undefined as string | undefined, order: [] as string[] };
  const touching = (name: string, approval: typeof ASKS_NEVER) =>
    Tool.make({
      display: () => ({ form: 'none' }),
      approval,
      description: `${name} the notes.`,
      mutates: true,
      claims: () => Effect.succeed([NOTES]),
      parameters: Schema.Struct({}),
      execute: () => Effect.sync(() => ran.order.push(name)).pipe(Effect.as({ [name]: 'done' })),
    });
  const entries = { count: 0 };
  const retained = { count: 0 };
  const delivered: string[] = [];
  const tools = {
    [WRITE]: touching(WRITE, ASKS_IN_REVIEW),
    [EDIT]: touching(EDIT, ASKS_NEVER),
    [LONG]: Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_IN_REVIEW,
      description: 'Long work that runs until it is released.',
      mutates: true,
      refusals: { 'not-ready': 'The work is not ready' },
      parameters: Schema.Struct({ refuse: Schema.optional(Schema.Boolean) }),
      execute: ({ refuse }) =>
        Effect.sync(() => {
          entries.count += 1;
        }).pipe(
          Effect.andThen(Deferred.await(released)),
          Effect.flatMap((value) =>
            refuse
              ? Effect.fail(new ToolFailed({ code: 'not-ready', reason: 'the work refused' }))
              : Effect.succeed(new ToolAnswer({ done: value }, undefined, { text: value })),
          ),
        ),
    }),
    [SLOW]: Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_IN_REVIEW,
      description: 'Work that runs until it is stopped or released.',
      mutates: true,
      claims: writesOwn(SLOW),
      parameters: Schema.Struct({}),
      execute: () =>
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(released)),
          Effect.tap((value) =>
            Effect.sync(() => {
              ran.finished = value;
            }),
          ),
          Effect.map((value) => ({ done: value })),
          Effect.ensuring(
            Effect.sync(() => {
              ran.cleaned = true;
            }),
          ),
        ),
    }),
    [SIBLING]: Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_IN_REVIEW,
      description: 'Work that finishes beside the slow call.',
      mutates: true,
      claims: writesOwn(SIBLING),
      parameters: Schema.Struct({}),
      execute: () =>
        Effect.sync(() => {
          ran.sibling += 1;
          return { sibling: 'answered' };
        }),
    }),
  };
  const agent = new Agent({
    id: 'tagma',
    name: 'CallLifecycle',
    description: 'The tool calls an operator may act on.',
    instructions: () => 'Run what you are asked to run.',
    tools: () => tools,
    stopWhen: [],
  });
  const runner = yield* makeAgentRunner({ models: wire(asked, turns), idleMs: AGENT_IDLE_MS() });
  const epoch = randomUUID();
  const owedRows = yield* owedCallRows().pipe(Effect.provide(store.context));
  let delivery: Effect.Success<ReturnType<typeof callDelivery>>;
  const compaction = makeThreadCompaction({
    models: compactionModels,
    checkpoints: storage.compaction,
    policy: () => Effect.succeed(COMPACTION_POLICY(0.2)),
    strategy: makeThreadSummaryStrategy({ models: compactionModels, prompt: COMPACTION_PROMPT() }),
    recovery: makeThreadDigestStrategy(),
    text: COMPACTION_TEXT(),
    transcriptLocation: () => Effect.succeed(join(root, 'transcript.jsonl')),
  });
  const agents = yield* registeredAgents(
    [
      threadAgent({
        agent,
        runner,
        runPolicy: { userStartable: true, backgroundStartable: false },
        context: () => Effect.succeed({}),
        callHooks: () => ({
          retain: () =>
            Effect.sync(() => {
              retained.count += 1;
              return {
                release: Effect.sync(() => {
                  retained.count -= 1;
                }),
              };
            }),
          detaching: (call) => delivery.detaching(call),
          began: (call) => delivery.began(call),
          completed: (call, exit) => delivery.completed(call, exit),
        }),
      }),
    ],
    'test',
  );
  const harness = yield* AgentHarness.make<ReturnType<typeof asNativeThreadState>, Unit<'machine'>, WriteUnit<'machine'>>(
    Layer.mergeAll(
      approvalModesLayer,
      Layer.succeed(ThreadEntryKinds, storage.kinds),
      threadStorageLayer<Unit<'machine'>, WriteUnit<'machine'>>({
        storage: storage.aggregate,
        eventLog: storage.eventLog,
        transitions: storage.transitions,
        createRuns: (ownerId) => storage.runs({ ownerId, scope: 'scope-a' }),
        attachments: yield* threadAttachmentStore(join(root, 'attachments')).pipe(Effect.provide(BunFileSystem.layer)),
        inbox: storage.inbox,
        toolOutputs: threadToolOutputStore(join(root, 'results')),
        ownerSettings: storage.ownerSettings,
      }),
      threadCompactorLayer(compaction),
      threadHostLayer<WriteUnit<'machine'>>({
        rhythms: { lease: LEASE_RHYTHM(), reaper: REAPER_RHYTHM(), settlement: SETTLEMENT_RHYTHM(), streamFlushIntervalMs: 0 },
        owedCalls: {
          owe: (call, tx) =>
            oweFails || call.threadId === null
              ? Effect.fail(new ThreadStorageFailed({ call: 'OwedCalls.owe', cause: new Error('the owed-call store is unreachable') }))
              : Effect.mapError(
                  owedRows.owe(tx, call, call.threadId, epoch),
                  (cause) => new ThreadStorageFailed({ call: 'OwedCalls.owe', cause }),
                ),
        },
      }),
      threadAgentsLayer(agents),
    ),
    yield* makeThreadLiveFeed<ReturnType<typeof asNativeThreadState>>(),
  );
  yield* Effect.addFinalizer(() => harness.dispose());
  const send = asCommandSignalSend(({ threadId, id, text, condition }) =>
    harness.threads
      .handle(threadId, OWNER)
      .sendSignal({ id, type: 'tool-result', addressee: 'transport', text }, { ifActive: 'deliver', ifIdle: 'persist', condition })
      .pipe(
        Effect.map((sent) => {
          if (sent.status === 'declined') return { _tag: 'Declined' } as const;
          delivered.push(id);
          return { _tag: 'Accepted' } as const;
        }),
        Effect.catch((failure) => Effect.succeed({ _tag: 'Unreachable', reason: failure.message } as const)),
      ),
  );
  const endings = yield* callEndings(store.units, send, yield* Queue.unbounded<CallAddress>(), runner.calls, undefined, epoch).pipe(
    Effect.provide(store.context),
  );
  yield* Effect.forkScoped(endings.attend());
  delivery = {
    detaching: (call) => Effect.flatMap(callDelivery(endings), (owed) => owed.detaching(call)),
    began: (call) => Effect.flatMap(callDelivery(endings), (owed) => owed.began(call)),
    completed: (call, exit) => Effect.flatMap(callDelivery(endings), (owed) => owed.completed(call, exit)),
  };
  const activity = callActivity({ calls: runner.calls, projectOf: () => Effect.succeed(PROJECT) });
  const scope = { projectId: PROJECT };
  const thread = yield* storage.createThread({ ownerId: OWNER, scope: 'scope-a' });
  const handle = harness.threads.handle(thread.id, thread.ownerId);
  yield* handle.setAuthorityMode(mode);
  yield* handle.setModelSettings({ provider: 'openai-oauth', model: 'gpt-5.6-sol', account: 'a', reasoning: 'high', switches: {} });
  const sent = yield* handle.send('Run the tools.');
  const settledRun = (runId: string) =>
    Effect.map(storage.runs({ ownerId: OWNER, scope: 'scope-a' }).runById(runId), (run) => run !== null && run.settledNotifiedAt !== null);
  return {
    threadId: thread.id,
    runId: sent.runId,
    asked,
    entered,
    entries,
    endings,
    store,
    delivered,
    send,
    inbox: (runId: string, toolCallId: string) => storage.inbox.receipt(`tool-result:${JSON.stringify([runId, toolCallId])}`),
    released,
    ran,
    retained,
    observe: Effect.fnUntraced(function* () {
      const frames: CallEvent[] = [];
      const opened = yield* Deferred.make<void>();
      const ending = yield* Deferred.make<void>();
      yield* Effect.forkScoped(
        Stream.runForEach(activity.feed(scope, 20), (frame) =>
          Effect.gen(function* () {
            frames.push(frame);
            if (frame.type === 'snapshot') yield* Deferred.succeed(opened, undefined);
            else if (frame.call.toolCallId === SLOW_CALL && frame.call.endedAt !== null) yield* Deferred.succeed(ending, undefined);
          }),
        ),
      );
      return { opened, ending, frames };
    }),
    snapshot: () => activity.snapshot(scope, 20),
    toolEntries: Effect.fnUntraced(function* () {
      const target = yield* harness.reads.pin(thread.id);
      return yield* harness.reads.query({
        targets: [target],
        query: { select: 'entries', where: [{ field: 'kind', op: 'eq', value: 'tool' }], fields: ['entry'], limit: 10 },
      });
    }),
    question: Effect.fnUntraced(function* () {
      const pending = (yield* storage.aggregate.find(thread.id))?.pendingInteraction;
      return pending?.type === 'question' ? (pending as ThreadQuestionEntry) : null;
    }),
    approve: (questionId: string, toolCallId: string) =>
      handle.answer({ questionId, answers: [{ questionId: toolCallId, values: ['confirm'] }] }),
    questions: () => harness.runs.questions(),
    settled: () => settledRun(sent.runId),
    settledRun,
    say: Effect.fnUntraced(function* (text: string, turn: ScriptedTurn) {
      turns.push(turn);
      return (yield* handle.send(text)).runId;
    }),
    control: (action: CallControl, toolCallId = SLOW_CALL) => activity.control(scope, { runId: sent.runId, toolCallId }, action),
    refuse: (questionId: string, toolCallId: string) =>
      handle.answer({ questionId, answers: [{ questionId: toolCallId, values: [THREAD_TOOL_CANCEL_VALUE] }] }),
    late: () => storage.inbox.receipt(`tool-result:${JSON.stringify([sent.runId, SLOW_CALL])}`),
  };
});
const until = Effect.fnUntraced(function* <E, R>(_label: string, check: () => Effect.Effect<boolean, E, R>) {
  while (!(yield* check())) yield* Effect.sleep('10 millis');
});
it.live('the owner’s feed carries every movement after the reading it opens on', () =>
  Effect.gen(function* () {
    const calls = yield* makeAgentCalls({ history: 200 });
    const address = (toolCallId: string) => ({ runId: 'run-1', threadId: 'probe-thread', toolCallId, name: 'probe', input: {} });
    const owner = callActivity({ calls, projectOf: (threadId) => Effect.succeed(threadId === 'probe-thread' ? PROJECT : -1) });
    const frames: CallEvent[] = [];
    const opened = yield* Deferred.make<void>();
    const movements = yield* Deferred.make<void>();
    const updates = () => frames.filter((frame) => frame.type === 'updated');
    yield* Effect.forkScoped(
      Stream.runForEach(owner.feed({ projectId: PROJECT }, 20), (frame) =>
        Effect.gen(function* () {
          frames.push(frame);
          if (frame.type === 'snapshot') yield* Deferred.succeed(opened, undefined);
          else if (updates().length === 3) yield* Deferred.succeed(movements, undefined);
        }),
      ),
    );
    yield* Deferred.await(opened);
    calls.open(address('from-test-runtime'));
    const other = yield* Scope.fork(yield* Effect.scope);
    const inOtherContext = yield* Effect.forkIn(
      Effect.sync(() => calls.open(address('from-harness-runtime'))),
      other,
    );
    yield* Fiber.join(inOtherContext);
    calls.open(address('from-plain-js'));
    yield* Deferred.await(movements);
    expect(frames[0]?.type).toBe('snapshot');
    expect(updates().map((frame) => frame.call.toolCallId)).toEqual(['from-test-runtime', 'from-harness-runtime', 'from-plain-js']);
  }),
);
layer(callStore, { excludeTestServices: true })('call lifecycle', (it) => {
  it.effect('stop settles a parked approval and resumes its original run without executing it', () =>
    Effect.gen(function* () {
      const world = yield* openWorld([callsTurn([{ name: SLOW, id: SLOW_CALL }]), textTurn('Continued after cancellation.')], 'review');
      yield* until('approval to park', () => Effect.map(world.question(), (question) => question?.status === 'open'));
      expect((yield* world.control({ action: 'stop' })).status).toBe('changed');
      yield* until('cancelled approval to resume and settle', () => world.settled());
      expect(yield* world.question()).toBeNull();
      expect(world.ran.cleaned).toBe(false);
      expect(world.asked.length).toBe(2);
      expect(JSON.stringify(world.asked[1])).toContain('cancelled');
      expect((yield* world.snapshot()).find((call) => call.toolCallId === SLOW_CALL)?.phase).toBe('stopped');
    }),
  );
  it.effect('cancelling one grouped approval leaves its sibling for the reader and carries both results forward', () =>
    Effect.gen(function* () {
      const world = yield* openWorld(
        [
          callsTurn([
            { name: SLOW, id: SLOW_CALL },
            { name: SIBLING, id: SIBLING_CALL },
          ]),
          textTurn('Continued with both outcomes.'),
        ],
        'review',
      );
      yield* until('grouped approval to park', () => Effect.map(world.question(), (question) => question?.status === 'open'));
      yield* world.control({ action: 'stop' });
      yield* until('only sibling approval to remain', () =>
        Effect.gen(function* () {
          const question = yield* world.question();
          return question?.type === 'question' && question.toolCalls.length === 1 && question.toolCalls[0]?.toolCallId === SIBLING_CALL;
        }),
      );
      expect(world.ran.sibling).toBe(0);
      expect(world.asked.length).toBe(1);
      const question = yield* world.question();
      if (question?.type !== 'question') return yield* Effect.die('The sibling approval is missing.');
      yield* world.approve(question.questionId, SIBLING_CALL);
      yield* until('grouped approval run to settle', () => world.settled());
      expect(world.ran.sibling).toBe(1);
      expect(world.ran.cleaned).toBe(false);
      expect(JSON.stringify(world.asked[1])).toContain('cancelled');
      expect(JSON.stringify(world.asked[1])).toContain('answered');
    }),
  );
  it.effect('stopping one live call answers its own step, leaves its sibling, and the run continues', () =>
    Effect.gen(function* () {
      const world = yield* openWorld([
        callsTurn([
          { name: SLOW, id: SLOW_CALL },
          { name: SIBLING, id: SIBLING_CALL },
        ]),
        textTurn('Carried on after the stop.'),
      ]);
      yield* until('the slow call to stand running', () =>
        Effect.map(world.snapshot(), (records) => records.some((record) => record.toolCallId === SLOW_CALL && record.phase === 'running')),
      );
      const standing = (yield* world.snapshot()).find((record) => record.toolCallId === SLOW_CALL)!;
      expect(standing.mode).toBe('foreground');
      expect(standing.endedAt).toBeNull();
      yield* Deferred.await(world.entered);
      const feed = yield* world.observe();
      yield* Deferred.await(feed.opened);
      const watching = feed.frames[0];
      expect(watching?.type).toBe('snapshot');
      if (watching?.type === 'snapshot') {
        expect(watching.calls.map((call) => call.toolCallId)).toContain(SLOW_CALL);
        expect(watching.calls.find((call) => call.toolCallId === SLOW_CALL)!.phase).toBe('running');
      }
      const answer = yield* world.control({ action: 'stop' });
      expect(answer.status).toBe('changed');
      yield* until('the run to settle', () => world.settled());
      const told = JSON.stringify(world.asked.at(-1));
      expect(told).toContain('Stopped by the operator.');
      expect(told).toContain('answered');
      expect(world.ran.cleaned).toBe(true);
      expect(world.ran.sibling).toBe(1);
      const after = yield* world.snapshot();
      const ended = after.find((record) => record.toolCallId === SLOW_CALL)!;
      expect(ended.phase).toBe('stopped');
      expect(ended.endedAt).not.toBeNull();
      expect(after.find((record) => record.toolCallId === SIBLING_CALL)!.phase).toBe('completed');
      yield* Deferred.await(feed.ending);
      const ending = feed.frames.at(-1);
      expect(ending?.type).toBe('updated');
      if (ending?.type === 'updated') {
        expect(ending.call.toolCallId).toBe(SLOW_CALL);
        expect(ending.call.endedAt).not.toBeNull();
      }
    }),
  );
  it.effect('a call handed to the background lets the run finish, keeps working, and lands in the thread afterwards', () =>
    Effect.gen(function* () {
      const world = yield* openWorld([callsTurn([{ name: SLOW, id: SLOW_CALL }]), textTurn('Moved on.')]);
      yield* until('the slow call to stand running', () =>
        Effect.map(world.snapshot(), (records) => records.some((record) => record.toolCallId === SLOW_CALL && record.phase === 'running')),
      );
      yield* Deferred.await(world.entered);
      const answer = yield* world.control({ action: 'background' });
      expect(answer.status).toBe('changed');
      yield* until('the run to settle while the work is still blocked', () => world.settled());
      expect(world.ran.finished).toBeUndefined();
      expect((yield* world.snapshot()).find((record) => record.toolCallId === SLOW_CALL)!.mode).toBe('background');
      expect(JSON.stringify(world.asked.at(-1))).toContain('running');
      yield* Deferred.succeed(world.released, 'the work finished');
      yield* until('the detached work to end', () =>
        Effect.map(world.snapshot(), (records) => records.find((record) => record.toolCallId === SLOW_CALL)!.endedAt !== null),
      );
      expect(world.ran.finished).toBe('the work finished');
      let carried = '';
      yield* until('the late result to reach the thread inbox', () =>
        Effect.gen(function* () {
          carried = JSON.stringify((yield* world.late()) ?? null);
          return carried.includes('finished in the background') && carried.includes('the work finished');
        }),
      );
      expect(carried).toContain('the work finished');
      expect(world.ran.cleaned).toBe(true);
      const next = yield* world.say('What became of the work you let go of?', textTurn('Noted.'));
      yield* until('the next run to settle', () => world.settledRun(next));
      const seen = JSON.stringify(world.asked.at(-1));
      expect(seen).toContain('the work finished');
    }),
  );
  it.effect(
    'a call asking for the background answers at once in review; its question waits in its thread after the run, and the word runs it',
    () =>
      Effect.gen(function* () {
        const asked = 'call-asked';
        const world = yield* openWorld(
          [callsTurn([{ name: LONG, id: asked, input: { background: true } }]), textTurn('Moved on.')],
          'review',
        );
        yield* until('the run to settle before anyone answered the call', () => world.settled());
        expect(JSON.stringify(world.asked.at(-1))).toContain('has not run yet');
        yield* until('the call to ask its thread', () => Effect.map(world.question(), (question) => question?.status === 'open'));
        const question = yield* world.question();
        if (question === null) return yield* Effect.die('The question of the background call is missing.');
        expect(question.runId).toBe(`approvals:${world.threadId}`);
        expect(world.entries.count).toBe(0);
        yield* world.approve(question.questionId, asked);
        yield* until('the approved body to start', () => Effect.sync(() => world.entries.count === 1));
        yield* Deferred.succeed(world.released, 'the asked work finished');
        const address = `tool-result:${JSON.stringify([world.runId, asked])}`;
        yield* until('the ending to reach the thread', () => Effect.sync(() => world.delivered.includes(address)));
        expect(JSON.stringify(yield* world.inbox(world.runId, asked))).toContain('the asked work finished');
        expect(world.delivered.filter((id) => id === address)).toHaveLength(1);
      }),
  );
  it.effect('background calls keep typed answers and refusals in the original entries for immediate and post-run completions', () =>
    Effect.gen(function* () {
      const ids = Array.from({ length: 2 }, (_, at) => `call-long-${at}`);
      const world = yield* openWorld([
        callsTurn([
          ...ids.map((id, index) => ({ name: LONG, id, input: { background: true, refuse: index === 1 } })),
          { name: SIBLING, id: SIBLING_CALL, input: { background: true } },
        ]),
        textTurn('Moved on.'),
        textTurn('Noted the immediate result.'),
      ]);
      yield* until('the run to settle while the long bodies still stand', () => world.settled());
      yield* until('the long bodies to start in the background', () => Effect.sync(() => world.entries.count === ids.length));
      yield* until('the immediate background ending to arrive', () => Effect.sync(() => world.delivered.length === 1));
      expect((yield* world.toolEntries()).rows.map((row) => row.entry)).toContainEqual(
        expect.objectContaining({
          id: `tool:${SIBLING_CALL}`,
          toolCallId: SIBLING_CALL,
          toolState: 'output-available',
          toolOutput: { sibling: 'answered' },
        }),
      );
      const receipts = JSON.stringify(world.asked.at(-1));
      for (const id of ids) expect(receipts).toContain(id);
      expect(
        (yield* world.snapshot()).filter((record) => ids.includes(record.toolCallId)).map((record) => [record.mode, record.endedAt]),
      ).toEqual(ids.map(() => ['background', null]));
      expect((yield* world.endings.owed({ threadId: world.threadId })).length).toBe(ids.length);
      yield* Deferred.succeed(world.released, 'the long work finished');
      yield* until('every ending to be delivered', () =>
        Effect.gen(function* () {
          const failed = (yield* world.snapshot()).find((call) => ids.includes(call.toolCallId) && call.phase === 'unavailable');
          if (failed !== undefined) return yield* Effect.die(failed.detail);
          return world.delivered.length === ids.length + 1;
        }),
      );
      expect(JSON.stringify(yield* world.inbox(world.runId, ids[0]!))).toContain('the long work finished');
      expect(JSON.stringify(yield* world.inbox(world.runId, ids[1]!))).toContain('the work refused');
      const entries = yield* world.toolEntries();
      expect(entries.rows).toHaveLength(ids.length + 1);
      expect(entries.rows.map((row) => row.entry)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `tool:${ids[0]}`,
            toolCallId: ids[0],
            toolState: 'output-available',
            toolOutput: { done: 'the long work finished' },
          }),
          expect.objectContaining({
            id: `tool:${ids[1]}`,
            toolCallId: ids[1],
            toolState: 'output-refused',
            toolRefusal: expect.objectContaining({ code: 'not-ready', reason: 'the work refused' }),
          }),
          expect.objectContaining({ toolCallId: SIBLING_CALL, toolOutput: { sibling: 'answered' } }),
        ]),
      );
      expect(yield* world.endings.owed({ threadId: world.threadId })).toEqual([]);
      expect([...new Set(world.delivered)].length).toBe(ids.length + 1);
    }),
  );
  it.effect('a background call whose command carried its ending still tells its thread when the call itself fails', () =>
    Effect.gen(function* () {
      const world = yield* openWorld([textTurn('Nothing to run.')]);
      yield* until('the run to settle', () => world.settled());
      const carried = {
        runId: 'run-carried',
        toolCallId: 'call-carried',
        threadId: world.threadId,
        name: LONG,
        input: {},
        phase: 'running' as const,
        mode: 'background' as const,
        detachable: false,
        startedAt: yield* Clock.currentTimeMillis,
        admittedAt: null,
        endedAt: null,
        expiresAt: null,
        expiresBy: null,
        limitCeilingMs: null,
        detail: null,
        executions: [],
      };
      const address = `tool-result:${JSON.stringify(['run-carried', 'call-carried'])}`;
      yield* world.endings.end(carried, { outcome: 'failed', result: 'the afterTool rule failed' });
      yield* until('the failure to be delivered', () => Effect.sync(() => world.delivered.includes(address)));
      expect(world.delivered.filter((id) => id === address)).toHaveLength(1);
      expect(JSON.stringify(yield* world.inbox('run-carried', 'call-carried'))).toContain('the afterTool rule failed');
    }),
  );
  it.effect.each([true, false])(
    'a parked approval moved to the background resumes its run with the receipt; a re-issued conflicting call queues behind it, and the word decides the order (allowed: %p)',
    (allowed) =>
      Effect.gen(function* () {
        const world = yield* openWorld(
          [callsTurn([{ name: WRITE, id: 'call-write' }]), callsTurn([{ name: EDIT, id: 'call-edit' }]), textTurn('Done.')],
          'review',
        );
        yield* until('the write to park on its approval', () =>
          Effect.map(world.question(), (question) => question?.status === 'open' && question.runId === world.runId),
        );
        expect(yield* world.control({ action: 'background' }, 'call-write')).toEqual({ status: 'changed', detail: null });
        yield* until('the re-issued edit to queue behind the write', () =>
          Effect.map(world.snapshot(), (records) =>
            records.some((record) => record.toolCallId === 'call-edit' && record.phase === 'waiting'),
          ),
        );
        expect(JSON.stringify(world.asked[1])).toContain('has not run yet');
        expect(world.ran.order).toEqual([]);
        yield* until('the write to ask its thread', () =>
          Effect.map(world.question(), (question) => question?.status === 'open' && question.runId === `approvals:${world.threadId}`),
        );
        const question = yield* world.question();
        if (question === null) return yield* Effect.die('The question of the moved write is missing.');
        yield* allowed ? world.approve(question.questionId, 'call-write') : world.refuse(question.questionId, 'call-write');
        yield* until('the run to settle', () => world.settled());
        expect(world.ran.order).toEqual(allowed ? [WRITE, EDIT] : [EDIT]);
        const address = `tool-result:${JSON.stringify([world.runId, 'call-write'])}`;
        yield* until("the write's ending to reach the thread", () => Effect.sync(() => world.delivered.includes(address)));
        expect(world.delivered.filter((id) => id === address)).toHaveLength(1);
        expect(yield* world.endings.owed({ threadId: world.threadId })).toEqual([]);
      }),
  );
  it.effect('moving a parked approval is one fact: when its owed ending cannot be written, the question still asks about the call', () =>
    Effect.gen(function* () {
      const world = yield* openWorld([callsTurn([{ name: WRITE, id: 'call-write' }]), textTurn('Stopped.')], 'review', true);
      yield* until('the write to park on its approval', () =>
        Effect.map(world.question(), (question) => question?.status === 'open' && question.runId === world.runId),
      );
      expect(yield* world.control({ action: 'background' }, 'call-write')).toEqual({
        status: 'unavailable',
        detail: expect.stringContaining('the owed-call store is unreachable'),
      });
      const question = yield* world.question();
      expect(question?.status).toBe('open');
      expect(question?.toolCalls.map((call) => call.toolCallId)).toEqual(['call-write']);
      expect(JSON.stringify((yield* world.toolEntries()).rows)).not.toContain('output-available');
      expect(yield* world.endings.owed({ threadId: world.threadId })).toEqual([]);
      expect(world.retained.count).toBe(0);
      expect((yield* world.snapshot()).find((record) => record.toolCallId === 'call-write')).toMatchObject({
        mode: 'foreground',
        detachable: true,
      });
      expect((yield* world.control({ action: 'stop' }, 'call-write')).status).toBe('changed');
      yield* until('the stopped approval to resume and settle', () => world.settled());
      expect(world.ran.order).toEqual([]);
    }),
  );
  it.effect(
    'calls a previous process left owed are settled at the next boot and delivered once: one that ran as unknown, one that never started as not run once a boot has withdrawn its question',
    () =>
      Effect.gen(function* () {
        const world = yield* openWorld([textTurn('Nothing to run.')]);
        yield* until('the run to settle', () => world.settled());
        const previous = world.endings;
        const at = yield* Clock.currentTimeMillis;
        const orphan = (toolCallId: string, admittedAt: number | null): CallRecord => ({
          runId: 'run-before',
          toolCallId,
          threadId: world.threadId,
          name: LONG,
          input: {},
          phase: 'running',
          mode: 'background',
          detachable: false,
          startedAt: at,
          admittedAt,
          endedAt: null,
          expiresAt: null,
          expiresBy: null,
          limitCeilingMs: null,
          detail: null,
          executions: [],
        });
        yield* previous.owe(orphan('call-ran', at));
        yield* previous.owe(orphan('call-unstarted', null));
        const questions = world.questions();
        const asking = (entry: ThreadQuestionEntry) =>
          entry.status === 'open' && entry.toolCalls.some((call) => call.toolCallId === 'call-unstarted');
        const scope = `approvals:${world.threadId}`;
        yield* Effect.forkScoped(
          questions.ask({
            threadId: world.threadId,
            runId: scope,
            toolCallId: 'call-unstarted',
            compose: () =>
              Effect.succeed({
                type: 'question',
                id: 'question:call-unstarted',
                runId: scope,
                questionId: 'call-unstarted',
                questions: [
                  {
                    id: 'call-unstarted',
                    toolCallId: 'call-unstarted',
                    kind: THREAD_TOOL_CONFIRM_KIND,
                    prompt: `Allow ${LONG}?`,
                    options: [{ value: THREAD_TOOL_CONFIRM_VALUE, label: 'Allow' }],
                  },
                ],
                toolCalls: [{ toolCallId: 'call-unstarted', toolName: LONG }],
                status: 'open',
              } satisfies ThreadQuestionEntry),
          }),
        );
        yield* until('the question of the unstarted call to stand', () =>
          Effect.map(questions.open(world.threadId), (open) => open.some(asking)),
        );
        const calls = yield* makeAgentCalls({ history: 8 });
        const boot = (withdraw: Parameters<typeof callEndings>[4]) =>
          Effect.flatMap(Queue.unbounded<CallAddress>(), (ended) =>
            callEndings(world.store.units, world.send, ended, calls, withdraw).pipe(Effect.provide(world.store.context)),
          );
        const unreachable = yield* boot(() => Effect.fail(new Error('the thread store is unreachable')));
        expect(yield* unreachable.resume()).toBe(1);
        expect(world.delivered).toEqual([`tool-result:${JSON.stringify(['run-before', 'call-ran'])}`]);
        expect((yield* questions.open(world.threadId)).some(asking)).toBe(true);
        const booted = yield* boot((threadId, toolCallId, reason) => questions.withdraw(threadId, toolCallId, reason));
        expect(yield* booted.resume()).toBe(1);
        expect(yield* booted.resume()).toBe(0);
        expect([...world.delivered].sort()).toEqual(
          ['call-ran', 'call-unstarted'].map((id) => `tool-result:${JSON.stringify(['run-before', id])}`),
        );
        expect(JSON.stringify(yield* world.inbox('run-before', 'call-ran'))).toContain('never recorded');
        expect(JSON.stringify(yield* world.inbox('run-before', 'call-unstarted'))).toContain('did not run');
        expect((yield* questions.open(world.threadId)).some(asking)).toBe(false);
        expect(yield* booted.owed({ threadId: world.threadId })).toEqual([]);
      }),
  );
});
