import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Data, Deferred, Effect, Layer } from 'effect';
import { ToolAnswer, toolSettleEffect } from '../agent/tool';
import { collaborationTools } from './CollaborationTools';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import type { ThreadBirth, ThreadHost } from '../thread/ThreadPorts';
import { threadHostLayer } from '../thread/ThreadPorts';
import type { ThreadHostBinding, ThreadMetadataRow, ThreadRunRow } from '../thread/rows';
import { NATIVE_CAPABILITIES } from '../thread/record';
import type { ThreadQuestionEntry } from '../transcript/entries';
import { makeThreadEntryReader } from '../transcript/kinds';
import type { ThreadAgent } from '../thread/agents/ThreadAgent';
import { makeAgentRegistry } from '../thread/agents/AgentRegistry';
import { AgentProfileUnknownError, type AgentProfile } from '../thread/agents/AgentProfile';
import { threadAgentsLayer, threadStorageLayer } from '../thread/kernelPorts';
import { ThreadMemory } from '../thread/storage/memory/state';
import { makeMemoryRows } from '../thread/storage/memory/ThreadRows';
import { makeMemoryRuns } from '../thread/storage/memory/ThreadRuns';
import { makeMemoryEvents } from '../thread/storage/memory/ThreadEvents';
import { makeMemoryOwnerSettings } from '../thread/storage/memory/OwnerSettings';
import { inMemoryThreadTransitions } from '../thread/storage/memory/ThreadTransitions';
import { inMemoryInboxStorage } from '../thread/storage/InMemoryInboxStorage';
import type { MemoryTx } from '../thread/storage/memory/units';
import { emptyToolOutputs, runRow } from '../thread/conformance/runCycle/runDoubles';
import { ThreadBranch } from '../thread/run/ThreadBranch';
import { SpawnSeats, spawnSeatsLayer } from './collaborationResidency';
import { nativeThreadRunsLayer } from './native/runs';
import { nativeThreadsLayer } from './native/threads';
import { threadChangesLayer } from '../thread/run/ThreadChanges';
import { threadRunLedgerLayer } from '../thread/run/ThreadRunLedger';
import { ThreadStopping } from '../thread/run/ThreadStopping';
import { RunScheduler, type RunAdmitted, type RunInput, type RunSubject } from '../thread/run/scheduler/RunScheduler';
import { ThreadSnapshots } from '../thread/run/ThreadSnapshots';
import { ThreadCallBroke, threadCauseOf, type ThreadBorderFailed } from '../thread/ThreadBorder';
import { ThreadBudget } from '../thread/ThreadPorts';
import { ContextCompaction } from './compaction';
import { DeclaredCollaboration } from './CollaborationConfig';
import { ThreadModel } from './model';
import { Threads } from './threads';
import { ThreadTypes } from './types';
import { ThreadDirectory } from './ThreadDirectory';
import { ThreadEnvelopes } from './ThreadEnvelopes';
import { ThreadSpawnAccess } from './ThreadSpawnAccess';
import { ThreadPlanes, threadPlanesLayer } from './ThreadPlanes';
import { ThreadSpawnTree, threadSpawnTreeLayer } from './ThreadSpawnTree';
import { spawnRequestId } from './births';
import { ThreadRewind } from '../thread/run/ThreadRewind';
import { runAdmissionLayer } from '../thread/run/runAdmission';
import { planeRefusalOf } from './planeRefusal';
const unused = () => Effect.die('This birth contract does not use this operation');
function unusedSync(): never {
  throw new Error('This birth contract does not use this synchronous operation');
}
class WorkspaceForeign extends Data.TaggedError('WorkspaceForeign')<{
  readonly id: string;
}> {}
const WORKSPACE: ThreadHostBinding = { kind: 'workspace', id: 'ws-1' };
const READER: AgentProfile = { id: 'reader', baseAgentId: 'tagma', description: 'Reads, and does not write.', tools: ['read'] };
const TASK = 'Read the failing test and report';
const shipped = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);
const ordinary = shipped.options.find((option) => !option.operatorOnly && option.defaultReasoning)!;
function question(runId: string): ThreadQuestionEntry {
  return { type: 'question', id: 'q', runId, questionId: 'q', status: 'open', questions: [], toolCalls: [] };
}
describe('a spawn binds its host and decides its request once', () => {
  it.effect(
    'a named binding with no birth hook to admit it refuses, and nothing is born',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld();
      expect(yield* world.refuse({ requestId: 'call-1', host: WORKSPACE })).toMatchObject({
        _tag: 'BirthRefused',
        reason: 'host-unadmitted',
      });
      expect(world.children()).toEqual([]);
    }),
  );
  it.effect(
    'a named binding cannot ride a fork: copied context is not a fresh task',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld({ onThreadBorn: () => Effect.void });
      expect(yield* world.refuse({ requestId: 'call-1', host: WORKSPACE, fork: 'all' })).toMatchObject({
        _tag: 'BirthRefused',
        reason: 'host-with-fork',
      });
      expect(world.children()).toEqual([]);
    }),
  );
  it.effect(
    'an admitted binding reaches the host with the child and lands on its row',
    Effect.fnUntraced(function* () {
      const admitted: ThreadHostBinding[] = [];
      const world = yield* spawnWorld({
        onThreadBorn: (input) =>
          Effect.sync(() => {
            if (input.host) admitted.push(input.host);
          }),
      });
      const started = yield* world.spawn({ requestId: 'call-1', host: WORKSPACE });
      expect(admitted).toEqual([WORKSPACE]);
      expect(world.child(started.threadId)).toMatchObject({ hostKind: 'workspace', hostId: 'ws-1' });
    }),
  );
  it.effect(
    'an inherited binding is carried without a second admission',
    Effect.fnUntraced(function* () {
      const asked: (ThreadHostBinding | undefined)[] = [];
      const world = yield* spawnWorld({
        parent: { hostKind: 'workspace', hostId: 'ws-parent' },
        onThreadBorn: (input) => Effect.sync(() => asked.push(input.host)),
      });
      const started = yield* world.spawn({ requestId: 'call-1' });
      expect(asked).toEqual([undefined]);
      expect(world.child(started.threadId)).toMatchObject({ hostKind: 'workspace', hostId: 'ws-parent' });
    }),
  );
  it.effect(
    'a parent waiting on a question bears no child, and nothing is provisioned',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld({ parent: { pendingInteraction: question('run-q') } });
      expect(yield* world.refuse({ requestId: 'call-1' })).toMatchObject({ _tag: 'BirthRefused', reason: 'pending-interaction' });
      expect(world.children()).toEqual([]);
      expect(world.provisions()).toEqual([]);
    }),
  );
  it.effect(
    'the run answering its own question bears the child the answer approved',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld({ parent: { pendingInteraction: question('run-parent') } });
      const born = yield* world.spawnFrom(runRow('run-parent'), { requestId: 'call-1', step: 1 });
      expect(world.child(born.threadId)?.bornOf).toEqual({ by: 'run-parent', step: 1 });
    }),
  );
  it.effect(
    'a spawn asked outside any run is born beside the run going in the parent, and a spawn from another run refuses',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld();
      yield* world.going('run-parent');
      const born = yield* (yield* world.verbs).spawn({ requestId: 'call-1', agentId: 'tagma', task: TASK });
      expect(world.child(born.threadId)).toMatchObject({ parentThreadId: 'parent', spawnedByRunId: null });
      const stale = yield* Effect.flip(world.spawnFrom(runRow('run-earlier'), { requestId: 'call-2', step: 1 }));
      expect(threadCauseOf(stale)).toMatchObject({ _tag: 'BirthConflict', reason: 'run-conflict' });
      expect(world.children().map((child) => child.id)).toEqual([born.threadId]);
    }),
  );
  it.effect(
    'a host that declines the binding refuses the birth whole',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld({
        onThreadBorn: (input) => (input.host ? new ThreadCallBroke({ cause: new WorkspaceForeign({ id: input.host.id }) }) : Effect.void),
      });
      expect(threadCauseOf(yield* world.refuse({ requestId: 'call-1', host: WORKSPACE }))).toMatchObject({
        _tag: 'WorkspaceForeign',
        id: 'ws-1',
      });
      expect(world.children()).toEqual([]);
      expect(world.provisions()).toEqual([]);
    }),
  );
  it.effect(
    'identical requests racing each other produce one child, and every answer names it',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld({ onThreadBorn: () => Effect.void, pairUnits: true });
      const answers = yield* world.race({ requestId: 'call-1', host: WORKSPACE });
      expect(world.children()).toHaveLength(1);
      const only = world.children()[0]!;
      expect(only).toMatchObject({ hostKind: 'workspace', hostId: 'ws-1' });
      expect(world.provisions()).toEqual([spawnRequestId('parent', 'call-1')]);
      expect(answers).toMatchObject([
        { _tag: 'Success', success: { threadId: only.id } },
        { _tag: 'Success', success: { threadId: only.id } },
      ]);
      expect(world.started()).toEqual([only.id]);
    }),
  );
  it.effect(
    'the same request asked again answers the same child, and different work under it refuses',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld({ onThreadBorn: () => Effect.void });
      const started = yield* world.spawn({ requestId: 'call-1', host: WORKSPACE });
      const again = yield* world.spawn({ requestId: 'call-1', host: WORKSPACE });
      const other = yield* world.refuse({ requestId: 'call-1', host: WORKSPACE, task: 'Do something else entirely' });
      expect(again.threadId).toBe(started.threadId);
      expect(world.children()).toHaveLength(1);
      expect(world.started()).toEqual([started.threadId]);
      expect(planeRefusalOf(other)?.code).toBe('spawn-conflict');
    }),
  );
  it.effect(
    'a preparation that fails after the birth names the child and its request, and the retry runs it',
    Effect.fnUntraced(function* () {
      let prepared = false;
      const world = yield* spawnWorld({
        onThreadBorn: () => Effect.void,
        onThreadReady: () => (prepared ? Effect.void : new ThreadCallBroke({ cause: new Error('the container did not come up') })),
      });
      const refusal = planeRefusalOf(yield* world.refuse({ requestId: 'call-1', host: WORKSPACE }));
      const born = world.children()[0]!;
      expect(refusal?.code).toBe('spawn-not-ready');
      expect(refusal?.reason).toContain(born.id);
      expect(refusal?.reason).toContain(spawnRequestId('parent', 'call-1'));
      expect(world.started()).toEqual([]);
      prepared = true;
      const retried = yield* world.spawn({ requestId: 'call-1', host: WORKSPACE });
      expect(retried.threadId).toBe(born.id);
      expect(world.children()).toHaveLength(1);
      expect(world.started()).toEqual([born.id]);
    }),
  );
  it.effect(
    'the native tool settles a recovered birth through its original task after readiness failed again',
    Effect.fnUntraced(function* () {
      let prepared = false;
      const world = yield* spawnWorld({
        onThreadBorn: () => Effect.void,
        onThreadReady: () => (prepared ? Effect.void : new ThreadCallBroke({ cause: new Error('the container did not come up') })),
      });
      yield* world.refuse({ requestId: 'call-1', name: 'reader', host: WORKSPACE });
      const born = world.children()[0]!;
      yield* world.refuse({ requestId: 'call-2', name: 'reader', host: WORKSPACE });
      prepared = true;
      const settled = yield* world.settle('call-2');
      expect(settled.status).toBe('completed');
      if (settled.status !== 'completed' || !(settled.output instanceof ToolAnswer))
        return yield* Effect.die('The tool did not recover its answer');
      expect(settled.output.value).toMatchObject({ status: 'started', threadId: born.id });
      expect(world.started()).toEqual([born.id]);
      expect(world.provisions()).toEqual([spawnRequestId('parent', 'call-1')]);
    }),
  );
});
describe('a spawn takes its seat as the limit is judged', () => {
  it.effect(
    'spawns racing for the last seats leave exactly the free ones taken',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld({ spawnSlots: 2 });
      const answers = yield* world.raceAll([1, 2, 3].map((n) => ({ requestId: `call-${n}` })));
      expect(answers.filter((answer) => answer._tag === 'Success')).toHaveLength(2);
      expect(answers.flatMap((answer) => (answer._tag === 'Failure' ? [planeRefusalOf(answer.failure)?.code] : []))).toEqual([
        'spawn-slots-full',
      ]);
      expect(world.resident()).toBe(2);
      expect(world.children()).toHaveLength(2);
    }),
  );
});
describe('a birth records the run and step that issued it', () => {
  it.effect(
    'spawns made in one step share one act, and the next step is another',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld();
      const run = runRow('run-parent');
      const first = yield* world.spawnFrom(run, { requestId: 'call-1', step: 3 });
      const second = yield* world.spawnFrom(run, { requestId: 'call-2', step: 3 });
      const later = yield* world.spawnFrom(run, { requestId: 'call-3', step: 4 });
      expect(world.child(first.threadId)?.bornOf).toEqual({ by: 'run-parent', step: 3 });
      expect(world.child(second.threadId)?.bornOf).toEqual({ by: 'run-parent', step: 3 });
      expect(world.child(later.threadId)?.bornOf).toEqual({ by: 'run-parent', step: 4 });
    }),
  );
  it.effect(
    'a replayed request answers the first birth and keeps its act',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld();
      const run = runRow('run-parent');
      const born = yield* world.spawnFrom(run, { requestId: 'call-1', step: 3 });
      const replayed = yield* world.spawnFrom(run, { requestId: 'call-1', step: 9 });
      expect(replayed.threadId).toBe(born.threadId);
      expect(world.child(born.threadId)?.bornOf).toEqual({ by: 'run-parent', step: 3 });
    }),
  );
  it.effect(
    'a child the host starts outside any run is born of no act',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld();
      const started = yield* world.spawn({ requestId: 'call-1' });
      expect(world.child(started.threadId)?.bornOf).toBeNull();
    }),
  );
});
describe('a spawn is started as the type its host answers for', () => {
  it.effect(
    'a type the host does not answer for refuses naming what it does offer, and nothing is born',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld();
      const refusal = threadCauseOf(yield* world.refuse({ requestId: 'call-1', type: 'reviewer' }));
      expect(refusal).toBeInstanceOf(AgentProfileUnknownError);
      expect(refusal).toMatchObject({ typeId: 'reviewer', offered: ['tagma', 'reader'] });
      expect(world.children()).toEqual([]);
    }),
  );
  it.effect(
    'a declared spawn answers its own type and retains its execution base across replay',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld();
      const born = yield* world.spawn({ requestId: 'call-1', type: 'reader' });
      expect(born.agentId).toBe('reader');
      expect(world.child(born.threadId)).toMatchObject({ agentId: 'tagma', profile: { id: 'reader', overlay: READER } });
      expect(yield* world.spawn({ requestId: 'call-1', type: 'reader' })).toMatchObject({
        threadId: born.threadId,
        agentId: 'reader',
      });
    }),
  );
});
it.effect(
  'a child whose profile changes provider without naming a model takes that provider default',
  Effect.fnUntraced(function* () {
    for (const model of [undefined, null]) {
      const world = yield* spawnWorld({
        parent: { provider: 'openai-oauth', model: 'gpt-6.1-sol', reasoning: 'high' },
        profile: { ...READER, model: { provider: 'subscription', model, reasoning: 'low' } },
      });
      const born = yield* world.spawn({ requestId: 'call-1', type: 'reader' });
      expect(world.child(born.threadId)).toMatchObject({
        provider: 'subscription',
        model: shipped.defaultTextModelId('subscription'),
        reasoning: 'low',
      });
    }
  }),
);
describe('a child is born with the switches of its model', () => {
  const [fast, other] = shipped.options.filter(
    (option) =>
      !option.operatorOnly && option.provider === 'openai-oauth' && option.switches.some((declared) => declared.id === 'serviceTier'),
  );
  const onFast = { provider: fast!.provider, model: fast!.id };
  const onOther = { provider: other!.provider, model: other!.id };
  const parent = { ...onFast, reasoning: fast!.defaultReasoning };
  it.effect(
    'a child carries parent switches on the same model and standing switches on another',
    Effect.fnUntraced(function* () {
      const asked: string[] = [];
      const world = yield* spawnWorld({
        parent: { ...parent, switches: { serviceTier: 'priority' } },
        standingSwitches: (input) =>
          Effect.sync((): Record<string, string> => {
            asked.push(input.model);
            return input.model === other!.id ? { serviceTier: 'priority' } : {};
          }),
      });
      const same = yield* world.spawn({ requestId: 'call-1', model: onFast });
      const moved = yield* world.spawn({ requestId: 'call-2', model: onOther });
      expect(world.child(same.threadId)?.switches).toEqual({ serviceTier: 'priority' });
      expect(world.child(moved.threadId)?.switches).toEqual({ serviceTier: 'priority' });
      expect(asked).toEqual([other!.id]);
    }),
  );
  it.effect(
    'a named switch replaces the inherited value and an unoffered switch refuses',
    Effect.fnUntraced(function* () {
      const world = yield* spawnWorld({
        parent: { ...parent, switches: { serviceTier: 'priority' } },
        standingSwitches: () => Effect.succeed({ serviceTier: 'priority' }),
      });
      const standard = yield* world.spawn({ requestId: 'call-1', model: onFast, switches: { serviceTier: 'standard' } });
      const refused = yield* world.refuse({ requestId: 'call-2', model: onFast, switches: { reasoningDisplay: 'summarized' } });
      expect(world.child(standard.threadId)?.switches).toEqual({ serviceTier: 'standard' });
      expect(planeRefusalOf(refused)?.code).toBe('switch-unoffered');
    }),
  );
});
type SpawnAsk = {
  readonly requestId: string;
  readonly task?: string;
  readonly host?: ThreadHostBinding;
  readonly fork?: 'all';
  readonly name?: string;
  readonly type?: string;
  readonly model?: {
    readonly provider: string;
    readonly model: string;
  };
  readonly switches?: Record<string, string>;
};
const spawnWorld = Effect.fnUntraced(function* (
  options: {
    readonly parent?: Partial<ThreadMetadataRow>;
    readonly profile?: AgentProfile;
    readonly pairUnits?: true;
    readonly onThreadBorn?: (input: ThreadBirth, tx: MemoryTx) => Effect.Effect<void, ThreadBorderFailed>;
    readonly onThreadReady?: NonNullable<ThreadHost['readiness']>['ready'];
    readonly standingSwitches?: NonNullable<ThreadHost['standingSwitches']>['of'];
    readonly spawnSlots?: number;
  } = {},
) {
  const memory = new ThreadMemory(makeThreadEntryReader({ products: [] }));
  const rows = makeMemoryRows({ memory });
  yield* rows.insert({
    id: 'parent',
    ownerId: 'owner-1',
    agentId: 'tagma',
    provider: ordinary.provider,
    model: ordinary.id,
    reasoning: ordinary.defaultReasoning,
  });
  const held = memory.held('parent');
  if (!held) return yield* Effect.die('Expected the parent');
  held.row = { ...held.row, ...options.parent };
  const parent = held.row;
  const paired = yield* Deferred.make<void>();
  let arrived = 0;
  const transaction = rows.transaction.bind(rows);
  rows.transaction = (work) =>
    Effect.suspend(() => {
      if (++arrived >= 2) Deferred.doneUnsafe(paired, Effect.void);
      return Effect.andThen(options.pairUnits ? Deferred.await(paired) : Effect.void, transaction(work));
    });
  const inbox = inMemoryInboxStorage({ units: memory.units, calls: memory.records });
  const runStore = makeMemoryRuns({ memory, ownerId: parent.ownerId, scope: null });
  const started: string[] = [];
  const storage = threadStorageLayer({
    storage: rows,
    eventLog: makeMemoryEvents({ memory }),
    transitions: inMemoryThreadTransitions({ memory }),
    createRuns: (owner) => makeMemoryRuns({ memory, ownerId: owner, scope: null }),
    inbox,
    ownerSettings: makeMemoryOwnerSettings({ memory }),
    attachments: { keep: unused, hydrate: unused, resolve: unused, addressed: unused, sizes: unused },
    toolOutputs: { scope: () => ({ ...emptyToolOutputs, commitReferenced: unused }), settleOpen: unused },
  });
  const agents = yield* makeAgentRegistry<MemoryTx>();
  const agent: ThreadAgent<MemoryTx> = {
    id: 'tagma',
    name: 'Fixture agent',
    description: '',
    runPolicy: { userStartable: false, backgroundStartable: false },
    grant: { sources: [{ source: 'collaboration', narrowable: true }] },
    prepare: unused,
    instructions: unused,
    toolCatalog: unused,
    toolDoor: unused,
  };
  yield* agents.hold(agent, 'spawn-birth-tests');
  function admit<I extends RunInput>(thread: RunSubject<I>, input: I): Effect.Effect<RunAdmitted[I['kind']], ThreadBorderFailed>;
  function admit(thread: ThreadMetadataRow, input: RunInput): Effect.Effect<RunAdmitted[RunInput['kind']], ThreadBorderFailed> {
    return Effect.suspend(() => {
      if (input.kind !== 'begin') return Effect.die(`Births do not admit ${input.kind}`);
      return Effect.gen(function* () {
        const opened = yield* runStore.createRun({
          startFrom: thread,
          kind: 'turn',
          approval: { mode: 'trust', interactive: false },
          progress: { stage: 'running', message: null },
          startKey: input.start?.startKey,
          runId: `run-${thread.id}`,
        });
        if (opened._tag === 'Started') started.push(thread.id);
        if (input.start) yield* inbox.deliver([input.start.itemId], opened.run.id);
        return { runId: opened.run.id, acted: opened._tag === 'Started' };
      });
    });
  }
  const given = Layer.mergeAll(
    storage,
    threadAgentsLayer(agents),
    threadChangesLayer,
    runAdmissionLayer,
    threadHostLayer<MemoryTx>({
      ownerId: parent.ownerId,
      rhythms: {
        lease: { heartbeatIntervalMs: 100, staleRunningAfterMs: 500, takeoverAfterMs: 1_000 },
        reaper: { staleSweepIntervalMs: 100, recoveryBatch: 1, resumeWithinMs: 100, resumeAttemptLimit: 1 },
        settlement: { settledClaimAfterMs: 100, settledHeartbeatIntervalMs: 10, settledNotificationBatch: 1, settledNotifyAttemptLimit: 1 },
        streamFlushIntervalMs: 10,
      },
      births: options.onThreadBorn ? { record: options.onThreadBorn } : undefined,
      readiness: options.onThreadReady ? { ready: options.onThreadReady } : undefined,
      standingSwitches: options.standingSwitches ? { of: options.standingSwitches } : undefined,
    }),
    Layer.succeed(
      DeclaredCollaboration,
      DeclaredCollaboration.of({
        models: () => shipped,
        subAgentDepth: () => Effect.succeed(2),
        delegation: () => Effect.succeed({ allowed: true, setAt: null }),
        reconcileIntervalMs: 30_000,
        spawnSlots: options.spawnSlots,
      }),
    ),
    Layer.succeed(
      ThreadTypes,
      ThreadTypes.of({
        resolve: ({ typeId }) =>
          Effect.succeed(
            typeId === 'tagma'
              ? { baseAgentId: 'tagma', harness: 'native', capabilities: NATIVE_CAPABILITIES }
              : typeId === 'reader'
                ? { baseAgentId: 'tagma', profile: options.profile ?? READER, harness: 'native', capabilities: NATIVE_CAPABILITIES }
                : null,
          ),
        offered: () =>
          Effect.succeed([
            { id: 'tagma', name: 'tagma', description: 'Fixture agent', baseAgentId: 'tagma' },
            { id: 'reader', name: 'reader', description: READER.description, baseAgentId: 'tagma' },
          ]),
      }),
    ),
    Layer.succeed(ThreadDirectory, ThreadDirectory.of({ access: () => ({ list: unused }), warmth: unused })),
    Layer.succeed(
      ThreadEnvelopes,
      ThreadEnvelopes.of({
        deliver: unused,
        completeRun: unused,
        withdrawRequest: unused,
        access: () => ({ send: unused, recipients: unused, sendAhead: unused, settle: unused, waitFor: unused, collect: unused }),
      }),
    ),
    Layer.succeed(
      ContextCompaction,
      ContextCompaction.of({ choosesSummarizer: false, summarizer: unused, compact: unused, compactAhead: unused }),
    ),
    Layer.succeed(ThreadModel, ThreadModel.of({ move: unused, adapted: unused })),
    Layer.succeed(ThreadBranch, ThreadBranch.of({ fork: unused })),
    Layer.succeed(ThreadRewind, ThreadRewind.of({ rewind: unused, restore: unused, preview: unused, points: unused, draft: unused })),
    Layer.succeed(
      ThreadBudget,
      ThreadBudget.of({
        of: () => Effect.as(Effect.yieldNow, { allowed: null, spent: 0, remaining: null, unmeasuredCount: 0, unmeasuredSample: [] }),
      }),
    ),
    Layer.succeed(ThreadSpawnAccess, ThreadSpawnAccess.of({ depth: () => Effect.succeed({ current: 0, maximum: 2, remaining: 2 }) })),
    Layer.succeed(
      ThreadSnapshots,
      ThreadSnapshots.of({
        readCut: unused,
        publish: () => Effect.void,
        state: unused,
        snapshot: unused,
        attachFrom: unused,
        page: unused,
        text: unused,
        statuses: unused,
        committed: unused,
        forget: unused,
      }),
    ),
    Layer.succeed(
      RunScheduler,
      RunScheduler.of({ admit, resume: unused, adopt: unused, withdraw: unused, queued: unused, launchBlocked: unusedSync }),
    ),
    Layer.succeed(ThreadStopping, ThreadStopping.of({ stop: unused, byReader: unused, release: unused })),
  );
  const context = yield* Layer.build(
    threadPlanesLayer.pipe(
      Layer.provideMerge(threadSpawnTreeLayer),
      Layer.provideMerge(Layer.mergeAll(nativeThreadsLayer, nativeThreadRunsLayer, spawnSeatsLayer)),
      Layer.provideMerge(threadRunLedgerLayer),
      Layer.provideMerge(given),
    ),
  );
  const threads = Context.get(context, Threads);
  const tree = Context.get(context, ThreadSpawnTree);
  const planes = Context.get(context, ThreadPlanes);
  const parentRecord = Effect.flatMap(threads.find(parent.id, parent.ownerId), (found) =>
    found ? Effect.succeed(found) : Effect.die('The parent is not addressable'),
  );
  const spawn = (input: SpawnAsk) =>
    Effect.flatMap(parentRecord, (parent) =>
      tree.spawn({
        parent,
        requestId: input.requestId,
        agentId: input.type ?? 'tagma',
        task: input.task ?? TASK,
        name: input.name,
        host: input.host,
        fork: input.fork ? { kind: 'all' } : undefined,
        model: input.model,
        switches: input.switches,
      }),
    );
  const spawnFrom = Effect.fnUntraced(function* (
    run: ThreadRunRow,
    input: SpawnAsk & {
      readonly step: number;
    },
  ) {
    const parent = yield* parentRecord;
    const access = yield* planes.access(parent);
    if (!access) return yield* Effect.die('The plane was not declared');
    const acting = yield* access.acting({
      agentId: parent.agentId,
      ownerId: parent.principal,
      thread: { threadId: parent.id, runId: run.id, bindings: {} },
    });
    return yield* acting.spawn({
      requestId: input.requestId,
      step: input.step,
      agentId: input.type ?? 'tagma',
      task: input.task ?? TASK,
      model: { provider: ordinary.provider, model: ordinary.id },
    });
  });
  return {
    spawn,
    spawnFrom,
    settle: Effect.fnUntraced(function* (requestId: string) {
      const parent = yield* parentRecord;
      const access = yield* planes.access(parent);
      if (access === null) return yield* Effect.die('The plane was not declared');
      const tool = collaborationTools(access).spawn_agent!;
      const settled = toolSettleEffect(tool, {
        toolCallId: requestId,
        toolInput: { agentId: 'tagma', task: TASK, name: 'reader', host: WORKSPACE },
        caller: { agentId: parent.agentId, ownerId: parent.principal, thread: { threadId: parent.id, runId: 'run-parent', bindings: {} } },
      });
      if (settled === null) return yield* Effect.die('A spawn settles its recorded birth');
      return yield* settled;
    }),
    going: (runId: string) =>
      runStore.createRun({
        startFrom: parent,
        kind: 'turn',
        approval: { mode: 'trust', interactive: false },
        progress: { stage: 'running', message: null },
        runId,
      }),
    verbs: Effect.flatMap(parentRecord, (parent) => {
      const verbs = planes.verbs(parent);
      return verbs ? Effect.succeed(verbs) : Effect.die('The plane was not declared');
    }),
    refuse: (input: SpawnAsk) => Effect.flip(spawn(input)),
    race: (input: SpawnAsk) => Effect.all([Effect.result(spawn(input)), Effect.result(spawn(input))], { concurrency: 2 }),
    raceAll: (inputs: readonly SpawnAsk[]) => Effect.forEach(inputs, (input) => Effect.result(spawn(input)), { concurrency: 3 }),
    resident: Context.get(context, SpawnSeats).resident,
    children: () => [...memory.threads.values()].map((held) => held.row).filter((row) => row.parentThreadId !== null),
    child: (id: string) => memory.held(id)?.row,
    provisions: () => [...inbox.items.keys()],
    started: () => started,
  };
});
