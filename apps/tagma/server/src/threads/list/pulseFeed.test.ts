import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { NATIVE_BINDING, NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import { ThreadList, type AttentionEvent } from '../contract/service/list.js';
import { pulseFeed } from './pulseFeed.js';
import type { ThreadSummary } from './summary.js';

const at = new Date('2026-10-15T00:00:00.000Z');
const row = (id: string, projectId: number, life: ThreadSummary['life'] = 'working'): ThreadSummary => ({
  id,
  projectId,
  life,
  owes: false,
  ownerId: 'operator',
  agentId: 'agent',
  parentThreadId: null,
  spawnedByRunId: null,
  bornOf: null,
  spawnRootId: id,
  cacheGroup: id,
  name: null,
  budgetTokens: null,
  profile: null,
  authority: { mode: 'trust', bypassFrom: null },
  plain: false,
  hostKind: null,
  hostId: null,
  bindings: {},
  pendingInteraction: null,
  account: null,
  provider: 'openai-oauth',
  model: null,
  reasoning: null,
  switches: {},
  status: 'idle',
  failureReason: null,
  contextReading: null,
  createdBy: null,
  createdAt: at,
  updatedAt: at,
  transport: NATIVE_BINDING,
  capabilities: NATIVE_CAPABILITIES,
  title: id,
  titleOrigin: 'random',
  scopeBlockUuid: null,
  readerOrderAt: at,
  liveSpellStartedAt: null,
  pinnedAt: null,
  folderId: null,
  archivedAt: null,
  detachedFrom: null,
  createdBySessionId: null,
  harness: null,
  activeRun: null,
  outcome: null,
  ask: null,
  saidLine: null,
  recap: null,
});

function unused(): never {
  throw new Error('Outside the pulse source contract.');
}

function source(initial: readonly ThreadSummary[]) {
  const rows = new Map(initial.map((row) => [row.id, row]));
  const listeners = new Set<(event: AttentionEvent) => void>();
  const emit = (event: AttentionEvent) => listeners.forEach((listener) => listener(event));
  const list = ThreadList.of({
    pulse: () => Effect.sync(() => [...rows.values()]),
    subscribeAttention: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    announce: (summary) => {
      rows.set(summary.id, summary);
      const row = { ...summary, phase: null, held: { paths: 0, unproven: 0 } };
      emit({ kind: 'row', row });
      return row;
    },
    resync: () => emit({ kind: 'resync' }),
    attention: unused,
    observe: unused,
    list: unused,
    listWindow: unused,
    openWindow: unused,
    row: unused,
    subscribe: unused,
    announceThread: unused,
    announceFolders: unused,
    markHeld: unused,
    relation: unused,
    working: unused,
    sweepRelation: unused,
    serveArchiving: unused,
    serveCuts: unused,
    setArchived: unused,
    setArchivedMatching: unused,
    setPinned: unused,
    see: unused,
  });
  return {
    list,
    remove: (threadId: string) => {
      rows.delete(threadId);
      emit({ kind: 'removed', threadId });
    },
  };
}

it.effect('only a changed contribution emits counts, and moves and removal update both homes without drift', () =>
  Effect.gen(function* () {
    const { list, remove } = source([row('a', 1), row('b', 1, 'stalled'), { ...row('agent', 2), ownerId: 'other' }]);
    const next = yield* Stream.toPull(pulseFeed(list, 8));
    expect(yield* next).toEqual([{ type: 'all', projects: [{ projectId: 1, working: 2, awaiting: 0 }] }]);
    list.announce({ ...row('a', 1), title: 'renamed' });
    list.announce(row('a', 1, 'stalled'));
    list.announce(row('a', 2));
    expect(yield* next).toEqual([
      { type: 'changed', projectId: 1, working: 1, awaiting: 0 },
      { type: 'changed', projectId: 2, working: 1, awaiting: 0 },
    ]);
    remove('a');
    expect(yield* next).toEqual([{ type: 'changed', projectId: 2, working: 0, awaiting: 0 }]);
    remove('a');
    list.announce({ ...row('b', 1), archivedAt: at });
    expect(yield* next).toEqual([{ type: 'changed', projectId: 1, working: 0, awaiting: 0 }]);
  }),
);

it.effect('questions without a run and running questions count only as awaiting, while other owners and archives leave the totals', () =>
  Effect.gen(function* () {
    const ask = { questionId: 'approval:a', text: 'Proceed?', kind: 'confirm', key: 'a', askedAt: at.toISOString(), options: [] } as const;
    const standing = { ...row('a', 1, 'idle'), ask };
    const running = row('b', 1);
    const { list } = source([standing, running]);
    const next = yield* Stream.toPull(pulseFeed(list, 8));
    expect(yield* next).toEqual([{ type: 'all', projects: [{ projectId: 1, working: 1, awaiting: 1 }] }]);
    list.announce({ ...running, ask });
    expect(yield* next).toEqual([{ type: 'changed', projectId: 1, working: 0, awaiting: 2 }]);
    list.announce({ ...standing, ownerId: 'other' });
    expect(yield* next).toEqual([{ type: 'changed', projectId: 1, working: 0, awaiting: 1 }]);
    list.announce({ ...running, ask, archivedAt: at });
    expect(yield* next).toEqual([{ type: 'changed', projectId: 1, working: 0, awaiting: 0 }]);
  }),
);

it.effect('a change during the initial read follows its snapshot, and overflow and resync replace the totals', () =>
  Effect.gen(function* () {
    const { list } = source([row('a', 1)]);
    const read = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let first = true;
    const delayed = ThreadList.of({
      ...list,
      pulse: Effect.fnUntraced(function* () {
        const rows = yield* list.pulse();
        if (first) {
          first = false;
          yield* Deferred.succeed(read, undefined);
          yield* Deferred.await(release);
        }
        return rows;
      }),
    });
    const next = yield* Stream.toPull(pulseFeed(delayed, 2));
    const opening = yield* Effect.forkChild(next);
    yield* Deferred.await(read);
    list.announce(row('a', 1, 'idle'));
    yield* Deferred.succeed(release, undefined);
    expect(yield* Fiber.join(opening)).toEqual([{ type: 'all', projects: [{ projectId: 1, working: 1, awaiting: 0 }] }]);
    expect(yield* next).toEqual([{ type: 'changed', projectId: 1, working: 0, awaiting: 0 }]);

    list.announce(row('a', 1));
    list.announce(row('a', 2));
    list.announce(row('a', 2, 'idle'));
    expect(yield* next).toEqual([{ type: 'all', projects: [] }]);

    list.resync();
    list.announce(row('a', 2));
    expect(yield* next).toEqual([{ type: 'all', projects: [{ projectId: 2, working: 1, awaiting: 0 }] }]);
    list.announce(row('a', 2, 'idle'));
    expect(yield* next).toEqual([{ type: 'changed', projectId: 2, working: 0, awaiting: 0 }]);
  }),
);
