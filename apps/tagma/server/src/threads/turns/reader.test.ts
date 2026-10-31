import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Brand, Effect, Layer, Schema } from 'effect';
import { openMemoryStorage } from '@runlith/agent/thread/conformance/memoryStorage';
import type { ThreadEnvelopeInput } from '@runlith/agent/collaboration/ThreadEnvelopes';
import type { ThreadSaid } from '@runlith/agent/thread/run/scheduler/inputs';
import { Settings } from '../../settings/contract/service/values.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { ThreadRecordFacts } from '../../thread-record/contract/wire/record.js';
import type { HarnessId } from '../../platform/contract/wire/session.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { writes } from '../../platform/contract/service/writes.js';
import { ThreadHarness } from '../contract/service/engine.js';
import { ThreadList } from '../contract/service/list.js';
import { ThreadLookup, ThreadReading } from '../contract/service/reads.js';
import { ThreadMandate } from '../contract/service/mandate.js';
import { makeReaderMarks } from './reader.js';
import type { ThreadMetadata } from '../list/store.js';

const unused = (): never => {
  throw new Error('outside operator-notice selection');
};

const unpinned = (id: string): ThreadRecordFacts => ({
  id: ThreadId.make(id),
  projectId: 1,
  origin: 'scoped',
  parentId: ThreadId.make('parent'),
  spawnRootId: ThreadId.make('parent'),
  detachedFrom: null,
  detachedAt: null,
  principalId: 'operator',
  name: null,
  title: id,
  titleProvenance: 'manual',
  titleRevision: 0,
  harness: Brand.nominal<HarnessId>()('tagma'),
  agentId: 'tagma',
  bornOf: null,
  spawnedByRunId: null,
  createdBy: 'operator',
  scopeBlockUuid: null,
  createdBySessionId: null,
  readerOrderAt: new Date(0),
  pinnedAt: null,
  archivedAt: null,
  status: 'idle',
  runningRunId: null,
  recap: null,
  createdAt: new Date(0),
});

const setup = Effect.gen(function* () {
  const memory = yield* openMemoryStorage();
  const row = yield* memory.aggregate.insert({ ownerId: 'operator', agentId: 'tagma' });
  let child: ThreadMetadata = { ...row, parentThreadId: 'parent', projectId: 1, scopeBlockUuid: null, harness: null };
  let own: boolean | null = null;
  let pinnable = false;
  const values = new Map<string, unknown>([['agent.takeover', false]]);
  const inboxes = new Map<string, Map<string, ThreadEnvelopeInput>>();
  const reader = yield* makeReaderMarks.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ThreadHarness, {
          inputs: {
            deliver: (threadId, _ownerId, envelope) =>
              Effect.sync(() => {
                const inbox = inboxes.get(threadId) ?? new Map<string, ThreadEnvelopeInput>();
                inbox.set(envelope.id, envelope);
                inboxes.set(threadId, inbox);
                return {
                  envelopeId: envelope.id,
                  intent: envelope.intent,
                  status: 'stored' as const,
                  runId: null,
                  acted: true,
                  recipient: { threadId, projectId: 1, name: null, sameTeam: true },
                };
              }),
          },
          threads: { handle: unused, create: unused, duplicate: unused, deleteByHost: unused, publish: unused },
          runs: {
            recover: unused,
            recoverNow: unused,
            ownership: unused,
            hosting: unused,
            questions: unused,
            onDriving: unused,
            redeliver: unused,
            parked: unused,
            transports: unused,
            reports: unused,
            ledger: unused,
            settlements: unused,
            guidance: unused,
            history: unused,
          },
          reads: {
            snapshot: unused,
            statuses: unused,
            endings: unused,
            newestEndings: unused,
            page: unused,
            attachFrom: unused,
            shape: unused,
            composition: unused,
            window: unused,
            cacheCurves: unused,
            pin: unused,
            query: unused,
            entryAt: unused,
            entryNamed: unused,
            steps: unused,
            requests: unused,
            subscribe: unused,
            openView: unused,
            subscribeStates: unused,
          },
          collaboration: { spawn: unused, collaborate: unused },
          workflows: { start: unused, advance: unused },
        }),
        Layer.mock(ThreadLookup, { find: (id) => Effect.succeed(id === child.id ? child : undefined) }),
        Layer.mock(ThreadReading, {}),
        Layer.mock(ThreadMandate, { operatorNotice: () => Effect.sync(() => own) }),
        Layer.mock(Settings, {
          value: (key) => Schema.decodeUnknownEffect(key.schema)(values.get(key.id) ?? key.fallback).pipe(Effect.orDie),
        }),
        Layer.mock(ThreadRecords, {
          writes: writes('reader-test', []),
          facts: (id) => Effect.succeed(pinnable && id === child.id ? unpinned(id) : undefined),
          birthRecorded: unused,
          removalRecorded: unused,
          titleRecorded: unused,
          statusPublished: unused,
          shelfRecorded: unused,
        }),
        Layer.mock(ThreadList, {
          subscribeAttention: unused,
          observe: unused,
          subscribe: unused,
          announce: unused,
          announceFolders: unused,
          resync: unused,
          serveArchiving: unused,
          serveOpenCalls: unused,
          setPinned: () => Effect.die(new Error('the store refused the pin')),
        }),
      ),
    ),
  );
  return {
    child,
    reader,
    values,
    inboxes,
    own: (value: boolean | null) => {
      own = value;
    },
    pinnable: () => {
      pinnable = true;
    },
    root: () => {
      child = { ...child, parentThreadId: null };
    },
  };
});

const accepted: readonly ThreadSaid[] = [
  { status: 'started', runId: 'run', entry: { type: 'message', id: 'started' } },
  { status: 'queued', runId: 'run', queued: { id: 'queued', runId: 'run', text: 'words', occurredAt: '2026-10-24T00:00:00Z' } },
  { status: 'steered', runId: 'run', itemId: 'steered' },
];

it.effect('project notice selection publishes each accepted input to the parent, including queued and steered words', () =>
  Effect.gen(function* () {
    const world = yield* setup;
    yield* world.reader.spoke(world.child.id, 1, 'words', accepted[0]!);
    expect(world.inboxes.size).toBe(0);
    world.values.set('agent.operatorNotice', true);
    for (const said of accepted) yield* world.reader.spoke(world.child.id, 1, 'words', said);
    const inbox = world.inboxes.get('parent')!;
    expect([...inbox.keys()]).toEqual(['started', 'queued', 'steered'].map((id) => `operator-message:${world.child.id}:${id}`));
    expect([...inbox.values()].map(({ senderThreadId, intent }) => ({ senderThreadId, intent }))).toEqual([
      { senderThreadId: null, intent: 'message' },
      { senderThreadId: null, intent: 'message' },
      { senderThreadId: null, intent: 'message' },
    ]);
  }),
);

it.effect('the child override wins over both project defaults and null restores inheritance', () =>
  Effect.gen(function* () {
    const world = yield* setup;
    world.values.set('agent.operatorNotice', true);
    world.own(false);
    yield* world.reader.spoke(world.child.id, 1, 'words', accepted[0]!);
    expect(world.inboxes.size).toBe(0);
    world.values.set('agent.operatorNotice', false);
    world.own(true);
    yield* world.reader.spoke(world.child.id, 1, 'words', accepted[0]!);
    expect(world.inboxes.get('parent')?.size).toBe(1);
    world.own(null);
    yield* world.reader.spoke(world.child.id, 1, 'words', accepted[1]!);
    expect(world.inboxes.get('parent')?.size).toBe(1);
    world.values.set('agent.operatorNotice', true);
    yield* world.reader.spoke(world.child.id, 1, 'words', accepted[1]!);
    expect(world.inboxes.get('parent')?.size).toBe(2);
  }),
);

it.effect('a pin the store refuses still lets the parent notice through', () =>
  Effect.gen(function* () {
    const world = yield* setup;
    world.values.set('agent.operatorNotice', true);
    world.pinnable();
    yield* world.reader.spoke(world.child.id, 1, 'words', accepted[0]!);
    expect([...(world.inboxes.get('parent')?.keys() ?? [])]).toEqual([`operator-message:${world.child.id}:started`]);
  }),
);

it.effect('accepted words on a root or a missing thread notify no parent', () =>
  Effect.gen(function* () {
    const world = yield* setup;
    world.values.set('agent.operatorNotice', true);
    world.own(true);
    world.root();
    yield* world.reader.spoke(world.child.id, 1, 'words', accepted[0]!);
    yield* world.reader.spoke('missing', 1, 'words', accepted[0]!);
    expect(world.inboxes.size).toBe(0);
  }),
);
