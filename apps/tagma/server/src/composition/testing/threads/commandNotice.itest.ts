import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { lookupModels } from '@runlith/agent/thread/compaction/lookupModels';
import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { approvalModesLayer } from '@runlith/agent/modes/ApprovalModes';
import { expect } from 'bun:test';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Clock, Context, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Queue, Schedule, Stream } from 'effect';
import { Agent } from '@runlith/agent/Agent';
import { type AgentRunner, makeAgentRunner } from '@runlith/agent/AgentRunner';
import { stepLimit } from '@runlith/agent/AgentStep';
import type { ModelRequest } from '@runlith/agent/modelPort';
import { SUB_AGENT_DEPTH } from '@runlith/agent/collaboration/CollaborationConfig';
import { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { wakeUnlessStopped } from '../../../threads/testing/doubles.js';
import { unmeasuredObservation } from '../../../threads/testing/doubles.js';
import { threadAgentsLayer, threadCompactorLayer, threadFeaturesLayer, threadStorageLayer } from '@runlith/agent/thread/kernelPorts';
import { threadHostLayer, type ThreadWriteTx } from '@runlith/agent/thread/ThreadPorts';
import { makeThreadCompaction } from '@runlith/agent/thread/compaction/ThreadCompaction';
import { makeThreadDigestStrategy } from '@runlith/agent/thread/compaction/digestStrategy';
import { makeThreadLiveFeed } from '@runlith/agent/thread/run/ThreadLiveFeed';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { makeThreadSummaryStrategy } from '@runlith/agent/thread/compaction/summaryStrategy';
import { threadAgent } from '@runlith/agent/thread/agents/ThreadAgent';
import { registeredAgents } from '@runlith/agent/thread/conformance/agents';
import type { ThreadState } from '@runlith/agent/thread/state';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { ExecutionId, HostRequestKey, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { subscriptionRegistration } from '@runlith/builtin-catalog/subscription/provider';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { type Unit, MachineUnits, type WriteUnit } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { project } from '../../../projects/testing/doubles.js';
import { scopeRecord } from '../../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import type { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { commandSignalId } from '../../../executions/contract/wire/commands.js';
import type { CommandReading } from '../../../executions/contract/wire/commands.js';
import { TerminalUnavailable } from '../../../executions/contract/wire/refusals.js';
import { type CommandOutputRequest, CommandReader, CommandWaiters } from '../../../executions/contract/service/commands.js';
import { commandOutputReader } from '../../../executions/testing/doubles.js';
import { commandNoticeQueue } from '../../../executions/testing/doubles.js';
import { ExecutionRecords } from '../../../executions/contract/service/records.js';
import { ManagedCommands } from '../../../executions/contract/service/commands.js';
import { Terminals } from '../../../executions/contract/service/terminals.js';
import { threadAttachmentStore } from '../../../threads/testing/doubles.js';
import { threadInboxStore } from '../../../threads/testing/doubles.js';
import {
  threadCompactionStore,
  threadToolOutputStore,
  threadRunStore,
  threadRunStores,
  type ThreadStore,
  nativeTransitions,
  COMPACTION_POLICY,
  COMPACTION_PROMPT,
  COMPACTION_TEXT,
} from '../../../native-harness/testing/doubles.js';
import { sqliteThreadJournal } from '../../../threads/testing/doubles.js';
import { approvalPreferences } from '../../../threads/testing/doubles.js';
import type { ThreadTransitionStorage } from '@runlith/agent/thread/transition/port';
import { commandDelivery } from '../../../threads/testing/doubles.js';
import { commandNoticeTakeBack, commandSignalSend, stayIdle, asIdleDelivery } from '../../../threads/testing/doubles.js';
import { asNativeThreadState } from '../../../threads/testing/doubles.js';
import { threadStack, type ThreadParts } from '../threadParts.js';
import { AGENT_IDLE_MS, LEASE_RHYTHM, REAPER_RHYTHM, RECONCILE_INTERVAL_MS, SETTLEMENT_RHYTHM } from '../../../threads/testing/doubles.js';
import { storesOver, type Stores } from '../../../executions/testing/stores.js';
import { ENTRY_KINDS } from '../../manifest.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { builtinHarness } from '../../../external-harnesses/testing/builtin.js';
const OWNER = OPERATOR_PRINCIPAL;
const PROVIDER = 'subscription';
const MODEL = 'claude-opus-5-5';
const INSTALLATION = InstallationId.make('command-notice');
const USAGE = new Usage({
  inputTokens: 10,
  nonCachedInputTokens: 10,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 2,
  reasoningTokens: 0,
  totalTokens: 12,
});
const ORIGIN = new ModelIdentity({ provider: ProviderID.make(PROVIDER), model: ModelID.make(MODEL) });
const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.orDie(Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { readers: 1 }, pool)))),
  ),
  Layer.merge(BunFileSystem.layer),
);

const setup = Effect.fn('testing.commandNotices')(function* () {
  const race: {
    beforeUnit?: Effect.Effect<void>;
    inCreate?: Effect.Effect<void>;
    unregistered?: true;
  } = {};
  const beforeUnit = (): Effect.Effect<void> => {
    const before = race.beforeUnit;
    delete race.beforeUnit;
    return before ?? Effect.void;
  };
  function racingTransitions(
    inner: ThreadTransitionStorage<Unit<'machine'>, WriteUnit<'machine'>>,
  ): ThreadTransitionStorage<Unit<'machine'>, WriteUnit<'machine'>> {
    return {
      readAt: (threadId, work) => inner.readAt(threadId, work),
      writeAt: (threadId, work) => Effect.andThen(beforeUnit(), inner.writeAt(threadId, work)),
      writeAtIn: (threadId, work, tx) => inner.writeAtIn(threadId, work, tx),
      writeFold: (threadId, write, tx) => inner.writeFold(threadId, write, tx),
      readRecord: (threadId, evidence, tx) => inner.readRecord(threadId, evidence, tx),
      writeRecord: (threadId, evidence, write, tx) => inner.writeRecord(threadId, evidence, write, tx),
      appliedSeq: (runId) => inner.appliedSeq(runId),
      spend: (threadId, at, tx) => inner.spend(threadId, at, tx),
      revision: (threadId, tx) => inner.revision(threadId, tx),
      opened: (threadId, tx) => inner.opened(threadId, tx),
      revised: (threadId, tx, after) => inner.revised(threadId, tx, after),
    };
  }
  type RunStore = Effect.Success<ReturnType<typeof threadRunStore>>;
  const racingRuns = (inner: RunStore): RunStore => ({
    ...inner,
    createRun: (...args) => {
      const during = race.inCreate;
      delete race.inCreate;
      return Effect.andThen(during ?? Effect.void, inner.createRun(...args));
    },
    isRunning: (...args) => {
      if (!race.unregistered) return inner.isRunning(...args);
      delete race.unregistered;
      return Effect.fail(new ThreadStorageFailed({ call: 'isRunning', cause: new Error('the run could not be registered') }));
    },
  });
  let db: Context.Service.Shape<typeof MachineStore>['db'];
  let units: Context.Service.Shape<typeof MachineUnits>;
  let inbox: Effect.Success<ReturnType<typeof threadInboxStore>>;
  let records: ThreadRecords['Service'];
  let threads: ThreadStore;
  let runStores: Effect.Success<ReturnType<typeof threadRunStores>>;
  let threadFixture: ThreadParts;
  let terminalStore: Stores;
  let waiters: CommandWaiters['Service'];
  let harness: AgentHarness<ThreadState, Unit<'machine'>, WriteUnit<'machine'>>;
  let runner: AgentRunner;
  let root: string;
  let projectId: number;
  let serial = 0;
  const answered = (): readonly LLMEvent[] => {
    const id = `text-${++serial}`;
    return [
      { type: 'step-start', index: 0 },
      { type: 'text-start', id },
      { type: 'text-delta', id, text: 'Read it.' },
      { type: 'text-end', id },
      { type: 'step-finish', index: 0, reason: 'stop', usage: USAGE },
      { type: 'finish', reason: 'stop', usage: USAGE },
    ];
  };
  const model: {
    calls: number;
    held?: {
      readonly reached: Deferred.Deferred<void>;
      readonly go: Deferred.Deferred<void>;
    };
  } = { calls: 0 };
  const request = (): ModelRequest => ({
    plannedOutputTokens: 32000,
    origin: ORIGIN,
    text: () => {
      throw new Error('a command notice opens no one-shot call');
    },
    object: () => {
      throw new Error('a command notice opens no one-shot call');
    },
    stream: () => {
      model.calls += 1;
      const held = model.held;
      delete model.held;
      return held === undefined
        ? Stream.fromIterable(answered())
        : Stream.fromEffect(Deferred.succeed(held.reached, undefined).pipe(Effect.andThen(Deferred.await(held.go)))).pipe(
            Stream.flatMap(() => Stream.fromIterable(answered())),
          );
    },
  });
  const execution = (id: string): ExecutionRef => ({ installation: INSTALLATION, execution: ExecutionId.make(id), incarnation: 1 });
  const ended = (ref: ExecutionRef): ExecutionSummary => ({
    state: {
      ref,
      transport: 'pipes',
      lifetime: 'command',
      purpose: 'command',
      phase: 'ended',
      streams: { stdout: 'eof', stderr: 'eof', pty: 'eof' },
      record: 'available',
      cleanup: 'complete',
      nativeExit: { _tag: 'Code', code: 0 },
    },
    custody: {
      revision: 0,
      holder: Principal.make('thread:notice'),
      origin: Principal.make('thread:notice'),
      target: { environment: 'host', namespace: 'machine', cwd: '/repo', dependencies: [] },
    },
    streams: [],
    native: {},
    input: { acceptedThrough: ByteOffset.make('0'), pendingBytes: 0 },
    decision: {
      _tag: 'Completed',
      operation: { installation: INSTALLATION, operation: HostRequestKey.make('op-1') },
      execution: ref,
      sequence: 0,
    },
  });
  const deliveryTo = Effect.fn('testing.commandDelivery')(function* (ref: ExecutionRef, idle: ReturnType<typeof asIdleDelivery>) {
    return yield* commandDelivery({
      send: commandSignalSend(
        threadFixture.list,
        harness as unknown as AgentHarness<ReturnType<typeof asNativeThreadState>, Unit<'machine'>, WriteUnit<'machine'>>,
        idle,
      ),
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(CommandWaiters, waiters),
          Layer.mock(Terminals, { wait: () => Effect.succeed({ _tag: 'Decided', summary: ended(ref) }) }),
          Layer.mock(ManagedCommands, { record: () => Effect.succeed(null), changes: () => Stream.empty }),
          Layer.mock(ExecutionRecords, {
            bytes: (cursor) =>
              Effect.succeed({
                range: {
                  cursor,
                  next: cursor.offset,
                  retainedFrom: ByteOffset.make('0'),
                  durableThrough: ByteOffset.make('0'),
                  gap: false,
                },
                bytes: new Uint8Array(0),
              }),
            records: () => Stream.empty,
          }),
        ),
      ),
    );
  });
  const owedThread = Effect.fn('testing.owedCommand')(function* (ref: ExecutionRef, acp = false) {
    const row = yield* Effect.acquireRelease(threads.insert({ ownerId: OWNER, agentId: acp ? 'harness' : 'tagma' }), (row) =>
      harness.threads.handle(row.id, OWNER).delete().pipe(Effect.orDie),
    );
    if (acp) {
      yield* units.write('commandNotice.acp', (unit) =>
        threadFixture.rows.attachFacet(
          {
            threadId: row.id,
            projectId,
            harness: {
              facet: {
                name: 'claude-code',
                presentation: harnessPresentation(builtinHarness('claude-code')),
                sessionKey: 'notice-session',
                execution: null,
                observation: unmeasuredObservation(),
              },
              kernel: {
                transport: { adapter: 'acp', profile: 'claude-code', agent: null },
                capabilities: NATIVE_CAPABILITIES,
                selection: { provider: PROVIDER, model: MODEL, reasoning: 'high' },
                account: null,
                switches: {},
              },
            },
          },
          unit,
        ),
      );
    } else yield* scopeRecord(db, row.id, { projectId });
    const handle = harness.threads.handle(row.id, OWNER);
    if (!acp) yield* handle.setModelSettings({ provider: PROVIDER, model: MODEL, reasoning: 'high', switches: {} });
    const thread = ThreadId.make(row.id);
    const signal = commandSignalId(ref, 'call-1');
    const openedAt = yield* Clock.currentTimeMillis;
    yield* units.write('commandNotice.owedThread', (unit) =>
      terminalStore.deliveries.openDelivery(unit, { execution: ref, thread, signalId: signal, openedAt }),
    );
    return { thread, signal };
  });
  const owed = (ref: ExecutionRef) => waiters.owed(ref);
  const accepted = (signal: string) => inbox.receipt(signal);
  const runsOf = Effect.fnUntraced(function* (thread: string) {
    return (yield* harness.reads.snapshot(thread)).latestRun;
  });
  const waitForState = Effect.fn('testing.commandNoticeState')(function* (thread: string, ready: (state: ThreadState) => boolean) {
    const seen = yield* Deferred.make<ThreadState>();
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        harness.reads.subscribeStates((state) => {
          if (state.thread.id === thread && ready(state)) Deferred.doneUnsafe(seen, Exit.succeed(state));
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    const current = yield* harness.reads.snapshot(thread);
    if (ready(current)) return current;
    return yield* Deferred.await(seen);
  }, Effect.scoped);
  const context = yield* Effect.context<MachineStore | MachineUnits | FileSystem.FileSystem>();
  root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'tagma-command-notice-' });
  db = (yield* MachineStore).db;
  units = yield* MachineUnits;
  inbox = yield* threadInboxStore(ENTRY_KINDS);
  const created = yield* db
    .insert(project())
    .values({
      name: 'command-notice',
      repoKey: '/command-notice',
      rootPath: '/command-notice',
      createdAt: new Date(yield* Clock.currentTimeMillis),
    })
    .returning({ id: project().id })
    .get();
  if (!created) return yield* Effect.die(new Error('The project could not be created.'));
  projectId = created.id;
  records = yield* makeThreadRecords;
  ({ store: threads, threads: threadFixture } = yield* threadStack({ db, units, records, kinds: ENTRY_KINDS }));
  runStores = yield* threadRunStores(records, ENTRY_KINDS);
  terminalStore = storesOver(db, INSTALLATION);
  waiters = yield* commandNoticeQueue({
    deliveries: terminalStore.deliveries,
    ended: yield* Queue.unbounded<ExecutionRef>(),
    takeBack: Effect.suspend(() =>
      commandNoticeTakeBack(
        harness as unknown as AgentHarness<ReturnType<typeof asNativeThreadState>, Unit<'machine'>, WriteUnit<'machine'>>,
      ),
    ).pipe(Effect.provide(context)),
  });
  const catalog = modelCatalog([subscriptionRegistration]);
  const models = lookupModels({
    request,
    capacity: (provider: string, model: string | null | undefined) => catalog.textModelCapacity(provider, model),
    cacheLifetime: (provider: string, model: string | null | undefined) => catalog.resolveTextModel(provider, model).cacheLifetime,
  });
  runner = yield* makeAgentRunner({ models, idleMs: AGENT_IDLE_MS() });
  const agent = new Agent({
    id: 'tagma',
    name: 'Notice floor',
    description: 'Reads what its commands left.',
    instructions: () => 'Read what arrives.',
    stopWhen: [stepLimit(4)],
    tools: () => ({}),
  });
  const foreign = new Agent({
    id: 'harness',
    name: 'Foreign notice floor',
    description: 'Reads command endings over a hosted transport.',
    instructions: () => 'Read what arrives.',
    stopWhen: [stepLimit(4)],
    tools: () => ({}),
  });
  const registered = [agent, foreign].map((agent) =>
    threadAgent({ agent, runner, runPolicy: { userStartable: true, backgroundStartable: true }, context: () => Effect.succeed({}) }),
  );
  const made = AgentHarness.make<ThreadState, Unit<'machine'>, WriteUnit<'machine'>>(
    Layer.mergeAll(
      approvalModesLayer,
      Layer.succeed(ThreadEntryKinds, ENTRY_KINDS),
      threadStorageLayer<Unit<'machine'>, WriteUnit<'machine'>>({
        storage: threads,
        eventLog: yield* sqliteThreadJournal(),
        transitions: racingTransitions(yield* nativeTransitions(threads)),
        createRuns: (ownerId) => racingRuns(runStores({ ownerId, scope: sql`1 = 1` })),
        attachments: yield* threadAttachmentStore(join(root, 'attachments')),
        inbox,
        toolOutputs: threadToolOutputStore(join(root, 'results')),
        ownerSettings: yield* approvalPreferences(),
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
          checkpoints: yield* threadCompactionStore(),
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
      threadAgentsLayer(yield* registeredAgents(registered, 'test')),
    ),
    yield* makeThreadLiveFeed<ThreadState>(),
  );
  harness = yield* Effect.acquireRelease(made, (opened) => opened.dispose());
  const native = yield* harness.runs.transports().of({ adapter: 'native', profile: null, agent: 'tagma' }).pipe(Effect.orDie);
  yield* harness.runs
    .transports()
    .register({ ...native, adapter: 'acp', runs: { ...native.runs, launch: () => Effect.void } })
    .pipe(Effect.orDie);
  return {
    race,
    model,
    catalog,
    harness,
    threadFixture,
    threads,
    runStores,
    units,
    waiters,
    projectId,
    execution,
    deliveryTo,
    owedThread,
    owed,
    accepted,
    runsOf,
    waitForState,
  };
});

class World extends Context.Service<World, Effect.Success<ReturnType<typeof setup>>>()('testing/CommandNoticesWorld') {}

layer(Layer.effect(World, setup()).pipe(Layer.provideMerge(storage)), { excludeTestServices: true })('command notices', (it) => {
  it.effect('a notice the thread accepts settles its obligation in the same unit, and one it may not take lands nowhere', () =>
    Effect.gen(function* () {
      const { execution, owedThread, deliveryTo, accepted, owed, waiters } = yield* World;
      const kept = execution('exec-kept');
      const keptTo = yield* owedThread(kept);
      expect(yield* (yield* deliveryTo(kept, stayIdle)).deliver(kept)).toEqual({ _tag: 'Settled' });
      expect((yield* accepted(keptTo.signal))?.id).toBe(keptTo.signal);
      expect(yield* owed(kept)).toBeNull();
      const read = execution('exec-read');
      const readBy = yield* owedThread(read);
      expect(yield* waiters.take(read, readBy.thread)).toBe(true);
      expect(yield* (yield* deliveryTo(read, stayIdle)).deliver(read)).toEqual({ _tag: 'Settled' });
      expect(yield* accepted(readBy.signal)).toBeUndefined();
      expect(yield* owed(read)).not.toBeNull();
    }),
  );
  it.effect('a notice declined on an idle thread opens no run, and one accepted wakes the thread with it', () =>
    Effect.gen(function* () {
      const { execution, owedThread, waiters, deliveryTo, accepted, runsOf, owed } = yield* World;
      const wake: ReturnType<typeof asIdleDelivery> = () => Effect.succeed('wake');
      const read = execution('exec-wake-read');
      const readBy = yield* owedThread(read);
      expect(yield* waiters.take(read, readBy.thread)).toBe(true);
      expect(yield* (yield* deliveryTo(read, wake)).deliver(read)).toEqual({ _tag: 'Settled' });
      expect(yield* accepted(readBy.signal)).toBeUndefined();
      expect(yield* runsOf(readBy.thread)).toBeNull();
      const woken = execution('exec-wake');
      const wokenTo = yield* owedThread(woken);
      expect(yield* (yield* deliveryTo(woken, wake)).deliver(woken)).toEqual({ _tag: 'Settled' });
      expect((yield* accepted(wokenTo.signal))?.deliveredToRunId).toBe((yield* runsOf(wokenTo.thread))?.id);
      expect(yield* owed(woken)).toBeNull();
    }),
  );
  it.effect('a background command ending opens a follow-up on a completed idle Claude acp thread just as on native', () =>
    Effect.gen(function* () {
      const { harness, threadFixture, execution, owedThread, runsOf, deliveryTo, accepted, owed, units } = yield* World;
      const idle = wakeUnlessStopped(threadFixture.list);
      for (const acp of [false, true]) {
        const ref = execution(acp ? 'exec-idle-acp' : 'exec-idle-native');
        const recipient = yield* owedThread(ref, acp);
        const completed = yield* Deferred.make<void>();
        const unsubscribe = harness.reads.subscribeStates((state) => {
          if (state.thread.id === recipient.thread && state.activeRun === null && state.latestRun?.status === 'completed')
            Deferred.doneUnsafe(completed, Exit.void);
        });
        try {
          const first = yield* harness.threads.handle(recipient.thread, OWNER).send('leave a command running');
          if (acp) {
            const plan = harness.runs.reports().of('acp').ended({ id: first.runId, threadId: recipient.thread }, { kind: 'completed' });
            yield* units.write('commandNotice.completed', (unit) => plan.run(unit as unknown as ThreadWriteTx));
          }
          yield* Deferred.await(completed);
          const previous = yield* runsOf(recipient.thread);
          expect(previous?.status).toBe('completed');
          expect((yield* harness.reads.snapshot(recipient.thread)).activeRun).toBeNull();
          expect(yield* (yield* deliveryTo(ref, idle)).deliver(ref)).toEqual({ _tag: 'Settled' });
          const opened = (yield* accepted(recipient.signal))?.deliveredToRunId;
          if (opened == null) return yield* Effect.die(new Error('the command ending opened no follow-up run'));
          expect(opened).not.toBe(previous?.id);
          expect((yield* runsOf(recipient.thread))?.id).toBe(opened);
          expect(yield* owed(ref)).toBeNull();
          if (acp) {
            const plan = harness.runs.reports().of('acp').ended({ id: opened, threadId: recipient.thread }, { kind: 'completed' });
            yield* units.write('commandNotice.followup', (unit) => plan.run(unit as unknown as ThreadWriteTx));
          }
        } finally {
          unsubscribe();
        }
      }
    }),
  );
  it.effect(
    'an ending that comes while a turn runs reaches it once: a turn that steps reads it at its next step, and a turn that ends without reading it is followed by the turn it opens',
    () =>
      Effect.gen(function* () {
        const { harness, threadFixture, model, threads, units, execution, owedThread, runsOf, deliveryTo, accepted, owed, waitForState } =
          yield* World;
        const idle = wakeUnlessStopped(threadFixture.list);
        const stepped = execution('exec-running-native');
        const steppedTo = yield* owedThread(stepped);
        const held = { reached: yield* Deferred.make<void>(), go: yield* Deferred.make<void>() };
        model.held = held;
        yield* harness.threads.handle(steppedTo.thread, OWNER).send('leave a command running');
        yield* Deferred.await(held.reached);
        const turn = yield* runsOf(steppedTo.thread);
        expect(yield* (yield* deliveryTo(stepped, idle)).deliver(stepped)).toEqual({ _tag: 'Settled' });
        expect(yield* owed(stepped)).toBeNull();
        yield* Deferred.succeed(held.go, undefined);
        yield* waitForState(steppedTo.thread, (state) => state.latestRun !== null && state.latestRun.status !== 'running');
        expect(yield* accepted(steppedTo.signal)).toMatchObject({ state: 'acknowledged', deliveredToRunId: turn?.id });
        const transcript = (yield* threads.transcriptOf(steppedTo.thread)) ?? [];
        expect(transcript.filter((entry) => entry.type === 'signal')).toHaveLength(1);

        const hosted = execution('exec-running-acp');
        const hostedTo = yield* owedThread(hosted, true);
        const first = yield* harness.threads.handle(hostedTo.thread, OWNER).send('leave a command running');
        expect(yield* (yield* deliveryTo(hosted, idle)).deliver(hosted)).toEqual({ _tag: 'Settled' });
        const ended = harness.runs.reports().of('acp').ended({ id: first.runId, threadId: hostedTo.thread }, { kind: 'completed' });
        yield* units.write('commandNotice.endedWithout', (unit) => ended.run(unit as unknown as ThreadWriteTx));
        const settled = Effect.map(harness.reads.snapshot(hostedTo.thread), ({ latestRun }) =>
          latestRun === null ? false : latestRun.id !== first.runId || latestRun.settledNotifiedAt !== null,
        );
        yield* settled.pipe(Effect.repeat({ while: (done) => !done, schedule: Schedule.spaced(10) }));
        const next = (yield* runsOf(hostedTo.thread))?.id;
        expect(next).not.toBe(first.runId);
        expect(yield* accepted(hostedTo.signal)).toMatchObject({ state: 'acknowledged', deliveredToRunId: next });
        if (next === undefined) return;
        const closed = harness.runs.reports().of('acp').ended({ id: next, threadId: hostedTo.thread }, { kind: 'completed' });
        yield* units.write('commandNotice.followupEnded', (unit) => closed.run(unit as unknown as ThreadWriteTx));
      }),
  );
  it.effect('an ending that comes after its turn was stopped wakes nothing and is read once by the next turn', () =>
    Effect.gen(function* () {
      const { harness, threadFixture, model, threads, execution, owedThread, runsOf, deliveryTo, accepted, waitForState } = yield* World;
      const stopped = execution('exec-after-stop');
      const stoppedTo = yield* owedThread(stopped);
      const handle = harness.threads.handle(stoppedTo.thread, OWNER);
      const held = { reached: yield* Deferred.make<void>(), go: yield* Deferred.make<void>() };
      model.held = held;
      yield* handle.send('leave a command running');
      yield* Deferred.await(held.reached);
      yield* handle.stop();
      const aborted = (yield* waitForState(stoppedTo.thread, (state) => state.latestRun?.status === 'aborted')).latestRun;
      expect(yield* (yield* deliveryTo(stopped, wakeUnlessStopped(threadFixture.list))).deliver(stopped)).toEqual({ _tag: 'Settled' });
      expect(yield* accepted(stoppedTo.signal)).toMatchObject({ state: 'queued', deliveredToRunId: null, body: { waits: true } });
      expect((yield* runsOf(stoppedTo.thread))?.id).toBe(aborted?.id);
      const next = yield* handle.send('go on');
      yield* waitForState(stoppedTo.thread, (state) => state.latestRun?.id === next.runId && state.latestRun.status !== 'running');
      expect(yield* accepted(stoppedTo.signal)).toMatchObject({ state: 'acknowledged', deliveredToRunId: next.runId });
      const transcript = (yield* threads.transcriptOf(stoppedTo.thread)) ?? [];
      expect(transcript.filter((entry) => entry.type === 'signal')).toHaveLength(1);
    }),
  );
  it.effect(
    'a wake cut while its run is being opened commits its opening whole: the run, the notice it took and the obligation it settles',
    () =>
      Effect.gen(function* () {
        const { execution, owedThread, race, deliveryTo, runsOf, owed, accepted, waitForState } = yield* World;
        const cut = execution('exec-wake-cut');
        const cutTo = yield* owedThread(cut);
        const reached = yield* Deferred.make<void>();
        const go = yield* Deferred.make<void>();
        race.inCreate = Effect.andThen(Deferred.succeed(reached, undefined), Deferred.await(go));
        const delivering = yield* Effect.forkChild((yield* deliveryTo(cut, () => Effect.succeed('wake'))).deliver(cut));
        yield* Deferred.await(reached);
        yield* Fiber.interrupt(delivering);
        expect(yield* owed(cut)).not.toBeNull();
        expect(yield* accepted(cutTo.signal)).toBeUndefined();
        expect(yield* runsOf(cutTo.thread)).toBeNull();
        yield* Deferred.succeed(go, undefined);
        const opened = (yield* waitForState(cutTo.thread, (state) => state.latestRun !== null)).latestRun;
        expect(yield* accepted(cutTo.signal)).toMatchObject({ state: 'acknowledged', deliveredToRunId: opened?.id });
        expect(yield* owed(cut)).toBeNull();
      }),
  );
  it.effect('a wake whose run fails to register after its opening committed leaves the notice with that run, written once', () =>
    Effect.gen(function* () {
      const { execution, owedThread, race, harness, deliveryTo, runsOf, accepted, threads, owed } = yield* World;
      const unregistered = execution('exec-wake-unregistered');
      const unregisteredTo = yield* owedThread(unregistered);
      race.unregistered = true;
      const failed = yield* Deferred.make<void>();
      const unsubscribe = harness.reads.subscribeStates((state) => {
        if (state.thread.id === unregisteredTo.thread && state.activeRun === null && state.latestRun?.status === 'failed')
          Deferred.doneUnsafe(failed, Exit.void);
      });
      try {
        const delivery = yield* deliveryTo(unregistered, () => Effect.succeed('wake'));
        expect(yield* delivery.deliver(unregistered)).toEqual({ _tag: 'Settled' });
        yield* Deferred.await(failed);
        expect(yield* delivery.deliver(unregistered)).toEqual({ _tag: 'Settled' });
      } finally {
        unsubscribe();
      }
      const opened = yield* runsOf(unregisteredTo.thread);
      expect(opened?.status).toBe('failed');
      expect(yield* accepted(unregisteredTo.signal)).toMatchObject({ state: 'acknowledged', deliveredToRunId: opened?.id });
      const transcript = (yield* threads.transcriptOf(unregisteredTo.thread)) ?? [];
      expect(transcript.filter((entry) => entry.type === 'signal')).toHaveLength(1);
      expect(yield* owed(unregistered)).toBeNull();
    }),
  );
  const unreadAuthority: CommandOutputRequest['authority'] = {
    get prepared(): never {
      throw new Error('the command notice fixture does not authorize reads');
    },
    recheck: () => Effect.die('the command notice fixture never rechecks authority'),
  };
  const ownerRead = Effect.fn('testing.ownerCommandOutput')(function* (ref: ExecutionRef, thread: ThreadId) {
    const { projectId, waiters } = yield* World;
    const doubles = Layer.mergeAll(
      Layer.mock(ManagedCommands, {
        bytes: (cursor) =>
          Effect.succeed({
            range: { cursor, next: cursor.offset, retainedFrom: ByteOffset.make('0'), durableThrough: ByteOffset.make('0'), gap: false },
            bytes: new Uint8Array(0),
          }),
        changes: () => Stream.empty,
      }),
      Layer.mock(CommandReader, {
        one: () =>
          Effect.succeed<CommandReading>({
            command: {
              projectId,
              execution: ref,
              owner: { _tag: 'Thread', thread },
              origin: { _tag: 'Thread', thread, toolCall: 'call-1' },
              policyIdentity: 'p',
              admittedAt: 0,
            },
            live: {
              _tag: 'Held',
              readAt: 0,
              entry: {
                state: {
                  ref,
                  transport: 'pipes',
                  lifetime: 'command',
                  purpose: 'command',
                  phase: 'ended',
                  nativeExit: { _tag: 'Code', code: 0 },
                  streams: { stdout: 'eof', stderr: 'eof', pty: 'eof' },
                  record: 'available',
                  cleanup: 'complete',
                },
                admission: { origin: { scope: 'project', owner: `thread:${thread}`, cohort: 'commands' }, limits: {}, policyIdentity: 'p' },
                deadline: { execution: ref, revision: 0, origin: 'default', elapsedMs: 1_000 },
                admittedAtMs: 0,
              },
            },
          }),
        follow: () => Stream.empty,
      }),
      Layer.mock(Terminals, { state: () => Effect.succeed(undefined) }),
    );
    return yield* Effect.gen(function* () {
      const commands = yield* ManagedCommands;
      const reader = yield* CommandReader;
      const terminals = yield* Terminals;
      return yield* commandOutputReader({ commands, reader, waiters, terminals }).output({
        projectId,
        reader: thread,
        thread,
        execution: ref,
        authority: unreadAuthority,
      });
    }).pipe(Effect.provide(doubles));
  });
  it.effect(
    'a notice accepted onto a running turn and not yet given to the model is taken back when its thread reads the command ended',
    () =>
      Effect.gen(function* () {
        const { execution, owedThread, model, harness, runsOf, deliveryTo, accepted, threads, owed, waitForState } = yield* World;
        const read = execution('exec-read-under-run');
        const readBy = yield* owedThread(read);
        const held = { reached: yield* Deferred.make<void>(), go: yield* Deferred.make<void>() };
        model.held = held;
        const before = model.calls;
        yield* harness.threads.handle(readBy.thread, OWNER).send('watch the command');
        yield* Deferred.await(held.reached);
        const turn = yield* runsOf(readBy.thread);
        expect(yield* (yield* deliveryTo(read, () => Effect.succeed('wake'))).deliver(read)).toEqual({ _tag: 'Settled' });
        expect((yield* accepted(readBy.signal))?.state).toBe('queued');
        expect((yield* ownerRead(read, readBy.thread)).phase).toBe('ended');
        expect((yield* accepted(readBy.signal))?.state).toBe('acknowledged');
        yield* Deferred.succeed(held.go, undefined);
        yield* waitForState(readBy.thread, (state) => state.latestRun !== null && state.latestRun.status !== 'running');
        expect((yield* runsOf(readBy.thread))?.id).toBe(turn?.id);
        expect(model.calls - before).toBe(1);
        expect((yield* accepted(readBy.signal))?.deliveredToRunId).toBeNull();
        const transcript = (yield* threads.transcriptOf(readBy.thread)) ?? [];
        expect(transcript.filter((entry) => entry.type === 'signal')).toEqual([]);
        expect(yield* owed(read)).toBeNull();
      }),
  );
  it.effect('a take-back whose discharge fails retires nothing, so the notice still reaches the turn', () =>
    Effect.gen(function* () {
      const { execution, owedThread, model, harness, deliveryTo, waiters, accepted, threads, waitForState } = yield* World;
      const stopped = execution('exec-stop-unsettled');
      const stoppedBy = yield* owedThread(stopped);
      const held = { reached: yield* Deferred.make<void>(), go: yield* Deferred.make<void>() };
      model.held = held;
      yield* harness.threads.handle(stoppedBy.thread, OWNER).send('watch the command');
      yield* Deferred.await(held.reached);
      expect(yield* (yield* deliveryTo(stopped, () => Effect.succeed('wake'))).deliver(stopped)).toEqual({ _tag: 'Settled' });
      const refused = yield* Effect.flip(
        waiters.answered(stopped, stoppedBy.thread, stoppedBy.signal, () =>
          Effect.fail(new TerminalUnavailable({ owner: 'store', message: 'the stop could not be settled' })),
        ),
      );
      expect(refused._tag).toBe('TerminalUnavailable');
      expect((yield* accepted(stoppedBy.signal))?.state).toBe('queued');
      yield* Deferred.succeed(held.go, undefined);
      yield* waitForState(stoppedBy.thread, (state) => state.latestRun !== null && state.latestRun.status !== 'running');
      const transcript = (yield* threads.transcriptOf(stoppedBy.thread)) ?? [];
      expect(transcript.filter((entry) => entry.type === 'signal')).toHaveLength(1);
    }),
  );
  it.effect('a notice the model was already given stands when its thread reads the command ended afterwards', () =>
    Effect.gen(function* () {
      const { execution, owedThread, model, harness, runsOf, deliveryTo, accepted, threads, waitForState } = yield* World;
      const read = execution('exec-read-after-given');
      const readBy = yield* owedThread(read);
      const held = { reached: yield* Deferred.make<void>(), go: yield* Deferred.make<void>() };
      model.held = held;
      yield* harness.threads.handle(readBy.thread, OWNER).send('watch the command');
      yield* Deferred.await(held.reached);
      const turn = yield* runsOf(readBy.thread);
      expect(yield* (yield* deliveryTo(read, () => Effect.succeed('wake'))).deliver(read)).toEqual({ _tag: 'Settled' });
      yield* Deferred.succeed(held.go, undefined);
      yield* waitForState(readBy.thread, (state) => state.latestRun !== null && state.latestRun.status !== 'running');
      expect((yield* accepted(readBy.signal))?.deliveredToRunId).toBe(turn?.id);
      expect((yield* ownerRead(read, readBy.thread)).phase).toBe('ended');
      expect((yield* accepted(readBy.signal))?.deliveredToRunId).toBe(turn?.id);
      const transcript = (yield* threads.transcriptOf(readBy.thread)) ?? [];
      expect(transcript.filter((entry) => entry.type === 'signal')).toHaveLength(1);
    }),
  );
  it.effect('a wake that finds another run took the thread leaves the notice queued for that run', () =>
    Effect.gen(function* () {
      const { execution, owedThread, threads, runStores, race, deliveryTo, runsOf, accepted, owed } = yield* World;
      const lost = execution('exec-wake-lost');
      const lostTo = yield* owedThread(lost);
      const row = yield* threads.find(lostTo.thread);
      if (!row) return yield* Effect.die(new Error('The thread could not be read.'));
      const elsewhere = runStores({ ownerId: 'elsewhere', scope: sql`1 = 1` });
      const winner: {
        id?: string;
      } = {};
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          if (winner.id === undefined) return;
          const at = new Date(yield* Clock.currentTimeMillis);
          yield* elsewhere.settleRun(winner.id, {
            status: 'completed',
            progress: { stage: 'completed', message: null },
            finishedAt: at,
            heartbeatAt: at,
          });
        }).pipe(Effect.orDie),
      );
      race.beforeUnit = Effect.orDie(
        elsewhere
          .createRun({
            startFrom: row,
            kind: 'turn',
            approval: { mode: row.authority.mode, interactive: false },
            progress: { stage: 'starting', message: 'elsewhere' },
          })
          .pipe(Effect.map((created) => void (winner.id = created.run.id))),
      );
      expect(yield* (yield* deliveryTo(lost, () => Effect.succeed('wake'))).deliver(lost)).toEqual({ _tag: 'Settled' });
      expect(winner.id).toBeDefined();
      expect((yield* runsOf(lostTo.thread))?.id).toBe(winner.id);
      expect((yield* accepted(lostTo.signal))?.state).toBe('queued');
      expect(yield* owed(lost)).toBeNull();
    }),
  );
});
