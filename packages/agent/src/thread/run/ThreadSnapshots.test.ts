import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Context, Deferred, Effect, Fiber, Layer, Queue } from 'effect';
import { Usage } from '@runlith/llm/schema/events';
import { TestClock } from 'effect/testing';
import { ThreadEntryKinds, makeThreadEntryReader } from '../../transcript/kinds';
import type { ThreadMessageEntry, ThreadQuestionEntry } from '../../transcript/entries';
import type { ThreadTranscriptEntry } from '../../transcript/rows';
import { FeedView } from '../../transcript/testing/feedView';
import { STALL_FLOOR_MS } from '../../agent/callProgress';
import type { ThreadBorderFailed, ThreadPortFailure } from '../ThreadBorder';
import type { ThreadContextReading, ThreadMetadataRow, ThreadRunRow } from '../rows';
import type { ThreadState, ThreadStateFrame } from '../state';
import {
  ThreadLeaseRhythm,
  ThreadResidence,
  ThreadResting,
  type ThreadRunLeaseRhythm,
  type ThreadTx,
  type ThreadWriteTx,
} from '../ThreadPorts';
import { threadStorageLayer } from '../kernelPorts';
import { inboxSignalValues, inboxSteerValues, inboxTurnValues } from '../inboxItems';
import { threadEntryEvent, threadSignalEvent } from '../events';
import { sealThreadEvents } from '../ThreadEventDoor';
import { actDigest } from '../keyed';
import { answerOf, transition, transitionDeps } from '../transition/kernel';
import type { StoredThreadAttachment } from '../attachmentStorage';
import type { ThreadSignal } from '../../transcript/parts';
import { makeMemoryRows } from '../storage/memory/ThreadRows';
import { makeMemoryEvents } from '../storage/memory/ThreadEvents';
import { makeMemoryRuns } from '../storage/memory/ThreadRuns';
import { makeMemoryOwnerSettings } from '../storage/memory/OwnerSettings';
import { ThreadMemory, type MemoryStorageInput } from '../storage/memory/state';
import { inMemoryThreadTransitions } from '../storage/memory/ThreadTransitions';
import { inMemoryInboxStorage } from '../storage/InMemoryInboxStorage';
import type { MemoryTx } from '../storage/memory/units';
import type { ThreadAggregateStorage } from '../storage/aggregate';
import { emptyToolOutputs, runRow } from '../conformance/runCycle/runDoubles';
import { RunEndings, type RunEnding } from './lifecycle/endings';
import { LaunchGate, LAUNCH_REFUSALS_BEFORE_BLOCK, launchGateLayer } from './LaunchGate';
import { ThreadChanges, threadChangesLayer } from './ThreadChanges';
import { ThreadRunLedger } from './ThreadRunLedger';
import { ThreadSnapshots, threadSnapshotsLayer } from './ThreadSnapshots';
import { wordsInFlightLayer } from './WordsInFlight';
import { transportsLayer } from '../transport/Transports';
import { makeThreadLiveFeed, threadFeedLayer, type ThreadLiveEvent } from './ThreadLiveFeed';
const RHYTHM: ThreadRunLeaseRhythm = { heartbeatIntervalMs: 30_000, staleRunningAfterMs: 30_000, takeoverAfterMs: 30_000 };
it.effect(
  'a snapshot whose head moved under its read reads again where no writer lands',
  Effect.fnUntraced(function* () {
    const world = yield* snapshotsOver();
    yield* world.append(words('a', 'one'));
    const scope = yield* Effect.scope;
    const writers: Fiber.Fiber<unknown, ThreadPortFailure>[] = [];
    world.rows.beforeWindow = Effect.gen(function* () {
      const writer = yield* Effect.forkIn(world.append(words(`w${writers.length}`, 'more')), scope, { startImmediately: true });
      writers.push(writer);
      if (writers.length === 1) yield* Fiber.join(writer);
    });
    const snapshot = yield* world.snapshots.snapshot('t');
    expect(snapshot.position).toBe(2);
    expect(snapshot.live.at.position).toBe(2);
    expect(snapshot.transcript.map((entry) => entry.id)).toEqual(['a', 'w0']);
    world.rows.beforeWindow = Effect.void;
    yield* Fiber.join(writers[1]!);
    expect((yield* world.snapshots.snapshot('t')).transcript.map((entry) => entry.id)).toEqual(['a', 'w0', 'w1']);
  }),
);
it.effect(
  'a flush during a snapshot reaches the reader exactly once through the cut or subsequent events',
  Effect.fnUntraced(function* () {
    const world = yield* snapshotsOver();
    const committed = words('assistant:r', 'durable words', 'r');
    world.active.set('t', runRow('r', { threadId: 't', progress: { stage: 'streaming', message: null } }));
    const events: ThreadLiveEvent<ThreadState>[] = [];
    const unsubscribe = world.live.subscribe('t', (event) => events.push(event));
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    world.live.tail('t', 'r', [{ ...committed, text: 'durable' }], []);
    world.live.append('t', 'r', committed.id, ' words');
    const checked = yield* Deferred.make<void>();
    const resume = yield* Deferred.make<void>();
    let heads = 0;
    world.observed.head = Effect.fnUntraced(function* (head) {
      if (++heads === 2) {
        yield* Deferred.succeed(checked, undefined);
        yield* Deferred.await(resume);
      }
      return head;
    });
    const opening = yield* Effect.forkScoped(world.snapshots.snapshot('t'), { startImmediately: true });
    yield* Deferred.await(checked);
    const landing = yield* Effect.forkScoped(
      world.live.atCut(
        't',
        Effect.gen(function* () {
          yield* world.append(committed);
          world.live.tail('t', 'r', [], [committed.id]);
        }),
      ),
      { startImmediately: true },
    );
    expect(landing.pollUnsafe()).toBeUndefined();
    yield* Deferred.succeed(resume, undefined);
    const snapshot = yield* Fiber.join(opening);
    yield* Fiber.join(landing);
    yield* world.snapshots.publish('t');
    expect(snapshot.live.at.position).toBe(0);
    const reader = new FeedView<object>();
    reader.take({
      type: 'snapshot',
      at: snapshot.live.at,
      payload: {
        status: 'loaded',
        snapshot: {
          transcript: snapshot.transcript,
          before: snapshot.before,
          open: snapshot.live.open,
          progress: snapshot.live.progress,
        },
      },
    });
    for (const event of events) {
      if (event.at.seq <= snapshot.live.at.seq) continue;
      reader.take(
        event.type === 'open'
          ? { type: 'open', at: event.at, change: event.change }
          : {
              type: 'state',
              at: event.at,
              payload: { records: event.frame.deltas, snapshot: {} },
            },
      );
    }
    expect(reader.gaps).toBe(0);
    expect(reader.transcript).toEqual([committed]);
    expect(reader.open).toEqual([]);
    const next = yield* world.snapshots.snapshot('t');
    expect(next.transcript).toEqual([committed]);
    expect(next.live.open).toEqual([]);
  }),
);
it.effect(
  'a thread publishes frames in read order however long the first projection takes',
  Effect.fnUntraced(function* () {
    const entered = yield* Deferred.make<void>();
    const gate = yield* Deferred.make<void>();
    let first = true;
    const world = yield* snapshotsOver({
      project: Effect.fnUntraced(function* (state) {
        if (first) {
          first = false;
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(gate);
        }
        return state;
      }),
    });
    world.active.set('t', runRow('run-1', { threadId: 't' }));
    const sent: (string | null)[] = [];
    const unsubscribe = world.live.subscribeStates((state) => sent.push(state.activeRun?.id ?? null));
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    const older = yield* Effect.forkScoped(world.snapshots.publish('t'), { startImmediately: true });
    yield* Deferred.await(entered);
    world.active.delete('t');
    const newer = yield* Effect.forkScoped(world.snapshots.publish('t'), { startImmediately: true });
    expect(newer.pollUnsafe()).toBeUndefined();
    yield* Deferred.succeed(gate, undefined);
    yield* Fiber.join(older);
    yield* Fiber.join(newer);
    expect(sent).toEqual(['run-1', null]);
  }),
);
it.effect(
  'a parked run stays awaiting while ownership and working life age independently; idle has no ownership',
  Effect.fnUntraced(function* () {
    const world = yield* snapshotsOver();
    const silent = new Date(-Math.max(STALL_FLOOR_MS, world.capabilities.callEnvelopeMs ?? 0) - 1);
    const regular = runRow('run-1', { threadId: 't' });
    const stale = { ...regular, heartbeatAt: silent };
    const readings = [];
    world.active.set('t', regular);
    readings.push((yield* world.snapshots.state('t')).status);
    world.active.set('t', stale);
    readings.push((yield* world.snapshots.state('t')).status);
    yield* world.patch({ updatedAt: silent });
    readings.push((yield* world.snapshots.state('t')).status);
    const held = world.memory.held('t');
    if (!held) return yield* Effect.die('Expected the parked thread');
    const question: ThreadQuestionEntry = {
      type: 'question',
      id: 'question:q-1',
      runId: 'run-1',
      questionId: 'q-1',
      questions: [],
      toolCalls: [],
      status: 'open',
    };
    held.transcript = [question];
    world.active.set('t', { ...stale, progress: { stage: 'awaiting-question', message: null } });
    readings.push((yield* world.snapshots.state('t')).status);
    held.transcript = [{ ...question, status: 'answered' }];
    world.active.set('t', stale);
    yield* world.patch({ updatedAt: new Date(0) });
    readings.push((yield* world.snapshots.state('t')).status);
    world.active.delete('t');
    readings.push((yield* world.snapshots.state('t')).status);
    expect(readings.map((status) => [status.life, status.ownership, status.openQuestions])).toEqual([
      ['working', 'held', []],
      ['working', 'stale-evidence', []],
      ['stalled', 'stale-evidence', []],
      ['awaiting', 'held', ['q-1']],
      ['working', 'stale-evidence', []],
      ['idle', undefined, []],
    ]);
    expect(readings[5]).toMatchObject({ runId: null, since: null });
    expect('ownership' in readings[5]!).toBe(false);
  }),
);
it.effect(
  'repeated launch refusals block the thread until the gate is lifted',
  Effect.fnUntraced(function* () {
    const world = yield* snapshotsOver();
    const readings = [(yield* world.snapshots.state('t')).status];
    for (let refusal = 0; refusal < LAUNCH_REFUSALS_BEFORE_BLOCK; refusal += 1) world.gate.refused('t');
    readings.push((yield* world.snapshots.state('t')).status);
    world.gate.lift('t');
    readings.push((yield* world.snapshots.state('t')).status);
    expect(readings.map((status) => status.launchBlocked === true)).toEqual([false, true, false]);
  }),
);
it.effect(
  'the owner publishes a stall at its deadline with no event and lifts it on progress',
  Effect.fnUntraced(function* () {
    const world = yield* snapshotsOver({ rhythm: { ...RHYTHM, takeoverAfterMs: 60_000 } });
    world.active.set('t', runRow('run-1', { threadId: 't' }));
    yield* world.patch({ updatedAt: new Date(-STALL_FLOOR_MS + 25), capabilities: { ...world.capabilities, callEnvelopeMs: 25 } });
    const lives: string[] = [];
    const stalled = yield* Deferred.make<void>();
    const unsubscribe = world.live.subscribeStates((state) => {
      lives.push(state.status.life);
      if (state.status.life === 'stalled') Deferred.doneUnsafe(stalled, Effect.void);
    });
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    yield* world.snapshots.publish('t');
    yield* TestClock.adjust(26);
    yield* Deferred.await(stalled);
    expect(lives).toEqual(['working', 'stalled']);
    yield* world.patch({ updatedAt: new Date(yield* Clock.currentTimeMillis) });
    yield* world.snapshots.publish('t');
    expect(lives).toEqual(['working', 'stalled', 'working']);
  }),
);
it.effect(
  'statuses batches only the named owned threads and returns per-row outcomes',
  Effect.fnUntraced(function* () {
    const page = ['t-0', 't-1', 't-2', 't-3', 'ghost'];
    const world = yield* snapshotsOver({ threads: page.slice(0, 4) });
    yield* world.patch({ ownerId: 'other' }, 't-3');
    world.active.set('t-1', runRow('run-1', { threadId: 't-1' }));
    world.ended.push({
      threadId: 't-2',
      runId: 'run-9',
      status: 'failed',
      stoppedBy: null,
      failureReason: 'provider refused',
      finishedAt: new Date(0),
      words: null,
      notification: {
        state: 'notification-exhausted',
        reclaims: 3,
        maxReclaims: 3,
        confirmedAt: null,
        claimExpiresAt: new Date(0).toISOString(),
        evidence: 'unavailable',
        attempt: null,
      },
    });
    const rows = yield* world.snapshots.statuses('owner', page);
    expect(rows.map((row) => [row.threadId, row.outcome])).toEqual([
      ['t-0', 'found'],
      ['t-1', 'found'],
      ['t-2', 'found'],
      ['t-3', 'foreign-owner'],
      ['ghost', 'not-found'],
    ]);
    expect(rows[1]).toMatchObject({ status: { life: 'working', runId: 'run-1' } });
    expect(world.reads.running).toEqual([['t-0', 't-1', 't-2']]);
    expect(world.rows.metadataReads).toEqual([page]);
    expect(world.reads.pending).toEqual([['t-0', 't-1', 't-2']]);
    expect(world.reads.latest).toBe(0);
    expect(world.reads.head).toBe(0);
    expect(world.reads.ended).toEqual([['t-0', 't-2']]);
    expect(rows[2]).toMatchObject({
      status: { life: 'idle', ending: { runId: 'run-9', status: 'failed', notification: 'notification-exhausted' } },
    });
    expect(rows[0]?.outcome === 'found' ? rows[0].status.ending : undefined).toBeUndefined();
  }),
);
it.effect(
  'an arrival carries the attachments its signal will journal',
  Effect.fnUntraced(function* () {
    const stored: StoredThreadAttachment = { id: 'att-1', mediaType: 'image/png', url: '/attachments/att-1', filename: 'shot.png' };
    const world = yield* snapshotsOver();
    world.active.set('t', runRow('run-1', { threadId: 't' }));
    world.attachments.set('t|owner|att-1', stored);
    const signal: ThreadSignal = {
      id: 'sig-1',
      type: 'peer-note',
      addressee: 'transport',
      text: 'See the screenshot.',
      attachments: [{ id: 'att-1' }],
      occurredAt: '2026-10-08T00:00:00.000Z',
    };
    yield* world.inbox.put(inboxSignalValues('t', signal));
    const state = yield* world.snapshots.state('t');
    expect<unknown>(state.pendingInput.arrived).toEqual([threadSignalEvent(signal, 'run-1', { attachments: [stored] }).payload.entry]);
  }),
);
it.effect(
  'the operator’s waiting words carry the address and type of each attachment',
  Effect.fnUntraced(function* () {
    const world = yield* snapshotsOver();
    world.active.set('t', runRow('run-1', { threadId: 't' }));
    world.attachments.set('t|owner|att-1', { id: 'att-1', mediaType: 'image/png', url: '/attachments/att-1' });
    world.attachments.set('t|owner|doc-1', { id: 'doc-1', mediaType: 'application/pdf', url: '/attachments/doc-1', filename: 'plan.pdf' });
    yield* world.inbox.put(inboxSteerValues('t', { id: 'steer-1', text: 'Look at this.', attachments: [{ id: 'att-1' }] }));
    yield* world.inbox.put(inboxTurnValues('t', { id: 'turn-1', text: 'Then this.', attachments: [{ id: 'doc-1' }] }));
    const { pendingInput } = yield* world.snapshots.state('t');
    expect(pendingInput.steers.map((turn) => turn.attachments)).toEqual([[{ id: 'att-1', mime: 'image/png', url: '/attachments/att-1' }]]);
    expect(pendingInput.queued.map((turn) => turn.attachments)).toEqual([
      [{ id: 'doc-1', mime: 'application/pdf', url: '/attachments/doc-1', filename: 'plan.pdf' }],
    ]);
  }),
);
it.effect(
  'a transition that publishes its own change lands in the projection without reading storage, as a fresh read would',
  Effect.fnUntraced(function* () {
    const world = yield* snapshotsOver();
    world.active.set('t', runRow('run-1', { threadId: 't' }));
    const frames = yield* world.frames;
    yield* world.snapshots.publish('t');
    const reads = world.reads.latest;
    yield* world.transit([words('a', 'one', 'run-1')], { contextReading: reading(7) });
    const frame = yield* frames.at(1);
    expect(world.reads.latest).toBe(reads);
    expect(frame.deltas.map((delta) => delta.entry?.id)).toEqual(['a']);
    expect(stripped(frame.state)).toEqual(stripped(yield* world.snapshots.state('t')));
  }),
);
it.effect(
  'a write no change describes, such as a heartbeat, breaks the revision chain and the next change reads the thread again',
  Effect.fnUntraced(function* () {
    const world = yield* snapshotsOver();
    const run = runRow('run-1', { threadId: 't', heartbeatAt: new Date(0) });
    world.active.set('t', run);
    const frames = yield* world.frames;
    yield* world.snapshots.publish('t');
    const reads = world.reads.latest;
    world.active.set('t', { ...run, heartbeatAt: new Date(5_000), updatedAt: new Date(5_000) });
    yield* world.written();
    yield* world.transit([words('a', 'one', 'run-1')]);
    const frame = yield* frames.at(1);
    expect(world.reads.latest).toBe(reads + 1);
    expect(frame.state.activeRun?.heartbeatAt).toEqual(new Date(5_000));
    expect(stripped(frame.state)).toEqual(stripped(yield* world.snapshots.state('t')));
  }),
);
it.effect(
  'a heartbeat handed as a typed change keeps the held run fresh, and the next change is carried without a read',
  Effect.fnUntraced(function* () {
    const world = yield* snapshotsOver();
    const run = runRow('run-1', { threadId: 't', heartbeatAt: new Date(0) });
    world.active.set('t', run);
    const frames = yield* world.frames;
    yield* world.snapshots.publish('t');
    const reads = world.reads.latest;
    const from = world.memory.units.revision();
    yield* world.written();
    const beat = { id: run.id, heartbeatAt: new Date(5_000), updatedAt: new Date(5_000) };
    world.active.set('t', { ...run, ...beat });
    yield* world.changes.deliver({ kind: 'ran', threadId: 't', revision: { from, to: from + 1 }, runs: [beat] });
    yield* world.transit([words('a', 'one', 'run-1')]);
    const frame = yield* frames.at(1);
    expect(world.reads.latest).toBe(reads);
    expect(frame.state.activeRun?.heartbeatAt).toEqual(new Date(5_000));
    expect(stripped(frame.state)).toEqual(stripped(yield* world.snapshots.state('t')));
  }),
);
it.effect(
  'a change that does not follow the published position reads the thread again and publishes every fact once',
  Effect.fnUntraced(function* () {
    const world = yield* snapshotsOver();
    world.active.set('t', runRow('run-1', { threadId: 't' }));
    const frames = yield* world.frames;
    yield* world.snapshots.publish('t');
    const reads = world.reads.latest;
    yield* world.append(words('unannounced', 'between', 'run-1'));
    yield* world.transit([words('b', 'two', 'run-1')]);
    const frame = yield* frames.at(1);
    expect(world.reads.latest).toBe(reads + 1);
    expect(frame.deltas.map((delta) => delta.entry?.id)).toEqual(['unannounced', 'b']);
    expect(stripped(frame.state)).toEqual(stripped(yield* world.snapshots.state('t')));
  }),
);
it.effect(
  'under any order of published, read and unannounced changes the projection equals a fresh read and carries each fact once',
  Effect.fnUntraced(function* () {
    const world = yield* snapshotsOver();
    world.active.set('t', runRow('run-1', { threadId: 't' }));
    const frames = yield* world.frames;
    yield* world.snapshots.publish('t');
    let seed = 7;
    const next = () => (seed = (seed * 48_271) % 2_147_483_647) % 4;
    for (let step = 0; step < 48; step += 1) {
      const entry = words(`e${step}`, `step ${step}`, 'run-1');
      const choice = next();
      if (choice === 0) yield* world.transit([entry], step % 3 === 0 ? { contextReading: reading(step) } : {});
      else if (choice === 1) yield* world.transit([entry, words(`f${step}`, 'paired', 'run-1')]);
      else if (choice === 2) yield* Effect.andThen(world.append(entry), world.snapshots.publish('t'));
      else yield* world.transit([entry], {}, 'moved');
      const frame = yield* frames.reaching(yield* world.head());
      expect(stripped(frame.state)).toEqual(stripped(yield* world.snapshots.state('t')));
    }
    const carried = frames.all().flatMap((frame) => frame.deltas.map((delta) => delta.position));
    expect(carried).toEqual(Array.from({ length: yield* world.head() }, (_, index) => index + 1));
  }),
);
it.effect(
  'a snapshot read ahead of committed changes still queued is never followed by an older state',
  Effect.fnUntraced(function* () {
    const world = yield* snapshotsOver();
    world.active.set('t', runRow('run-1', { threadId: 't' }));
    const frames = yield* world.frames;
    yield* world.snapshots.publish('t');
    yield* frames.at(0);
    const shown: { readonly seq: number; readonly position: number }[] = [];
    const detach = world.live.subscribe('t', (event) => {
      if (event.type === 'state') shown.push({ seq: event.at.seq, position: event.frame.state.position });
    });
    yield* Effect.addFinalizer(() => Effect.sync(detach));
    const release = yield* Deferred.make<void>();
    const held = yield* Effect.forkScoped(world.live.atCut('t', Deferred.await(release)), { startImmediately: true });
    const opening = yield* Effect.forkScoped(world.snapshots.snapshot('t'), { startImmediately: true });
    yield* world.transit([words('a', 'one', 'run-1')], { contextReading: reading(1) });
    yield* world.transit([words('b', 'two', 'run-1')], { contextReading: reading(2) });
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(held);
    const snapshot = yield* Fiber.join(opening);
    expect(snapshot.position).toBe(2);
    const last = yield* frames.reaching(2);
    expect(shown.filter((frame) => frame.seq > snapshot.live.at.seq && frame.position < snapshot.position)).toEqual([]);
    expect(frames.all().flatMap((frame) => frame.deltas.map((delta) => delta.position))).toEqual([1, 2]);
    expect(stripped(last.state)).toEqual(stripped(yield* world.snapshots.state('t')));
  }),
);
it.effect(
  'a backlog of committed changes past its bound is caught up by one read that carries every fact once',
  Effect.fnUntraced(function* () {
    const world = yield* snapshotsOver();
    world.active.set('t', runRow('run-1', { threadId: 't' }));
    const frames = yield* world.frames;
    yield* world.snapshots.publish('t');
    yield* frames.at(0);
    const release = yield* Deferred.make<void>();
    const held = yield* Effect.forkScoped(world.live.atCut('t', Deferred.await(release)), { startImmediately: true });
    const reads = world.reads.latest;
    const backlog = 100;
    for (let step = 0; step < backlog; step += 1) yield* world.transit([words(`e${step}`, `step ${step}`, 'run-1')]);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(held);
    const last = yield* frames.reaching(backlog);
    expect(world.reads.latest).toBe(reads + 1);
    expect(frames.all().flatMap((frame) => frame.deltas.map((delta) => delta.position))).toEqual(
      Array.from({ length: backlog }, (_, index) => index + 1),
    );
    expect(stripped(last.state)).toEqual(stripped(yield* world.snapshots.state('t')));
  }),
);
type SnapshotRowState = {
  beforeWindow: Effect.Effect<void, ThreadPortFailure>;
  readonly metadataReads: (readonly string[])[];
};
function snapshotRows({ memory }: MemoryStorageInput): ThreadAggregateStorage<MemoryTx> & SnapshotRowState {
  const stored = makeMemoryRows({ memory });
  const state: SnapshotRowState = { beforeWindow: Effect.void, metadataReads: [] };
  const storage: ThreadAggregateStorage<MemoryTx> = {
    ...stored,
    transcriptWindow: (id, query, tx) => Effect.andThen(state.beforeWindow, stored.transcriptWindow(id, query, tx)),
    metadataOf: (ids, tx) => {
      state.metadataReads.push([...ids]);
      return stored.metadataOf(ids, tx);
    },
  };
  return Object.assign(state, storage);
}
const snapshotsOver = Effect.fnUntraced(function* (
  options: {
    readonly threads?: readonly string[];
    readonly rhythm?: ThreadRunLeaseRhythm;
    readonly project?: (state: ThreadState) => Effect.Effect<ThreadState, ThreadBorderFailed>;
  } = {},
) {
  const unused = () => Effect.die('Snapshots do not use this operation');
  const memory = new ThreadMemory(makeThreadEntryReader({ products: [] }));
  const rows = snapshotRows({ memory });
  const patch = Effect.fnUntraced(function* (values: Partial<ThreadMetadataRow>, id = 't') {
    const held = memory.held(id);
    if (!held) return yield* Effect.die(`Expected thread ${id}`);
    held.row = { ...held.row, ...values };
  });
  let capabilities: ThreadMetadataRow['capabilities'] | undefined;
  for (const id of options.threads ?? ['t']) {
    const row = yield* rows.insert({ id, ownerId: 'owner', agentId: 'agent-1' });
    capabilities = row.capabilities;
    yield* patch({ updatedAt: new Date(0) }, id);
  }
  if (!capabilities) return yield* Effect.die('Expected a snapshot thread');
  const rawLog = makeMemoryEvents({ memory });
  const live = yield* makeThreadLiveFeed<ThreadState>();
  const active = new Map<string, ThreadRunRow>();
  const ended: RunEnding[] = [];
  const attachments = new Map<string, StoredThreadAttachment>();
  const reads: {
    running: (readonly string[])[];
    pending: (readonly string[])[];
    ended: (readonly string[])[];
    latest: number;
    head: number;
  } = {
    running: [],
    pending: [],
    ended: [],
    latest: 0,
    head: 0,
  };
  const observed: {
    head: (head: number) => Effect.Effect<number>;
  } = { head: (head) => Effect.succeed(head) };
  const inbox = inMemoryInboxStorage({ units: memory.units, calls: memory.records });
  const storage = threadStorageLayer({
    storage: rows,
    eventLog: {
      append: (event, tx) => rawLog.append(event, tx),
      recordsAsOf: (id, query, tx) => rawLog.recordsAsOf(id, query, tx),
      revisionsAsOf: (id, query, tx) => rawLog.revisionsAsOf(id, query, tx),
      eventsAfter: (id, after, limit, tx) => rawLog.eventsAfter(id, after, limit, tx),
      headPosition: (id, tx) =>
        Effect.flatMap(rawLog.headPosition(id, tx), (head) => {
          reads.head += 1;
          return observed.head(head);
        }),
      positionOf: (id, recordId, tx) => rawLog.positionOf(id, recordId, tx),
    },
    transitions: inMemoryThreadTransitions({ memory }),
    createRuns: (owner) => makeMemoryRuns({ memory, ownerId: owner, scope: null }),
    inbox: {
      ...inbox,
      pendingOf: (ids, tx) => {
        reads.pending.push([...ids]);
        return inbox.pendingOf(ids, tx);
      },
    },
    ownerSettings: makeMemoryOwnerSettings({ memory }),
    attachments: {
      keep: unused,
      hydrate: unused,
      sizes: unused,
      resolve: (id, owner, refs) => Effect.sync(() => refs.flatMap((ref) => attachments.get(`${id}|${owner}|${ref.id}`) ?? [])),
      addressed: (id, refs) => Effect.sync(() => refs.flatMap((ref) => attachments.get(`${id}|owner|${ref.id}`) ?? [])),
    },
    toolOutputs: { scope: () => ({ ...emptyToolOutputs, commitReferenced: unused }), settleOpen: unused },
  });
  const dependencies = Layer.mergeAll(
    storage,
    threadFeedLayer(live, options.project ?? ((state) => Effect.succeed(state))),
    ThreadEntryKinds.layer([]),
    launchGateLayer,
    wordsInFlightLayer,
    transportsLayer,
    Layer.succeed(ThreadLeaseRhythm, options.rhythm ?? RHYTHM),
    Layer.succeed(ThreadResidence, null),
    Layer.succeed(ThreadResting, null),
    Layer.succeed(
      RunEndings,
      RunEndings.of({
        page: unused,
        redeliver: unused,
        restore: unused,
        newest: (ids) =>
          Effect.sync(() => {
            reads.ended.push([...ids]);
            return ended.filter((row) => ids.includes(row.threadId));
          }),
      }),
    ),
    Layer.succeed(
      ThreadRunLedger,
      ThreadRunLedger.of({
        runById: unused,
        isRunning: unused,
        runningHere: unused,
        activeRunIn: unused,
        runsOf: unused,
        latestRuns: unused,
        reapable: unused,
        activeRun: (id) => Effect.sync(() => active.get(id) ?? null),
        latestRun: () =>
          Effect.sync(() => {
            reads.latest += 1;
            return null;
          }),
        runningOf: (ids) =>
          Effect.sync(() => {
            reads.running.push([...ids]);
            return ids.flatMap((id) => active.get(id) ?? []);
          }),
      }),
    ),
  );
  const context = yield* Layer.build(threadSnapshotsLayer.pipe(Layer.provideMerge(threadChangesLayer), Layer.provideMerge(dependencies)));
  const snapshots = Context.get(context, ThreadSnapshots);
  const deps = yield* Effect.provide(transitionDeps, context);
  const append = (entry: ThreadTranscriptEntry) =>
    rows.transaction((tx) => rawLog.append({ threadId: 't', id: `event:${entry.id}`, kind: entry.type, payload: { entry } }, tx));
  const transit = (
    entries: readonly ThreadTranscriptEntry[],
    patch: { readonly contextReading?: ThreadContextReading } = {},
    landing: 'appended' | 'moved' = 'appended',
  ) =>
    Effect.flatMap(
      transition<undefined, ThreadWriteTx, ThreadPortFailure, ThreadTx>(
        deps,
        't',
        {
          declared: sealThreadEvents(entries.map(threadEntryEvent)),
          published: snapshots.committed,
          decide: () =>
            Effect.succeed({ apply: true, result: undefined, patch, participants: landing === 'moved' ? () => Effect.void : undefined }),
        },
        {
          key: { evidence: { decidedBy: `test:${entries[0]?.id}` }, digest: actDigest(entries.map((entry) => entry.id)) },
          deadline: LATER,
        },
      ),
      (outcome) => answerOf('t', outcome),
    );
  const frames = Effect.gen(function* () {
    const seen: ThreadStateFrame<ThreadState>[] = [];
    const arrived = yield* Queue.unbounded<ThreadStateFrame<ThreadState>>();
    const unsubscribe = live.subscribe('t', (event) => {
      if (event.type === 'state') Queue.offerUnsafe(arrived, event.frame);
    });
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    const take = Effect.tap(Queue.take(arrived), (frame) => Effect.sync(() => void seen.push(frame)));
    return {
      at: Effect.fnUntraced(function* (index: number) {
        while (seen.length <= index) yield* take;
        return seen[index]!;
      }),
      reaching: Effect.fnUntraced(function* (position: number) {
        for (;;) {
          const last = seen.at(-1);
          if (last !== undefined && last.state.position >= position) return last;
          yield* take;
        }
      }),
      all: () => seen,
    };
  });
  return {
    memory,
    rows,
    patch,
    live,
    active,
    ended,
    attachments,
    reads,
    observed,
    inbox,
    append,
    transit,
    frames,
    head: () => rawLog.headPosition('t'),
    capabilities,
    snapshots,
    gate: Context.get(context, LaunchGate),
    changes: Context.get(context, ThreadChanges),
    written: (id = 't') =>
      rows.transaction((tx) =>
        Effect.sync(() => {
          const held = memory.held(id);
          if (held) tx.keep(held);
        }),
      ),
  };
});
const LATER = new Date('2100-01-01T00:00:00.000Z');
function reading(stepNumber: number): ThreadContextReading {
  return {
    usage: new Usage({
      inputTokens: stepNumber,
      outputTokens: 1,
      totalTokens: stepNumber + 1,
      reasoningTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      nonCachedInputTokens: stepNumber,
    }),
    contextWindow: 200_000,
    runId: 'run-1',
    stepNumber,
    provider: 'test',
    model: 'test-model',
    measuredAt: '2026-10-31T00:00:00.000Z',
    stale: false,
  };
}
function stripped(state: ThreadState): Omit<ThreadState, 'now'> {
  const { now: _now, ...standing } = state;
  return JSON.parse(JSON.stringify(standing));
}
function words(id: string, text: string, runId = 'r'): ThreadMessageEntry {
  return { type: 'message', id, role: 'assistant', runId, text };
}
