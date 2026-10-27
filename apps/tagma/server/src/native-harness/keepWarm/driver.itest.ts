import { lookupModels } from '@runlith/agent/thread/compaction/lookupModels';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { approvalModesLayer } from '@runlith/agent/modes/ApprovalModes';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Clock, Context, Effect, Fiber, Layer, Queue, Schema, Stream } from 'effect';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { Agent } from '@runlith/agent/Agent';
import { makeAgentRunner } from '@runlith/agent/AgentRunner';
import { Tool } from '@runlith/agent/tool';
import { stepLimit } from '@runlith/agent/AgentStep';
import type { ModelRequest, ModelRequestInput } from '@runlith/agent/modelPort';
import { COLLABORATION_SOURCE, SUB_AGENT_DEPTH } from '@runlith/agent/collaboration/CollaborationConfig';
import { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { threadAgentsLayer, threadCompactorLayer, threadFeaturesLayer, threadStorageLayer } from '@runlith/agent/thread/kernelPorts';
import { threadHostLayer } from '@runlith/agent/thread/ThreadPorts';
import { KEEP_WARM_REFUSAL } from '@runlith/agent/thread/run/keepWarmRun';
import { makeThreadCompaction } from '@runlith/agent/thread/compaction/ThreadCompaction';
import { makeThreadDigestStrategy } from '@runlith/agent/thread/compaction/digestStrategy';
import { makeThreadLiveFeed } from '@runlith/agent/thread/run/ThreadLiveFeed';
import { makeThreadSummaryStrategy } from '@runlith/agent/thread/compaction/summaryStrategy';
import { threadAgent } from '@runlith/agent/thread/agents/ThreadAgent';
import { registeredAgents } from '@runlith/agent/thread/conformance/agents';
import type { ThreadState } from '@runlith/agent/thread/state';
import { KEEP_WARM_SIGNAL_TYPE, keepWarmSignalId } from '@runlith/agent/transcript/keepWarm';
import { subscriptionRegistration } from '@runlith/builtin-catalog/subscription/provider';
import { ModelID, ProviderID, type FinishReason } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import type { Message } from '@runlith/llm/schema/messages';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { type Unit, MachineUnits, type WriteUnit } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { project } from '../../projects/store/table.js';
import { scopeRecord } from '../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../thread-record/layer.js';
import { makeThreadAttachments } from '../../threads/resources/attachments.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { makeThreadInbox } from '../../threads/store/inbox.js';
import { makeSqliteThreadJournal } from '../../threads/journal/log.js';
import { makeApprovalPreferences } from '../../threads/store/approvals.js';
import { ThreadHarness, ThreadLive } from '../../threads/contract/service/engine.js';
import { ThreadLookup } from '../../threads/contract/service/reads.js';
import { OwnWork } from '../../threads/contract/service/ownWork.js';
import { ownWork } from '../../threads/testing/doubles.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { commandSignalId } from '../../executions/contract/wire/commands.js';
import { CommandWaiters } from '../../executions/contract/service/commands.js';
import { commandNoticeQueue } from '../../executions/testing/doubles.js';
import { storesOver } from '../../executions/testing/stores.js';
import { makeCompactionStore } from '../compaction/store.js';
import { toolOutputStore } from '../tools/outputStore.js';
import { makeTransitions } from '../runs/transitionStore.js';
import { COMPACTION_POLICY, COMPACTION_PROMPT, COMPACTION_TEXT } from '../compaction/policy.js';
import { makeKeepWarm } from './driver.js';
import { makeKeepWarmReads } from './reads.js';
import { threadStack } from '../../composition/testing/threadParts.js';
import { AGENT_IDLE_MS } from '@runlith/agent/callProgress';
import { LEASE_RHYTHM, REAPER_RHYTHM, RECONCILE_INTERVAL_MS, SETTLEMENT_RHYTHM } from '../../threads/contract/wire/rhythm.js';
import { cacheWarmthOf } from '../../threads/list/wire.js';
import { CORE_KINDS, threadRunStores } from '../testing/doubles.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { ASKS_IN_REVIEW } from '../../platform/contract/wire/conditions.js';
const MODELS = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);
const OWNER = OPERATOR_PRINCIPAL;
const PROVIDER = 'subscription';
const MODEL = 'claude-opus-5-5';
const TTL_MS = 3_600_000;
const INSTALLATION = InstallationId.make('keep-warm');
const USAGE = new Usage({
  inputTokens: 100_000,
  nonCachedInputTokens: 50,
  cacheReadInputTokens: 99_000,
  cacheWriteInputTokens: 950,
  outputTokens: 2,
  reasoningTokens: 0,
  totalTokens: 100_002,
});
const ORIGIN = new ModelIdentity({ provider: ProviderID.make(PROVIDER), model: ModelID.make(MODEL) });
type Turn =
  | {
      readonly text: string;
      readonly held?: Promise<void>;
    }
  | {
      readonly call: {
        readonly name: string;
        readonly input: unknown;
      };
    };
const script = new Map<string, Turn[]>();
const heard = new Map<string, (readonly Message[])[]>();
let serial = 0;
let changed = 0;
const finished = (reason: FinishReason): LLMEvent => ({ type: 'finish', reason, usage: USAGE });
function events(turn: Turn): readonly LLMEvent[] {
  serial += 1;
  if ('text' in turn) {
    const id = `text-${serial}`;
    return [
      { type: 'step-start', index: 0 },
      { type: 'text-start', id },
      { type: 'text-delta', id, text: turn.text },
      { type: 'text-end', id },
      { type: 'step-finish', index: 0, reason: 'stop', usage: USAGE },
      finished('stop'),
    ];
  }
  const id = `call-${serial}`;
  return [
    { type: 'step-start', index: 0 },
    { type: 'tool-input-start', id, name: turn.call.name },
    { type: 'tool-call', id, name: turn.call.name, input: turn.call.input },
    { type: 'step-finish', index: 0, reason: 'tool-calls', usage: USAGE },
    finished('tool-calls'),
  ];
}
function request(selection: ModelRequestInput): ModelRequest {
  const lane = selection.lane ?? 'no-lane';
  return {
    plannedOutputTokens: 32_000,
    origin: ORIGIN,
    text: () => {
      throw new Error('keep-warm opens no one-shot call');
    },
    object: () => {
      throw new Error('keep-warm opens no one-shot call');
    },
    stream: (input) =>
      Stream.suspend(() => {
        heard.set(lane, [...(heard.get(lane) ?? []), input.messages]);
        const turn = script.get(lane)?.shift();
        if (turn === undefined) return Stream.die(new Error(`Thread ${lane} made a call its script did not plan.`));
        const played = Stream.fromIterable(events(turn));
        return 'held' in turn && turn.held !== undefined
          ? Stream.fromEffect(Effect.promise(() => turn.held!)).pipe(Stream.flatMap(() => played))
          : played;
      }),
  };
}
const calls = (threadId: string) => heard.get(threadId) ?? [];
const said = (messages: readonly Message[]) => JSON.stringify(messages);
const plan = (threadId: string, ...turns: Turn[]) => void script.set(threadId, [...(script.get(threadId) ?? []), ...turns]);
const machine = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, { readers: 1 }))),
);
const opened = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const root = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp('/tmp/tagma-keep-warm-')),
    (made) => Effect.promise(() => rm(made, { recursive: true, force: true })),
  );
  const created = yield* db
    .insert(project)
    .values({ name: 'keep-warm', repoKey: '/keep-warm', rootPath: '/keep-warm', createdAt: new Date(yield* Clock.currentTimeMillis) })
    .returning({ id: project.id })
    .get();
  if (!created) return yield* Effect.die(new Error('The project could not be created.'));
  const records = yield* makeThreadRecords;
  const { store: threads, threads: parts } = yield* threadStack({ db, units, records, kinds: CORE_KINDS });
  const runsOf = yield* threadRunStores(records, CORE_KINDS);
  const inbox = yield* Effect.provideService(makeThreadInbox, ThreadEntryKinds, CORE_KINDS);
  const catalog = modelCatalog([subscriptionRegistration]);
  const models = lookupModels({
    request,
    capacity: (provider: string, model: string | null | undefined) => catalog.textModelCapacity(provider, model),
    cacheLifetime: (provider: string, model: string | null | undefined) => catalog.resolveTextModel(provider, model).cacheLifetime,
  });
  const runner = yield* makeAgentRunner({ models, idleMs: AGENT_IDLE_MS });
  const agent = new Agent({
    id: 'tagma',
    name: 'Keep-warm floor',
    description: 'Delegates, waits and is kept warm.',
    grant: { sources: [{ source: 'tagma' }, { source: COLLABORATION_SOURCE }] },
    instructions: () => 'Do the work you are given.',
    stopWhen: [stepLimit(20)],
    tools: () => ({
      write: Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_IN_REVIEW,
        description: 'Change a file.',
        parameters: Schema.Struct({}),
        execute: () =>
          Effect.sync(() => {
            changed += 1;
            return { written: true };
          }),
        mutates: true,
      }),
    }),
  });
  const registered = yield* registeredAgents(
    [threadAgent({ agent, runner, runPolicy: { userStartable: true, backgroundStartable: true }, context: () => Effect.succeed({}) })],
    'test',
  );
  const live = yield* makeThreadLiveFeed<ThreadState>();
  const harness = yield* Effect.acquireRelease(
    AgentHarness.make<ThreadState, Unit<'machine'>, WriteUnit<'machine'>>(
      Layer.mergeAll(
        approvalModesLayer,
        Layer.succeed(ThreadEntryKinds, CORE_KINDS),
        threadStorageLayer<Unit<'machine'>, WriteUnit<'machine'>>({
          storage: threads,
          eventLog: yield* makeSqliteThreadJournal,
          transitions: yield* makeTransitions({ threads }),
          createRuns: (ownerId) => runsOf({ ownerId, scope: sql`1 = 1` }),
          attachments: yield* makeThreadAttachments({ root: join(root, 'attachments') }).pipe(Effect.provide(BunFileSystem.layer)),
          inbox,
          toolOutputs: toolOutputStore(join(root, 'results')),
          ownerSettings: yield* makeApprovalPreferences,
        }),
        threadFeaturesLayer({
          collaboration: {
            models: () => catalog,
            subAgentDepth: () => Effect.succeed(SUB_AGENT_DEPTH.default),
            delegation: () => Effect.succeed({ allowed: true, setAt: null }),
            reconcileIntervalMs: RECONCILE_INTERVAL_MS,
          },
        }),
        threadCompactorLayer(
          makeThreadCompaction({
            models,
            checkpoints: yield* makeCompactionStore({}),
            policy: () => Effect.succeed(COMPACTION_POLICY(0.9)),
            strategy: makeThreadSummaryStrategy({ models, prompt: COMPACTION_PROMPT }),
            recovery: makeThreadDigestStrategy(),
            text: COMPACTION_TEXT,
          }),
        ),
        threadHostLayer({
          rhythms: { lease: LEASE_RHYTHM, reaper: REAPER_RHYTHM, settlement: SETTLEMENT_RHYTHM, streamFlushIntervalMs: 0 },
          ownerId: OWNER,
        }),
        threadAgentsLayer(registered),
      ),
      live,
    ),
    (made) => made.dispose(),
  );
  const deliveries = storesOver(db, INSTALLATION).deliveries;
  const waiters = yield* commandNoticeQueue({
    deliveries,
    ended: yield* Queue.unbounded<ExecutionRef>(),
    takeBack: Effect.die(new Error('keep-warm takes back no notice')),
  });
  const own = yield* ownWork().pipe(Effect.provideService(CommandWaiters, waiters));
  return { db, units, projectId: created.id, inbox, threads, parts, reads: yield* makeKeepWarmReads, harness, live, deliveries, own };
});
class Floor extends Context.Service<Floor, Effect.Success<typeof opened>>()('test/native-harness/KeepWarmFloor') {}
const floor = Layer.effect(Floor, opened).pipe(Layer.provideMerge(machine));
const until = Effect.fnUntraced(function* <R>(_what: string, holds: () => Effect.Effect<boolean, unknown, R>) {
  while (!(yield* holds())) yield* Effect.sleep(20);
});
const settle = Effect.sleep(100);
const resting = Effect.fnUntraced(function* (threadId: string) {
  const { harness } = yield* Floor;
  const state = yield* harness.reads.snapshot(threadId);
  return state.activeRun === null && state.latestRun?.settledNotifiedAt != null;
});
const lead = Effect.gen(function* () {
  const { db, projectId, threads, harness } = yield* Floor;
  const row = yield* threads.insert({ ownerId: OWNER, agentId: 'tagma' });
  yield* scopeRecord(db, row.id, { projectId });
  const handle = harness.threads.handle(row.id, OWNER);
  yield* handle.setAuthorityMode('trust');
  yield* handle.setModelSettings({ provider: PROVIDER, model: MODEL, reasoning: 'high', switches: {} });
  return row.id;
});
const turn = Effect.fnUntraced(function* (threadId: string, text: string, answer: string) {
  const { harness } = yield* Floor;
  plan(threadId, { text: answer });
  const sent = yield* harness.threads.handle(threadId, OWNER).send(text);
  yield* until(`${threadId} answered ${text}`, () => resting(threadId));
  if (sent.status !== 'started') return yield* Effect.die(new Error(`The turn did not start: ${sent.status}.`));
  return sent.runId;
});
layer(floor, { excludeTestServices: true })('keep-warm', (it) => {
  it.effect('a keep-warm turn takes one step, answers into history, and closes a tool call without running it', () =>
    Effect.gen(function* () {
      const { harness, threads } = yield* Floor;
      const thread = yield* lead;
      const anchor = yield* turn(thread, 'Plan the floor.', 'Planned.');
      const handle = harness.threads.handle(thread, OWNER);
      plan(thread, { call: { name: 'write', input: {} } });
      const first = keepWarmSignalId({ anchor, ping: 1 });
      expect(yield* handle.keepWarm(first)).toMatchObject({ status: 'woken' });
      yield* until('the first ping settled', () => resting(thread));
      expect(calls(thread)).toHaveLength(2);
      expect(said(calls(thread)[1]!.slice(-1))).toContain(`<${KEEP_WARM_SIGNAL_TYPE}>`);
      expect(changed).toBe(0);
      const closed = (yield* threads.historyOf(thread)) ?? [];
      expect(said(closed.slice(-3))).toContain(KEEP_WARM_REFUSAL);
      expect(yield* handle.keepWarm(first)).toEqual({ status: 'sent' });
      plan(thread, { text: 'ok' });
      expect(yield* handle.keepWarm(keepWarmSignalId({ anchor, ping: 2 }))).toMatchObject({ status: 'woken' });
      yield* until('the second ping settled', () => resting(thread));
      const history = (yield* threads.historyOf(thread)) ?? [];
      expect(history.at(-1)).toMatchObject({ role: 'assistant' });
      expect(said(history.slice(-2))).toContain(`<${KEEP_WARM_SIGNAL_TYPE}>`);
      expect(said(history.slice(-1))).toContain('ok');
      expect(calls(thread)).toHaveLength(3);
    }),
  );
  it.effect('words and envelopes that arrive during a keep-warm turn are queued behind it and open their own run', () =>
    Effect.gen(function* () {
      const { harness } = yield* Floor;
      const thread = yield* lead;
      const peer = yield* lead;
      const anchor = yield* turn(thread, 'Plan the wall.', 'Planned.');
      const handle = harness.threads.handle(thread, OWNER);
      const gate = Promise.withResolvers<void>();
      plan(thread, { text: 'ok', held: gate.promise });
      expect(yield* handle.keepWarm(keepWarmSignalId({ anchor, ping: 1 }))).toMatchObject({ status: 'woken' });
      yield* until('the ping called its model', () => Effect.succeed(calls(thread).length === 2));
      plan(thread, { text: 'Read the news.' });
      expect(yield* handle.send('The review is in.')).toMatchObject({ status: 'queued' });
      expect(
        yield* harness.inputs.deliver(thread, OWNER, {
          id: 'envelope:wall-news',
          senderThreadId: peer,
          intent: 'message',
          text: 'The mortar is dry.',
        }),
      ).toMatchObject({ status: 'queued' });
      gate.resolve();
      yield* until('the words ran after the ping', () => Effect.map(resting(thread), (rest) => calls(thread).length === 3 && rest));
      expect(said(calls(thread)[1]!)).not.toContain('The review is in.');
      expect(said(calls(thread)[1]!)).not.toContain('The mortar is dry.');
      expect(said(calls(thread)[2]!)).toContain('The review is in.');
      expect(said(calls(thread)[2]!)).toContain('The mortar is dry.');
    }),
  );
  it.effect('a keep-warm turn, answered or failed, reports nothing to whoever gave its thread work, and a failed one stops the pings', () =>
    Effect.gen(function* () {
      const { harness, inbox } = yield* Floor;
      const parent = yield* lead;
      yield* turn(parent, 'Start the tower.', 'Started.');
      plan(parent, { text: 'Noted.' });
      const child = yield* harness.collaboration.spawn({
        parentThreadId: parent,
        ownerId: OWNER,
        requestId: 'tower',
        agentId: 'tagma',
        task: 'Build the tower.',
        name: 'mason',
      });
      plan(child.threadId, { text: 'The first floor stands.' });
      yield* until('the child reported and the parent read it', () =>
        Effect.map(
          Effect.all([resting(parent), resting(child.threadId)]),
          ([parentRests, childRests]) => calls(parent).length === 2 && parentRests && childRests,
        ),
      );
      const childRuns = calls(child.threadId).length;
      const handle = harness.threads.handle(child.threadId, OWNER);
      plan(child.threadId, { text: 'ok' });
      expect(yield* handle.keepWarm(keepWarmSignalId({ anchor: 'tower-run', ping: 1 }))).toMatchObject({ status: 'woken' });
      yield* until('the answered ping settled', () => resting(child.threadId));
      expect(yield* handle.keepWarm(keepWarmSignalId({ anchor: 'tower-run', ping: 2 }))).toMatchObject({ status: 'woken' });
      yield* until('the unplanned ping failed', () =>
        Effect.map(harness.reads.snapshot(child.threadId), (state) => state.latestRun?.status === 'failed'),
      );
      yield* settle;
      expect(calls(child.threadId)).toHaveLength(childRuns + 2);
      expect(calls(parent)).toHaveLength(2);
      expect(yield* inbox.pending(parent)).toEqual([]);
      expect(yield* handle.keepWarm(keepWarmSignalId({ anchor: 'tower-run', ping: 3 }))).toEqual({ status: 'interrupted' });
    }),
  );
  it.effect(
    'the driver pings a lead whose child runs up to the count per wait, keeps the count across a restart, and stops when the child reports',
    () =>
      Effect.gen(function* () {
        const { harness, live, parts, reads, own } = yield* Floor;
        const thread = yield* lead;
        const anchor = yield* turn(thread, 'Delegate the bridge.', 'Delegated.');
        const gate = Promise.withResolvers<void>();
        const child = yield* harness.collaboration.spawn({
          parentThreadId: thread,
          ownerId: OWNER,
          requestId: 'bridge',
          agentId: 'tagma',
          task: 'Build the bridge.',
          name: 'builder',
        });
        plan(child.threadId, { text: 'The bridge is built.', held: gate.promise });
        yield* until('the child is working', () => Effect.succeed(calls(child.threadId).length === 1));
        const knobs = { on: true, pings: 2, spendable: true };
        const driver = makeKeepWarm({
          settings: () => Effect.succeed({ on: knobs.on, pings: knobs.pings }),
          warmth: (summary) => Effect.succeed(cacheWarmthOf(summary, false, { curves: new Map(), accounts: new Map(), models: MODELS })),
          spending: (_summary, now) => Effect.succeed(knobs.spendable ? now : null),
          marginMs: TTL_MS,
        }).pipe(
          Effect.provideService(ThreadLookup, parts.list as unknown as ThreadLookup['Service']),
          Effect.provideService(ThreadHarness, harness as unknown as ThreadHarness['Service']),
          Effect.provideService(ThreadLive, live as unknown as ThreadLive['Service']),
          Effect.provideService(OwnWork, own),
          Effect.flatMap((made) => Effect.scoped(made.drive())),
        );
        plan(thread, { text: 'ok' }, { text: 'ok' });
        const first = yield* Effect.forkChild(driver);
        yield* until('two pings settled', () => Effect.map(resting(thread), (rest) => calls(thread).length === 3 && rest));
        yield* settle;
        expect(calls(thread)).toHaveLength(3);
        expect(yield* reads.latest(thread)).toMatchObject({ ping: { anchor, ping: 2 } });
        const summary = yield* parts.list.summary(thread);
        expect(cacheWarmthOf(summary!, false, { curves: new Map(), accounts: new Map(), models: MODELS })).toMatchObject({
          state: 'warm',
          basis: 'promise',
        });
        expect(summary?.outcome?.runId).toBe(anchor);
        const transcript = (yield* harness.reads.snapshot(thread)).transcript;
        const pings = transcript.filter(
          (entry) => entry.type === 'signal' && 'signalType' in entry && entry.signalType === KEEP_WARM_SIGNAL_TYPE,
        );
        expect(pings).toHaveLength(2);
        const endings = transcript.filter(
          (entry) => entry.type === 'run-end' && pings.some((ping) => 'runId' in ping && ping.runId === entry.runId),
        );
        expect(endings).toHaveLength(2);
        expect(endings[0]).toMatchObject({ usage: { cacheReadInputTokens: 99_000 } });
        yield* Fiber.interrupt(first);
        knobs.pings = 3;
        plan(thread, { text: 'ok' });
        const second = yield* Effect.forkChild(driver);
        yield* until('the restarted driver sent the third ping of the same wait', () =>
          Effect.map(resting(thread), (rest) => calls(thread).length === 4 && rest),
        );
        expect(yield* reads.latest(thread)).toMatchObject({ ping: { anchor, ping: 3 } });
        knobs.pings = 4;
        knobs.spendable = false;
        yield* harness.threads.publish(thread);
        yield* settle;
        expect(calls(thread)).toHaveLength(4);
        knobs.spendable = true;
        plan(thread, { text: 'ok' });
        yield* harness.threads.publish(thread);
        yield* until('the spendable lead was pinged the fourth time', () =>
          Effect.map(resting(thread), (rest) => calls(thread).length === 5 && rest),
        );
        expect(yield* reads.latest(thread)).toMatchObject({ ping: { anchor, ping: 4 } });
        plan(thread, { text: 'Read the report.' });
        gate.resolve();
        yield* until('the child reported and the lead read it', () =>
          Effect.map(
            Effect.all([resting(thread), resting(child.threadId)]),
            ([leadRests, childRests]) => calls(thread).length === 6 && leadRests && childRests,
          ),
        );
        yield* harness.threads.publish(thread);
        yield* settle;
        expect(calls(thread)).toHaveLength(6);
        expect(yield* reads.standing(thread)).toMatchObject({ waits: false });
        yield* Fiber.interrupt(second);
      }),
  );
  it.effect('the driver pings a lead at rest whose own command still runs, but only under a promised cache lifetime', () =>
    Effect.gen(function* () {
      const { harness, live, parts, reads, own, deliveries, units } = yield* Floor;
      const thread = yield* lead;
      const anchor = yield* turn(thread, 'Run the build.', 'The build runs in the background.');
      const build = { installation: INSTALLATION, execution: ExecutionId.make('exec-keep-warm-build'), incarnation: 1 };
      const openedAt = yield* Clock.currentTimeMillis;
      yield* units.write('keepWarm.owedCommand', (unit) =>
        deliveries.openDelivery(unit, {
          execution: build,
          thread: ThreadId.make(thread),
          signalId: commandSignalId(build, 'call-build'),
          openedAt,
        }),
      );
      const promised = { value: false };
      const driver = makeKeepWarm({
        settings: () => Effect.succeed({ on: true, pings: 1 }),
        warmth: (summary) =>
          Effect.succeed(promised.value ? cacheWarmthOf(summary, false, { curves: new Map(), accounts: new Map(), models: MODELS }) : null),
        spending: (_summary, now) => Effect.succeed(now),
        marginMs: TTL_MS,
      }).pipe(
        Effect.provideService(ThreadLookup, parts.list as unknown as ThreadLookup['Service']),
        Effect.provideService(ThreadHarness, harness as unknown as ThreadHarness['Service']),
        Effect.provideService(ThreadLive, live as unknown as ThreadLive['Service']),
        Effect.provideService(OwnWork, own),
        Effect.flatMap((made) => Effect.scoped(made.drive())),
      );
      const driving = yield* Effect.forkChild(driver);
      yield* settle;
      expect(calls(thread)).toHaveLength(1);
      promised.value = true;
      plan(thread, { text: 'ok' });
      yield* harness.threads.publish(thread);
      yield* until('the lead was pinged while its command runs', () =>
        Effect.map(resting(thread), (rest) => calls(thread).length === 2 && rest),
      );
      expect(yield* reads.latest(thread)).toMatchObject({ ping: { anchor, ping: 1 } });
      yield* Fiber.interrupt(driving);
      yield* units.write('keepWarm.deliveredCommand', (unit) => deliveries.settleDelivery(unit, build));
    }),
  );
});
