import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { Message, ToolCallPart, ToolResultPart } from '@runlith/llm/schema/messages';
import { approvalModesLayer } from '../../modes/ApprovalModes';
import { Agent } from '../../agent/Agent';
import type { AgentRunner } from '../../agent/AgentRunner';
import { makeAgentCalls } from '../../agent/AgentCalls';
import { stepLimit } from '../../agent/AgentStep';
import { SUB_AGENT_DEPTH } from '../../collaboration/CollaborationConfig';
import { ThreadEntryKinds, makeThreadEntryReader } from '../../transcript/kinds';
import { signalEntryId } from '../../transcript/entryNames';
import type { ThreadCompactionEntry, ThreadQuestionEntry } from '../../transcript/entries';
import { THREAD_TOOL_CONFIRM_KIND } from '../../transcript/parts';
import { NATIVE_BINDING, NATIVE_CAPABILITIES } from '../record';
import type { ThreadBirthCarried, ThreadRow } from '../rows';
import type { ThreadState } from '../state';
import type { ThreadAttachmentStorage } from '../attachmentStorage';
import type { ThreadToolOutputScope, ThreadToolOutputStorage } from '../toolOutputs';
import { threadKernelLayer } from '../AgentHarness';
import { threadAgentsLayer, threadCompactorLayer, threadFeaturesLayer, threadKernelPorts, threadStorageLayer } from '../kernelPorts';
import { registeredAgents } from '../conformance/agents';
import { threadAgent } from '../agents/ThreadAgent';
import { ThreadCallBroke, type ThreadBorderFailed, type ThreadPortFailure, threadCauseOf } from '../ThreadBorder';
import { threadHostLayer } from '../ThreadPorts';
import { threadSpokenMessageEvent } from '../events';
import type { ThreadAggregateStorage, ThreadInsertValues } from '../storage/aggregate';
import { ThreadDeleteConflictError } from '../storage/aggregate';
import type { ThreadInboxItemValues } from '../storage/inbox';
import { ThreadRunConflictError, type ThreadRunStorage } from '../storage/runs';
import { inMemoryInboxStorage } from '../storage/InMemoryInboxStorage';
import { ThreadMemory } from '../storage/memory/state';
import type { MemoryTx } from '../storage/memory/units';
import { makeMemoryRows } from '../storage/memory/ThreadRows';
import { makeMemoryRuns } from '../storage/memory/ThreadRuns';
import { makeMemoryEvents } from '../storage/memory/ThreadEvents';
import { inMemoryThreadTransitions } from '../storage/memory/ThreadTransitions';
import { makeMemoryCompaction } from '../storage/memory/ThreadCompaction';
import { makeMemoryResources } from '../storage/memory/ThreadResources';
import { makeMemoryOwnerSettings } from '../storage/memory/OwnerSettings';
import type { ThreadCompactionSettlement } from '../compaction/settlement';
import type { ThreadCompactionPolicy } from '../compaction/policy';
import { makeThreadSummaryStrategy } from '../compaction/summaryStrategy';
import { makeThreadDigestStrategy } from '../compaction/digestStrategy';
import type { CompactionModels } from '../compaction/CompactionModels';
import { ThreadAggregate, ThreadContextAttachError } from './ThreadAggregate';
import { ThreadBranch } from './ThreadBranch';
import { makeThreadCompaction } from './ThreadCompaction';
import { ThreadCompactionRuns } from './ThreadCompactionRuns';
import { makeThreadLiveFeed, threadFeedLayer } from './ThreadLiveFeed';
import { ThreadRunSettlements } from './ThreadRunSettlements';
import type { ThreadRunSettled } from './ThreadRunLedger';
const ROOT = 'thread-1';
const OWNER = 'owner-1';
const AT = '2026-06-26T10:00:00.000Z';
const unused = () => Effect.die(new Error('This aggregate contract does not drive the collaborator.'));
const kernelOver = Effect.fnUntraced(function* (
  options: {
    row?: Partial<ThreadInsertValues>;
    beforeDeleteLock?: (store: ThreadAggregateStorage<MemoryTx>, tx: MemoryTx) => Effect.Effect<void, ThreadPortFailure>;
    onThreadBorn?: (
      input: {
        child: ThreadRow;
        parent: ThreadRow;
        carried: ThreadBirthCarried;
      },
      tx: MemoryTx,
    ) => Effect.Effect<void, ThreadBorderFailed>;
    onThreadReady?: (thread: ThreadRow) => Effect.Effect<void, ThreadBorderFailed>;
    movesUnderEveryRead?: true;
  } = {},
) {
  const memory = new ThreadMemory(makeThreadEntryReader({ products: [] }));
  const store = makeMemoryRows({ memory });
  const events = makeMemoryEvents({ memory });
  const runs = makeMemoryRuns({ memory, ownerId: 'test-runtime', scope: null });
  const resources = makeMemoryResources({ memory });
  const checkpoints = makeMemoryCompaction({ memory });
  const inbox = inMemoryInboxStorage({ units: memory.units, calls: memory.records });
  memory.onRemoval((gone, tx) => inbox.forget(gone, tx));
  yield* store.insert({
    id: ROOT,
    ownerId: OWNER,
    agentId: 'agent-1',
    provider: 'anthropic',
    transport: NATIVE_BINDING,
    capabilities: NATIVE_CAPABILITIES,
    ...options.row,
  });
  const beforeLock = options.beforeDeleteLock;
  if (beforeLock) {
    const transaction = store.transaction.bind(store);
    store.transaction = <A, E>(work: (tx: MemoryTx) => Effect.Effect<A, E>) =>
      Effect.andThen(
        memory.units.commit((tx) => beforeLock(store, tx)),
        () => transaction(work),
      );
  }
  const runner: AgentRunner = {
    calls: yield* makeAgentCalls({ history: 1 }),
    run: unused,
    host: unused,
  };
  const agents = yield* registeredAgents(
    [
      threadAgent<Record<string, never>>({
        agent: new Agent<Record<string, never>>({
          id: 'agent-1',
          name: 'agent-1',
          description: 'Aggregate contract agent.',
          instructions: () => 'Answer.',
          tools: () => ({}),
          stopWhen: [stepLimit(1)],
        }),
        runner,
        runPolicy: { userStartable: true, backgroundStartable: false },
        context: () => Effect.succeed({}),
      }),
    ],
    'test',
  );
  const live = yield* makeThreadLiveFeed<ThreadState>();
  const released: string[] = [];
  const transitions = inMemoryThreadTransitions({ memory });
  let moves = 0;
  const written = (threadId: string) =>
    memory.units.commit((tx) =>
      events.append(
        {
          threadId,
          id: `moved-${++moves}`,
          kind: 'message',
          payload: { entry: { type: 'message', id: `said-${moves}`, role: 'assistant', text: `still writing ${moves}` } },
        },
        tx,
      ),
    );
  const ports = threadKernelPorts(
    Layer.mergeAll(
      approvalModesLayer,
      threadStorageLayer({
        storage: store,
        eventLog: events,
        transitions: options.movesUnderEveryRead
          ? {
              ...transitions,
              readAt: (threadId, work, tx) =>
                tx === undefined
                  ? Effect.tap(transitions.readAt(threadId, work), () => written(threadId))
                  : transitions.readAt(threadId, work, tx),
            }
          : transitions,
        createRuns: () => runs,
        attachments,
        inbox,
        toolOutputs,
        ownerSettings: makeMemoryOwnerSettings({ memory }),
      }),
      threadFeaturesLayer({
        resources: {
          storage: resources,
          kinds: [
            {
              kind: 'held',
              release: (row) =>
                Effect.sync(() => {
                  released.push(row.id);
                }),
              describe: (row) => ({ kind: row.kind, id: row.id, detail: row.id, heldAt: row.heldAt.toISOString() }),
            },
          ],
        },
        collaboration: {
          models: () => modelCatalog([]),
          subAgentDepth: () => Effect.succeed(SUB_AGENT_DEPTH.default),
          delegation: () => Effect.succeed({ allowed: true, setAt: null }),
          reconcileIntervalMs: 1_000,
        },
      }),
      threadAgentsLayer(agents),
      ThreadEntryKinds.layer([]),
      threadCompactorLayer(
        makeThreadCompaction({
          models,
          checkpoints,
          policy: () => Effect.succeed(policy),
          strategy: makeThreadSummaryStrategy({ models, prompt: { instructions: 'Summarize.', template: 'State' } }),
          recovery: makeThreadDigestStrategy(),
          text: {
            checkpointMarker: 'Anchored state.',
            prunedToolOutput: 'Pruned.',
            overflowMediaGuidance: 'Media omitted.',
            omittedMedia: (mediaType) => `Omitted ${mediaType ?? 'media'}.`,
          },
        }),
      ),
      threadHostLayer({
        ownerId: 'test-runtime',
        rhythms: {
          lease: { heartbeatIntervalMs: 30_000, staleRunningAfterMs: 30_000, takeoverAfterMs: 0 },
          reaper: { staleSweepIntervalMs: 30_000, recoveryBatch: 1, resumeWithinMs: 20 * 60_000, resumeAttemptLimit: 1 },
          settlement: {
            settledClaimAfterMs: 30_000,
            settledHeartbeatIntervalMs: 30_000,
            settledNotificationBatch: 1,
            settledNotifyAttemptLimit: 1,
          },
          streamFlushIntervalMs: 0,
        },
        births: options.onThreadBorn ? { record: options.onThreadBorn } : undefined,
        readiness: options.onThreadReady ? { ready: options.onThreadReady } : undefined,
      }),
    ),
  );
  const context = yield* Layer.build(
    threadKernelLayer(
      Layer.merge(
        ports,
        threadFeedLayer(live, (state: ThreadState) => Effect.succeed(state)),
      ),
    ),
  );
  const aggregate = Context.get(context, ThreadAggregate);
  const branch = Context.get(context, ThreadBranch);
  const settlements = Context.get(context, ThreadRunSettlements);
  const compaction = Context.get(context, ThreadCompactionRuns);
  const start = Effect.fnUntraced(function* (id = 'run-1', kind: 'turn' | 'compaction' = 'turn') {
    const row = yield* store.find(ROOT);
    if (!row) return yield* Effect.die('The source thread is absent.');
    return yield* runs.createRun({
      runId: id,
      startFrom: row,
      kind,
      approval: { mode: 'trust', interactive: true },
      progress: { stage: null, message: null },
    });
  });
  return {
    aggregate,
    branch,
    compaction,
    store,
    runs,
    inbox,
    resources,
    released,
    checkpoints,
    events,
    live,
    start,
    send: (
      text: string,
      refs?: readonly {
        id: string;
      }[],
    ) => Effect.flatMap(aggregate.owned(ROOT, OWNER), (row) => aggregate.send(row, text, refs)),
    queue: (text: string) => Effect.flatMap(aggregate.owned(ROOT, OWNER), (row) => aggregate.queue(row, text)),
    snapshot: () => aggregate.snapshot(ROOT),
    duplicate: (input: Parameters<typeof branch.fork>[0]) =>
      Effect.flatMap(branch.fork(input), (answer) => ('born' in answer ? Effect.succeed(answer.born) : Effect.die(answer.settled))),
    handleRunSettled: (status: ThreadRunSettled['status'], runId = 'run-1', stoppedBy: ThreadRunSettled['stoppedBy'] = null) =>
      settlements.publish(
        { runId, threadId: ROOT, kind: 'turn', status, stoppedBy, failureReason: null, failure: null },
        { delivered: [], entering: () => Effect.void, done: () => Effect.void },
      ),
  };
});
function queuedWords(): ThreadInboxItemValues {
  return {
    id: 'words-1',
    threadId: ROOT,
    sender: { kind: 'reader' },
    kind: 'turn',
    body: { text: 'and check the second file too' },
    occurredAt: AT,
  };
}
function confirmQuestion(runId: string, toolCallId: string): ThreadQuestionEntry {
  return {
    type: 'question',
    id: `question:${runId}:${toolCallId}`,
    runId,
    questionId: toolCallId,
    questions: [
      {
        id: toolCallId,
        toolCallId,
        kind: THREAD_TOOL_CONFIRM_KIND,
        prompt: 'Allow side_effect?',
        options: [
          { value: 'confirm', label: 'Allow' },
          { value: 'cancel', label: 'Cancel' },
        ],
      },
    ],
    toolCalls: [{ toolCallId, toolName: 'side_effect' }],
    status: 'open',
    occurredAt: AT,
  };
}
const forkInput = { ownerId: OWNER, sourceThreadId: ROOT, cut: { kind: 'none' as const } };
const stopped = (runs: ThreadRunStorage<MemoryTx>) =>
  runs.settleRun('run-1', {
    status: 'aborted',
    progress: { stage: null, message: null },
    finishedAt: new Date(AT),
    heartbeatAt: new Date(AT),
  });
describe('ThreadAggregate over the composed graph', () => {
  it.effect(
    'invalid attached context is a typed refusal and leaves the journal unchanged',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      for (const input of [
        { title: ' ', text: 'body' },
        { title: 'x'.repeat(201), text: 'body' },
        { title: 'title', text: ' ' },
      ]) {
        const failure = yield* Effect.flip(h.aggregate.attachContext(ROOT, OWNER, input));
        expect(threadCauseOf(failure)).toBeInstanceOf(ThreadContextAttachError);
      }
      expect(yield* h.events.headPosition(ROOT)).toBe(0);
    }),
  );
  it.effect(
    'a late follow-up leaves queued input standing for the run that won',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      yield* h.inbox.put(queuedWords());
      yield* h.inbox.put({
        id: 'signal-1',
        threadId: ROOT,
        sender: { kind: 'host' },
        kind: 'signal',
        body: { type: 'agent-message', addressee: 'transport', text: 'the upstream job finished' },
        occurredAt: AT,
      });
      yield* h.start('run-2');
      yield* h.handleRunSettled('completed');
      expect(yield* h.inbox.receipt('words-1')).toMatchObject({ state: 'queued', deliveredToRunId: null });
      expect(yield* h.inbox.receipt('signal-1')).toMatchObject({ state: 'queued', deliveredToRunId: null });
      expect((yield* h.runs.runningOf([ROOT])).map((row) => row.id)).toEqual(['run-2']);
    }),
  );
  it.effect(
    'the snapshot exposes unread envelopes and removes them after delivery',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      yield* h.inbox.put({
        id: 'envelope-1',
        threadId: ROOT,
        sender: { kind: 'thread', threadId: 'thread-reviewer', name: 'reviewer' },
        kind: 'envelope',
        body: { intent: 'message', text: 'look at this before you commit', inReplyTo: null },
        occurredAt: '2026-06-26T10:05:00.000Z',
      });
      yield* h.inbox.put(queuedWords());
      const waiting = yield* h.snapshot();
      expect(waiting.pendingInput.arrived).toMatchObject([
        {
          type: 'signal',
          id: signalEntryId('envelope-1'),
          title: 'reviewer',
          signalType: 'message',
          text: 'look at this before you commit',
          occurredAt: '2026-06-26T10:05:00.000Z',
        },
      ]);
      expect(waiting.pendingInput.arrived?.[0]?.runId).toBeUndefined();
      expect(waiting.pendingInput.queued).toEqual([]);
      yield* h.inbox.deliver(['envelope-1'], 'run-1');
      expect((yield* h.snapshot()).pendingInput.arrived).toEqual([]);
    }),
  );
  it.effect(
    'a stopped run still answers for turns it left waiting',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      yield* h.inbox.put(queuedWords());
      yield* h.start();
      yield* stopped(h.runs);
      const waiting = yield* h.snapshot();
      expect(waiting.activeRun).toBeNull();
      expect(waiting.pendingInput.queued).toEqual([
        { id: 'words-1', runId: 'run-1', text: 'and check the second file too', occurredAt: AT },
      ]);
    }),
  );
  it.effect(
    'a late interrupted settlement preserves requests for the successor',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      yield* h.inbox.put(queuedWords());
      for (const [id, intent] of [
        ['envelope:spawn', 'task'],
        ['envelope:reason', 'interrupt'],
      ] as const) {
        yield* h.inbox.put({
          id,
          threadId: ROOT,
          sender: { kind: 'host' },
          kind: 'task',
          body: { intent, text: id, inReplyTo: null },
          occurredAt: AT,
        });
        yield* h.inbox.deliver([id], 'run-1');
      }
      yield* h.start('run-2');
      yield* h.handleRunSettled('aborted', 'run-1', 'agent');
      expect(yield* h.inbox.receipt('words-1')).toMatchObject({ state: 'queued', deliveredToRunId: null });
      expect(yield* h.inbox.receipt('envelope:spawn')).toMatchObject({ state: 'delivered', deliveredToRunId: 'run-1' });
      expect(yield* h.inbox.receipt('envelope:reason')).toMatchObject({ state: 'delivered', deliveredToRunId: 'run-1' });
    }),
  );
  it.effect(
    'a late settlement leaves another run’s question standing and closes its own',
    Effect.fnUntraced(function* () {
      const question = confirmQuestion('run-2', 'call-2');
      const h = yield* kernelOver({ row: { pendingInteraction: question } });
      yield* h.handleRunSettled('aborted');
      expect((yield* h.store.find(ROOT))?.pendingInteraction).toEqual(question);
      expect(yield* h.events.eventsAfter(ROOT, 0, 3)).toEqual([]);
      yield* h.handleRunSettled('aborted', 'run-2');
      expect((yield* h.store.find(ROOT))?.pendingInteraction).toBeNull();
      expect((yield* h.events.eventsAfter(ROOT, 0, 3)).map((row) => row.kind)).toEqual(['tool', 'question']);
    }),
  );
  it.effect(
    'a cut opens no follow-up and leaves queued words for the person',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      yield* h.inbox.put(queuedWords());
      yield* h.handleRunSettled('cut');
      expect(yield* h.inbox.receipt('words-1')).toMatchObject({ state: 'queued', deliveredToRunId: null });
      expect(yield* h.runs.runsOf(ROOT)).toEqual([]);
    }),
  );
  it.effect(
    'words sent during an agent run stand in its steers',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      yield* h.start();
      expect(yield* h.send('and check the second file too')).toMatchObject({ status: 'steered', runId: 'run-1' });
      const waiting = yield* h.snapshot();
      expect(waiting.pendingInput.steers.map((row) => row.text)).toEqual(['and check the second file too']);
      expect(waiting.pendingInput.queued).toEqual([]);
    }),
  );
  it.effect(
    'a picture without words waits for its own turn',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      yield* h.start();
      expect(yield* h.send('   ', [{ id: 'shot-1' }])).toMatchObject({ status: 'queued', runId: 'run-1' });
      const waiting = yield* h.snapshot();
      expect(waiting.pendingInput.queued).toMatchObject([{ text: '', attachments: [{ id: 'shot-1' }] }]);
      expect(waiting.pendingInput.steers).toEqual([]);
    }),
  );
  it.effect(
    'words sent during manual compaction wait for the following turn',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      yield* h.start('run-compact', 'compaction');
      expect(yield* h.send('and check the second file too')).toMatchObject({ status: 'queued', runId: 'run-compact' });
      const waiting = yield* h.snapshot();
      expect(waiting.pendingInput.queued.map((row) => row.text)).toEqual(['and check the second file too']);
      expect(waiting.pendingInput.steers).toEqual([]);
    }),
  );
  it.effect(
    'queue holds words behind a run that could have read them',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      yield* h.start();
      expect(yield* h.queue('and then write the note')).toMatchObject({ status: 'queued', runId: 'run-1' });
      const waiting = yield* h.snapshot();
      expect(waiting.pendingInput.queued.map((row) => row.text)).toEqual(['and then write the note']);
      expect(waiting.pendingInput.steers).toEqual([]);
    }),
  );
  it.effect(
    'an unregistered agent is refused before admitting any run or words',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver({ row: { agentId: 'withdrawn' } });
      const absent = { _tag: 'RegistryAbsent', registry: 'agent', id: 'withdrawn' };
      for (const attempt of [h.aggregate.begin(ROOT, OWNER, 'start'), h.send('and then write the note')]) {
        const refused = yield* Effect.flip(attempt);
        expect(threadCauseOf(refused)).toMatchObject(absent);
      }
      expect(yield* h.runs.runsOf(ROOT)).toEqual([]);
      expect(yield* h.inbox.pending(ROOT)).toEqual([]);
    }),
  );
  it.effect(
    'deletion refuses after two children arrive between its sweep and lock',
    Effect.fnUntraced(function* () {
      let child = 0;
      const h = yield* kernelOver({
        beforeDeleteLock: (store, tx) =>
          Effect.asVoid(store.insertChild(ROOT, { id: `child-${++child}`, ownerId: OWNER, agentId: 'agent-1' }, tx)),
      });
      const refusal = yield* Effect.result(h.aggregate.deleteThread(OWNER, ROOT));
      expect(refusal).toMatchObject({
        _tag: 'Failure',
        failure: {
          _tag: 'ThreadCallBroke',
          cause: {
            _tag: 'ThreadDeleteConflict',
            blockedBy: { kind: 'child', id: 'child-2' },
          },
        },
      });
      if (refusal._tag === 'Failure') expect(threadCauseOf(refusal.failure)).toBeInstanceOf(ThreadDeleteConflictError);
      expect((yield* h.store.listSubtree(OWNER, ROOT)).map((row) => row.id)).toEqual([ROOT, 'child-1', 'child-2']);
    }),
  );
  it.effect(
    'deletion replans for a newly arrived child and releases both threads’ resources',
    Effect.fnUntraced(function* () {
      let arrived = false;
      const h = yield* kernelOver({
        beforeDeleteLock: (store, tx) => {
          if (arrived) return Effect.void;
          arrived = true;
          return Effect.asVoid(store.insertChild(ROOT, { id: 'child-1', ownerId: OWNER, agentId: 'agent-1' }, tx));
        },
      });
      yield* h.resources.hold({ kind: 'held', id: 'held-1', threadId: ROOT });
      expect(yield* h.aggregate.deleteThread(OWNER, ROOT)).toBe(true);
      expect(yield* h.store.listSubtree(OWNER, ROOT)).toEqual([]);
      expect(yield* h.resources.held([ROOT, 'child-1'])).toEqual([]);
      expect(yield* h.resources.detached()).toEqual([]);
      expect(h.released).toEqual(['held-1']);
    }),
  );
  it.effect(
    'keyed append lands once, replays retries and refuses different events',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      const note = [threadSpokenMessageEvent({ role: 'user', text: 'A note.', occurredAt: AT })];
      const call = { actor: 'operator', key: 'note-1' };
      yield* h.aggregate.append(ROOT, OWNER, note, undefined, call);
      yield* h.aggregate.append(ROOT, OWNER, note, undefined, call);
      expect((yield* h.events.eventsAfter(ROOT, 0, 2)).map((row) => row.kind)).toEqual(['message']);
      const other = [threadSpokenMessageEvent({ role: 'user', text: 'Another note.', occurredAt: AT })];
      expect(yield* Effect.result(h.aggregate.append(ROOT, OWNER, other, undefined, call))).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'ThreadActReused' },
      });
      expect((yield* h.store.find(ROOT))?.history).toEqual([Message.user('A note.')]);
    }),
  );
  it.effect(
    'append commits referenced messages, folds the transcript and publishes the committed position',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      const events = [
        threadSpokenMessageEvent({ role: 'user', text: 'What changed?', occurredAt: AT }),
        threadSpokenMessageEvent({ role: 'assistant', text: 'Nothing breaks.', occurredAt: AT }),
      ];
      const referenced = [Message.user('What changed?'), Message.assistant('Nothing breaks.')];
      const committed: unknown[] = [];
      const published: ThreadState[] = [];
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          h.live.subscribe(ROOT, (event) => {
            if (event.type === 'state') published.push(event.frame.state);
          }),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      );
      yield* h.aggregate.append(ROOT, OWNER, events, recordingScope(committed));
      expect((yield* h.store.find(ROOT))?.history).toEqual(referenced);
      expect((yield* h.store.transcriptOf(ROOT))?.map((entry) => entry.type)).toEqual(['message', 'message']);
      expect((yield* h.events.eventsAfter(ROOT, 0, 3)).map((row) => row.kind)).toEqual(['message', 'message']);
      expect(committed).toEqual(referenced);
      expect(published.map((state) => state.position)).toEqual([2]);
    }),
  );
  it.effect(
    'a fork completes both host birth phases and stores its reset switches',
    Effect.fnUntraced(function* () {
      const phases: string[] = [];
      const h = yield* kernelOver({
        row: { switches: { serviceTier: 'priority' } },
        onThreadBorn: (input) =>
          Effect.sync(() => {
            phases.push(`born:${input.child.id}:${input.parent.id}:${input.carried}`);
          }),
        onThreadReady: (row) =>
          Effect.sync(() => {
            phases.push(`ready:${row.id}`);
          }),
      });
      const branch = yield* h.duplicate(forkInput);
      expect((yield* h.store.find(branch.id))?.switches).toEqual({});
      expect(phases).toEqual([`born:${branch.id}:${ROOT}:none`, `ready:${branch.id}`]);
    }),
  );
  it.effect(
    'a host readiness failure removes the branch and preserves the source',
    Effect.fnUntraced(function* () {
      const born: string[] = [];
      const failure = new ThreadCallBroke({ cause: new Error('Host floor failed.') });
      const h = yield* kernelOver({
        onThreadBorn: ({ child }) =>
          Effect.sync(() => {
            born.push(child.id);
          }),
        onThreadReady: () => Effect.fail(failure),
      });
      expect(yield* Effect.result(h.duplicate(forkInput))).toMatchObject({ _tag: 'Failure', failure });
      expect(born).toHaveLength(1);
      expect(yield* h.store.find(born[0]!)).toBeUndefined();
      expect((yield* h.store.find(ROOT))?.id).toBe(ROOT);
    }),
  );
  it.effect(
    'a fork of a source that writes under every outside preparation is born carrying what its write unit saw',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver({ movesUnderEveryRead: true });
      const branch = yield* h.duplicate({ ...forkInput, cut: { kind: 'all' } });
      const carried = (yield* h.store.transcriptOf(branch.id))?.map((entry) => entry.id);
      expect(carried).toEqual((yield* h.store.transcriptOf(ROOT))?.map((entry) => entry.id));
      expect(carried).toContain('said-1');
    }),
  );
  it.effect(
    'a fork stores its source authority rather than the root default',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver({ row: { authority: { mode: 'review', bypassFrom: null } } });
      const branch = yield* h.duplicate(forkInput);
      expect(yield* h.store.find(branch.id)).toMatchObject({ parentThreadId: null, authority: { mode: 'review', bypassFrom: null } });
    }),
  );
  it.effect(
    'a fork taken by a spawn is born a child with its provision committed',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      const provisioned: string[] = [];
      const branch = yield* h.duplicate({
        ...forkInput,
        spawned: { parentThreadId: ROOT, spawnedByRunId: 'run-7', name: 'scout', authority: { mode: 'trust', bypassFrom: null } },
        commit: (child) =>
          Effect.sync(() => {
            provisioned.push(child.id);
          }),
      });
      expect(yield* h.store.find(branch.id)).toMatchObject({
        parentThreadId: ROOT,
        spawnedByRunId: 'run-7',
        name: 'scout',
        authority: { mode: 'trust', bypassFrom: null },
      });
      expect(provisioned).toEqual([branch.id]);
    }),
  );
  it.effect(
    'a spawn forks the active run that made the call',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      yield* h.start('run-7');
      const branch = yield* h.duplicate({ ...forkInput, spawned: { parentThreadId: ROOT, spawnedByRunId: 'run-7' } });
      expect(yield* h.store.find(branch.id)).toMatchObject({ parentThreadId: ROOT, spawnedByRunId: 'run-7' });
    }),
  );
  it.effect(
    'a spawn the active run makes as a root is born outside the source tree, its creator recorded',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      yield* h.start('run-7');
      const branch = yield* h.duplicate({
        ...forkInput,
        createdBy: ROOT,
        spawned: { parentThreadId: null, spawnedByRunId: 'run-7', name: 'scout' },
      });
      expect(yield* h.store.find(branch.id)).toMatchObject({
        parentThreadId: null,
        spawnRootId: branch.id,
        createdBy: ROOT,
        name: 'scout',
      });
      expect(yield* h.store.listByParent(OWNER, ROOT)).toEqual([]);
    }),
  );
  it.effect(
    'forking a parked question closes the branch’s open call without closing the source',
    Effect.fnUntraced(function* () {
      const question = confirmQuestion('run-8', 'call-9');
      const h = yield* kernelOver({
        row: {
          history: [
            Message.user('Write it.'),
            Message.assistant([
              ToolCallPart.from({ id: 'call-8', name: 'read_file', input: {} }),
              ToolCallPart.from({ id: 'call-9', name: 'write_file', input: {} }),
            ]),
            Message.tool(ToolResultPart.from({ id: 'call-8', name: 'read_file', result: 'read' })),
          ],
          pendingInteraction: question,
        },
      });
      yield* h.start('run-8');
      const branch = yield* h.duplicate({ ...forkInput, cut: { kind: 'all' } });
      expect(branch.parentThreadId).toBeNull();
      expect((yield* h.store.find(branch.id))?.history.at(-1)).toMatchObject({
        role: 'tool',
        content: [{ type: 'tool-result', id: 'call-9', result: { type: 'error' } }],
      });
      expect((yield* h.store.find(ROOT))?.pendingInteraction).toEqual(question);
    }),
  );
  it.effect(
    'an unrelated active run blocks a spawn fork',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      yield* h.start('run-8');
      const refused = yield* Effect.result(h.duplicate({ ...forkInput, spawned: { parentThreadId: ROOT, spawnedByRunId: 'run-7' } }));
      expect(refused).toMatchObject({ _tag: 'Failure', failure: { _tag: 'ThreadRunConflict', runId: 'run-8' } });
      if (refused._tag === 'Failure') expect(refused.failure).toBeInstanceOf(ThreadRunConflictError);
      expect(yield* h.store.listByParent(OWNER, ROOT)).toEqual([]);
    }),
  );
});
const history = [Message.user('one'), Message.user('two'), Message.user('three')];
const entry: ThreadCompactionEntry = {
  type: 'compaction',
  id: 'compaction:run-1:4',
  runId: 'run-1',
  mode: 'automatic',
  status: 'completed',
  occurredAt: AT,
  updatedAt: AT,
};
const settlement: ThreadCompactionSettlement = {
  threadId: ROOT,
  prunedToolCalls: [],
  retiredToolCalls: [],
  checkpoint: {
    threadId: ROOT,
    sourceRunId: 'run-1',
    coveredMessageCount: 2,
    coveredPrefixHash: 'the-prefix',
    summary: 'what the first two turns said',
    usage: null,
  },
  replaced: { keepFrom: 2, messages: [Message.assistant('what the first two turns said')] },
  covers: (locked) => JSON.stringify(locked.slice(0, 2)) === JSON.stringify(history.slice(0, 2)),
};
describe('ThreadCompactionRuns.settle', () => {
  it.effect(
    'a covered prefix writes its checkpoint and folds history',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver({ row: { history } });
      expect(yield* h.compaction.settle(ROOT, settlement, entry)).toBe(true);
      expect(yield* h.checkpoints.latestCheckpoint(ROOT)).toMatchObject({ coveredPrefixHash: 'the-prefix' });
      expect((yield* h.store.find(ROOT))?.history).toEqual([Message.assistant('what the first two turns said'), Message.user('three')]);
    }),
  );
  it.effect(
    'a prefix absent from locked history changes neither checkpoint nor history',
    Effect.fnUntraced(function* () {
      const changed = [Message.user('changed'), ...history.slice(1)];
      const h = yield* kernelOver({ row: { history: changed } });
      expect(yield* h.compaction.settle(ROOT, settlement, entry)).toBe(false);
      expect(yield* h.checkpoints.latestCheckpoint(ROOT)).toBeNull();
      expect((yield* h.store.find(ROOT))?.history).toEqual(changed);
      expect(yield* h.events.eventsAfter(ROOT, 0, 1)).toEqual([]);
    }),
  );
  it.effect(
    'settlement folds locked history and preserves words appended after its snapshot',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver({ row: { history } });
      yield* h.store.appendEntries(ROOT, { history: [Message.user('four')] });
      expect(yield* h.compaction.settle(ROOT, settlement, entry)).toBe(true);
      expect((yield* h.store.find(ROOT))?.history).toEqual([
        Message.assistant('what the first two turns said'),
        Message.user('three'),
        Message.user('four'),
      ]);
    }),
  );
});
describe('setAuthorityMode', () => {
  it.effect(
    'a root declares bypass with its own provenance and returns that snapshot',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      expect((yield* h.aggregate.setAuthorityMode(ROOT, OWNER, 'bypass')).thread.authority).toEqual({ mode: 'bypass', bypassFrom: ROOT });
      expect((yield* h.store.find(ROOT))?.authority).toEqual({ mode: 'bypass', bypassFrom: ROOT });
    }),
  );
  it.effect(
    'an operator declares bypass on a spawned thread with that thread’s provenance',
    Effect.fnUntraced(function* () {
      const h = yield* kernelOver();
      const child = yield* h.store.transaction((tx) =>
        h.store.insertChild(
          ROOT,
          { id: 'child-1', ownerId: OWNER, agentId: 'agent-1', authority: { mode: 'review', bypassFrom: null } },
          tx,
        ),
      );
      expect((yield* h.aggregate.setAuthorityMode(child.id, OWNER, 'bypass')).thread.authority).toEqual({
        mode: 'bypass',
        bypassFrom: child.id,
      });
      expect((yield* h.store.find(child.id))?.authority).toEqual({ mode: 'bypass', bypassFrom: child.id });
    }),
  );
});
function recordingScope(committed: unknown[]): ThreadToolOutputScope<unknown> {
  return {
    tools: {},
    project: unused,
    projectMessages: unused,
    retainInterrupted: ({ text, complete }) => Effect.succeed({ kind: 'text' as const, text, complete }),
    retainOpen: ({ text }) => Effect.succeed({ input: { kind: 'text' as const, text, complete: false }, chars: text.length }),
    commitReferenced: (messages) =>
      Effect.sync(() => {
        committed.push(...messages);
      }),
    dispose: unused,
  };
}
const attachments: ThreadAttachmentStorage<MemoryTx> = {
  keep: unused,
  resolve: (_threadId, _ownerId, refs) =>
    Effect.succeed(refs.map((ref) => ({ id: ref.id, mediaType: 'image/png' as const, url: `test://${ref.id}` }))),
  addressed: (_threadId, refs) =>
    Effect.succeed(refs.map((ref) => ({ id: ref.id, mediaType: 'image/png' as const, url: `test://${ref.id}` }))),
  hydrate: unused,
  sizes: unused,
};
const toolOutputs: ThreadToolOutputStorage<MemoryTx> = {
  scope: () => {
    throw new Error('No tool-output scope is opened by these contracts.');
  },
  settleOpen: () => Effect.void,
};
const models: CompactionModels = {
  request: () => {
    throw new Error('No model is called by settlement.');
  },
  served: unused,
  defaultModel: () => {
    throw new Error('No model is selected by settlement.');
  },
};
const policy: ThreadCompactionPolicy = {
  compactionTrigger: { strategy: 'reserve-output' },
  compactionOverrides: [],
  bufferTokens: 3,
  imageTokens: 0,
  maxRecentTokens: 2,
  minRecentTokens: 1,
  maxOpeningTokens: 0,
  recentFraction: 1,
  recentUserTurns: 1,
  toolPruneProtectShare: 0.5,
};
