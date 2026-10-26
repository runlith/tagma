import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { ThreadEntryKinds } from '../../transcript/kinds';
import { makeAggregateStorage, type InMemoryAggregateStorage } from '../storage/InMemoryAggregateStorage';
import { ThreadEventJournal, ThreadOwner, ThreadStore, ThreadTransitions } from '../ThreadPorts';
import { ThreadCallBroke, threadCauseOf } from '../ThreadBorder';
import { threadChangesLayer } from './ThreadChanges';
import { ThreadRunLedger } from './ThreadRunLedger';
import { ThreadContextConflictError, ThreadRunContexts, threadRunContextsLayer } from './ThreadRunContexts';
import { recordingJournal } from '../conformance/runCycle/eventLog';
import { runRow } from '../conformance/runCycle/runDoubles';
it.effect(
  'a request is durable before preparation and its id retains one destination and outcome',
  Effect.fnUntraced(function* () {
    const world = yield* contextWorld();
    expect(yield* world.contexts.request(runRef, { requestId: 'req-1', sourceKey: 'tree-b' })).toEqual({
      status: 'accepted',
      requestId: 'req-1',
      fromGeneration: 0,
    });
    expect(world.aggregate.transcript).toMatchObject([
      { type: 'context-change', requestId: 'req-1', sourceKey: 'tree-b', status: 'pending', fromGeneration: 0 },
    ]);
    expect(yield* world.contexts.request(runRef, { requestId: 'req-1', sourceKey: 'tree-b' })).toEqual({
      status: 'pending',
      requestId: 'req-1',
      fromGeneration: 0,
    });
    for (const requestId of ['req-1', 'req-2']) {
      const failure = yield* Effect.flip(world.contexts.request(runRef, { requestId, sourceKey: 'tree-c' }));
      expect(threadCauseOf(failure)).toBeInstanceOf(ThreadContextConflictError);
      expect(threadCauseOf(failure)).toMatchObject({ requestId });
    }
    expect(world.aggregate.transcript).toHaveLength(1);
  }),
);
it.effect(
  'publication commits its generation and requester bookkeeping in one unit and cannot repeat',
  Effect.fnUntraced(function* () {
    const world = yield* contextWorld();
    let committed = false;
    yield* world.contexts.request(runRef, {
      requestId: 'req-1',
      sourceKey: 'tree-b',
      commit: (tx) =>
        tx.afterCommit(
          Effect.sync(() => {
            committed = true;
          }),
        ),
    });
    const standing = yield* standingOf(world);
    expect(standing).toMatchObject({ requestId: 'req-1', held: true, context: { generation: 1 } });
    expect(committed).toBe(false);
    expect(yield* world.contexts.publish(standing!, admitted)).toBe(true);
    expect(committed).toBe(true);
    expect(yield* admittedOf(world)).toEqual({
      record: { generation: 1, sourceKey: 'tree-b', requestId: 'req-1' },
      evidence: admitted.evidence,
    });
    expect(world.aggregate.transcript).toMatchObject([
      { type: 'context-change', requestId: 'req-1', status: 'published', generation: 1, fromGeneration: 0, stepNumber: 3 },
    ]);
    expect(yield* standingOf(world)).toBeNull();
    expect(yield* world.contexts.publish(standing!, admitted)).toBe(false);
    expect(yield* admittedOf(world)).toMatchObject({ record: { generation: 1 } });
    expect(world.aggregate.transcript).toHaveLength(1);
  }),
);
it.effect(
  'denied preparation retains the admitted context and replays its denial',
  Effect.fnUntraced(function* () {
    const world = yield* contextWorld();
    yield* world.contexts.request(runRef, { requestId: 'req-1', sourceKey: 'tree-b' });
    const standing = yield* standingOf(world);
    const failure = new Error('destination unavailable');
    yield* world.contexts.deny(standing!, failure);
    expect(yield* admittedOf(world)).toBeNull();
    expect(yield* standingOf(world)).toBeNull();
    expect(world.aggregate.transcript).toMatchObject([{ type: 'context-change', status: 'denied', detail: failure.message }]);
    expect(yield* world.contexts.request(runRef, { requestId: 'req-1', sourceKey: 'tree-b' })).toMatchObject({ status: 'denied' });
  }),
);
it.effect(
  'losing process ownership prevents publication without losing the pending request',
  Effect.fnUntraced(function* () {
    const world = yield* contextWorld();
    yield* world.contexts.request(runRef, { requestId: 'req-1', sourceKey: 'tree-b' });
    const standing = yield* standingOf(world);
    world.runs.ownerOfRun = 'another-instance';
    expect(yield* world.contexts.publish(standing!, admitted)).toBe(false);
    expect(yield* admittedOf(world)).toBeNull();
    expect(world.aggregate.transcript).toMatchObject([{ type: 'context-change', status: 'pending' }]);
    expect(world.contexts.holds(runRef.id)).toBe(true);
  }),
);
it.effect(
  'a stop during preparation cannot publish a generation or its commit',
  Effect.fnUntraced(function* () {
    const world = yield* contextWorld();
    let committed = false;
    yield* world.contexts.request(runRef, {
      requestId: 'req-1',
      sourceKey: 'tree-b',
      commit: (tx) =>
        tx.afterCommit(
          Effect.sync(() => {
            committed = true;
          }),
        ),
    });
    const standing = yield* standingOf(world);
    expect(yield* world.contexts.publish(standing!, { ...admitted, halted: () => true })).toBe(false);
    expect(yield* admittedOf(world)).toBeNull();
    expect(committed).toBe(false);
    expect(world.aggregate.transcript).toMatchObject([{ type: 'context-change', status: 'pending' }]);
  }),
);
it.effect(
  'ending a run denies and releases the request it left standing',
  Effect.fnUntraced(function* () {
    const world = yield* contextWorld();
    yield* world.contexts.request(runRef, { requestId: 'req-1', sourceKey: 'tree-b' });
    world.runs.running = false;
    yield* world.contexts.close(runRef);
    expect(world.aggregate.transcript).toMatchObject([{ type: 'context-change', status: 'denied' }]);
    expect(yield* standingOf(world)).toBeNull();
    expect(world.contexts.holds(runRef.id)).toBe(false);
    expect(yield* world.contexts.request(runRef, { requestId: 'req-1', sourceKey: 'tree-b' })).toMatchObject({ status: 'denied' });
  }),
);
it.effect(
  'an admitted generation without persisted evidence refuses composition',
  Effect.fnUntraced(function* () {
    const world = yield* contextWorld();
    yield* world.contexts.request(runRef, { requestId: 'req-1', sourceKey: 'tree-b' });
    yield* world.contexts.publish((yield* standingOf(world))!, admitted);
    const last = world.journal.rows.length - 1;
    const row = world.journal.rows[last]!;
    world.journal.rows[last] = { ...row, payload: { ...row.payload, contextChange: undefined } };
    expect(yield* Effect.flip(world.contexts.read(runRef))).toBeInstanceOf(ThreadCallBroke);
  }),
);
it.effect(
  'two runs may reuse a request id without sharing a generation',
  Effect.fnUntraced(function* () {
    const world = yield* contextWorld();
    yield* world.contexts.request(runRef, { requestId: 'req-1', sourceKey: 'tree-b' });
    yield* world.contexts.publish((yield* standingOf(world))!, admitted);
    const later = { id: 'run-2', threadId: runRef.threadId };
    world.runs.activeRun = later.id;
    expect(yield* world.contexts.request(later, { requestId: 'req-1', sourceKey: 'tree-c' })).toEqual({
      status: 'accepted',
      requestId: 'req-1',
      fromGeneration: 0,
    });
    const standing = (yield* world.contexts.read(later)).standing;
    expect(standing).toMatchObject({ runId: later.id, requestId: 'req-1', context: { generation: 1 } });
    const evidence = { ...admitted.evidence, instructions: 'tree-c instructions' };
    yield* world.contexts.publish(standing!, { ...admitted, evidence });
    expect(world.aggregate.transcript).toMatchObject([
      { type: 'context-change', runId: runRef.id, requestId: 'req-1', status: 'published' },
      { type: 'context-change', runId: later.id, requestId: 'req-1', status: 'published' },
    ]);
    expect(yield* admittedOf(world)).toEqual({
      record: { generation: 1, sourceKey: 'tree-b', requestId: 'req-1' },
      evidence: admitted.evidence,
    });
    expect((yield* world.contexts.read(later)).admitted).toEqual({
      record: { generation: 1, sourceKey: 'tree-c', requestId: 'req-1' },
      evidence,
    });
  }),
);
it.effect(
  'ambiguous plain-joined run and request ids remain separate facts',
  Effect.fnUntraced(function* () {
    const world = yield* contextWorld();
    const first = { id: 'a:b', threadId: runRef.threadId };
    const second = { id: 'a', threadId: runRef.threadId };
    world.runs.activeRun = first.id;
    yield* world.contexts.request(first, { requestId: 'c', sourceKey: 'tree-b' });
    yield* world.contexts.publish((yield* world.contexts.read(first)).standing!, admitted);
    world.runs.activeRun = second.id;
    yield* world.contexts.request(second, { requestId: 'b:c', sourceKey: 'tree-c' });
    const evidence = { ...admitted.evidence, instructions: 'tree-c instructions' };
    yield* world.contexts.publish((yield* world.contexts.read(second)).standing!, { ...admitted, evidence });
    expect(world.aggregate.transcript).toMatchObject([
      { type: 'context-change', runId: first.id, requestId: 'c', status: 'published' },
      { type: 'context-change', runId: second.id, requestId: 'b:c', status: 'published' },
    ]);
    expect((yield* world.contexts.read(first)).admitted).toEqual({
      record: { generation: 1, sourceKey: 'tree-b', requestId: 'c' },
      evidence: admitted.evidence,
    });
    expect((yield* world.contexts.read(second)).admitted).toEqual({
      record: { generation: 1, sourceKey: 'tree-c', requestId: 'b:c' },
      evidence,
    });
  }),
);
it.effect(
  'a previous process ending cannot deny the request held by an adopter',
  Effect.fnUntraced(function* () {
    const world = yield* contextWorld();
    yield* world.contexts.request(runRef, { requestId: 'req-1', sourceKey: 'tree-b' });
    const adopter = yield* contextWorld(world);
    yield* adopter.contexts.deny((yield* standingOf(adopter))!, new Error('asking process left'));
    yield* adopter.contexts.request(runRef, { requestId: 'req-2', sourceKey: 'tree-c' });
    world.runs.running = false;
    yield* world.contexts.close(runRef);
    expect(yield* standingOf(adopter)).toMatchObject({ requestId: 'req-2', held: true });
    expect(adopter.contexts.holds(runRef.id)).toBe(true);
    expect(world.contexts.holds(runRef.id)).toBe(false);
  }),
);
it.effect(
  'a successor restores published evidence and reconciles an inherited unheld request',
  Effect.fnUntraced(function* () {
    const world = yield* contextWorld();
    yield* world.contexts.request(runRef, { requestId: 'req-1', sourceKey: 'tree-b' });
    yield* world.contexts.publish((yield* standingOf(world))!, admitted);
    yield* world.contexts.request(runRef, { requestId: 'req-2', sourceKey: 'tree-c' });
    const successor = yield* contextWorld(world);
    expect(yield* admittedOf(successor)).toEqual({
      record: { generation: 1, sourceKey: 'tree-b', requestId: 'req-1' },
      evidence: admitted.evidence,
    });
    const inherited = yield* standingOf(successor);
    expect(inherited).toMatchObject({ requestId: 'req-2', held: false, fromGeneration: 1 });
    expect(successor.contexts.holds(runRef.id)).toBe(false);
    yield* successor.contexts.deny(inherited!, new Error('asking process left'));
    expect(yield* admittedOf(successor)).toMatchObject({ record: { generation: 1 } });
  }),
);
const runRef = { id: 'run-1', threadId: 'thread-1' };
const admitted = {
  stepNumber: 3,
  halted: () => false,
  evidence: { instructions: 'tree-b instructions', tools: ['read'], profileId: null, approvalMode: 'trust' as const },
};
type DrivenRun = {
  running: boolean;
  ownerOfRun: string;
  activeRun: string;
};
type ContextWorld = Effect.Success<ReturnType<typeof contextWorld>>;
const standingOf = (world: ContextWorld) => Effect.map(world.contexts.read(runRef), (state) => state.standing);
const admittedOf = (world: ContextWorld) => Effect.map(world.contexts.read(runRef), (state) => state.admitted);
const contextWorld = Effect.fnUntraced(function* (
  over: {
    aggregate?: InMemoryAggregateStorage;
    journal?: ReturnType<typeof recordingJournal>;
    runs?: DrivenRun;
  } = {},
) {
  const aggregate = over.aggregate ?? makeAggregateStorage();
  const journal = over.journal ?? recordingJournal();
  const runs = over.runs ?? { running: true, ownerOfRun: 'test-owner', activeRun: runRef.id };
  const unread = () => Effect.die(new Error('This context change does not use this ledger operation.'));
  const ledger = ThreadRunLedger.of({
    runById: unread,
    isRunning: unread,
    activeRun: unread,
    activeRunIn: unread,
    runningOf: unread,
    runsOf: unread,
    latestRuns: unread,
    reapable: unread,
    runningHere: (ids) => Effect.sync(() => (runs.running ? ids : [])),
    latestRun: (id, statuses) =>
      Effect.sync(() => {
        if (!runs.running || id !== runRef.threadId || (statuses !== undefined && !statuses.includes('running'))) return null;
        return runRow(runs.activeRun, { ownerId: runs.ownerOfRun });
      }),
  });
  const context = yield* Layer.build(
    threadRunContextsLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          threadChangesLayer,
          ThreadEntryKinds.layer([]),
          Layer.succeed(ThreadStore, aggregate),
          Layer.succeed(ThreadTransitions, aggregate),
          Layer.succeed(ThreadEventJournal, journal.log),
          Layer.succeed(ThreadRunLedger, ledger),
          Layer.succeed(ThreadOwner, ThreadOwner.of({ id: 'test-owner' })),
        ),
      ),
    ),
  );
  return { contexts: Context.get(context, ThreadRunContexts), aggregate, journal, runs };
});
