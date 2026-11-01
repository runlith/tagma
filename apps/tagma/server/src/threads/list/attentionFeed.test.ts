import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import type { ProjectChanges } from '../../projects/contract/service/changes.js';
import type { Projects } from '../../projects/contract/service/registry.js';
import type { AttentionEvent, ThreadList } from '../contract/service/list.js';
import { attentionChanges, attentionFeed } from './attentionFeed.js';
import type { ThreadListProjection, ThreadSummary } from './summary.js';

function unused(): never {
  throw new Error('This operation is outside the attention feed.');
}

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 4, 12, minute));

const failed = (id: string, minute: number, over: { seen?: boolean; ownerId?: string } = {}): ThreadSummary =>
  ({
    id,
    ownerId: over.ownerId ?? 'operator',
    archivedAt: null,
    ask: null,
    activeRun: null,
    parentThreadId: null,
    projectId: 1,
    title: id,
    name: null,
    updatedAt: at(minute),
    outcome: {
      runId: `run-${id}`,
      status: 'failed',
      failureReason: 'refused',
      failure: null,
      hostStateFailure: false,
      provider: null,
      model: null,
      reasoning: null,
      finishedAt: at(minute),
      isSeen: over.seen ?? false,
    },
  }) as unknown as ThreadSummary;

function rig(rows: readonly ThreadSummary[], window: number) {
  const listeners = new Set<(event: AttentionEvent) => void>();
  const list: ThreadList['Service'] = {
    attention: () => Effect.succeed(rows),
    pulse: unused,
    subscribeAttention: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    observe: unused,
    list: unused,
    listWindow: unused,
    openWindow: unused,
    row: unused,
    subscribe: unused,
    announce: unused,
    announceThread: unused,
    announceFolders: unused,
    resync: unused,
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
  };
  let registered = [{ id: 1, name: 'proj' }];
  const registryChanged = new Set<Effect.Effect<void>>();
  const projects: Projects['Service'] = {
    list: () => Effect.sync(() => registered as never),
    registryVersion: Effect.sync(() => registered.length),
    byId: unused,
    named: unused,
    resolve: unused,
    global: unused,
    removed: unused,
    register: unused,
    setRoot: unused,
    rename: unused,
    remove: unused,
    forget: unused,
  };
  const registry: ProjectChanges['Service'] = {
    removed: { publish: unused, subscribe: () => () => {} },
    grouped: { subscribe: () => () => {} },
    changed: {
      publish: unused,
      subscribe: (subscriber) => {
        registryChanged.add(subscriber);
        return () => registryChanged.delete(subscriber);
      },
    },
  };
  return {
    stream: attentionFeed(attentionChanges(list, projects, registry, 64), window),
    changes: attentionChanges(list, projects, registry, 64),
    row: (summary: ThreadSummary) => listeners.forEach((listener) => listener({ kind: 'row', row: summary as ThreadListProjection })),
    removed: (threadId: string) => listeners.forEach((listener) => listener({ kind: 'removed', threadId })),
    removeProject: Effect.suspend(() => {
      registered = [];
      return Effect.forEach([...registryChanged], (subscriber) => subscriber, { discard: true });
    }),
  };
}

it.live('the window holds the newest rows, a removal refills it, and the total follows every change', () =>
  Effect.gen(function* () {
    const feed = rig([failed('a', 1), failed('b', 2), failed('c', 3)], 2);
    const next = yield* Stream.toPull(feed.stream);
    const ids = (event: { rows: readonly { threadId: string }[] } | undefined) => event?.rows.map((row) => row.threadId);

    const opened = (yield* next)[0];
    expect(opened).toMatchObject({ type: 'list', total: 3 });
    expect(opened?.type === 'list' ? ids(opened) : null).toEqual(['c', 'b']);

    feed.row(failed('c', 3, { seen: true }));
    const refilled = (yield* next)[0];
    expect(refilled).toMatchObject({ type: 'change', removed: ['c'], total: 2 });
    expect(refilled?.type === 'change' ? ids(refilled) : null).toEqual(['a']);

    feed.row(failed('d', 0));
    expect(yield* next).toMatchObject([{ type: 'change', rows: [], removed: [], total: 3 }]);

    feed.row(failed('agent-thread', 9, { ownerId: 'agent' }));
    feed.row(failed('e', 9));
    const evicting = (yield* next)[0];
    expect(evicting).toMatchObject({ type: 'change', removed: ['a'], total: 4 });
    expect(evicting?.type === 'change' ? ids(evicting) : null).toEqual(['e']);

    feed.removed('b');
    expect((yield* next)[0]).toMatchObject({ type: 'change', removed: ['b'], total: 3 });
  }),
);

it.live('a project removed from Tagma takes its threads out of an open attention feed and keeps them out', () =>
  Effect.gen(function* () {
    const feed = rig([failed('a', 1)], 10);
    const next = yield* Stream.toPull(feed.changes);
    expect(yield* next).toMatchObject([{ _tag: 'all', rows: [{ threadId: 'a' }] }]);

    yield* feed.removeProject;
    expect(yield* next).toEqual([{ _tag: 'all', rows: [] }]);
    feed.row(failed('b', 2));
    expect(yield* next).toEqual([{ _tag: 'gone', threadId: 'b' }]);
  }),
);

const asking = (id: string, questionId: string, title = id): ThreadSummary =>
  ({
    ...failed(id, 1),
    title,
    outcome: null,
    activeRun: { id: `run-${id}`, startedAt: at(0) },
    ask: { questionId, text: 'Ship it?', kind: 'question', key: 'k', askedAt: at(5).toISOString(), options: [] },
  }) as unknown as ThreadSummary;

it.live('an attention event keeps its id across a rename and an archive, and a new question with the same words is a new event', () =>
  Effect.gen(function* () {
    const feed = rig([failed('a', 1), asking('b', 'q1')], 10);
    const next = yield* Stream.toPull(feed.changes);
    const opened = (yield* next)[0];
    const events = opened?._tag === 'all' ? opened.rows.map((row) => [row.threadId, row.eventId, row.at]) : null;
    expect(events).toEqual([
      ['b', 'run-b:q1', at(5).toISOString()],
      ['a', 'run-a:failed', at(1).toISOString()],
    ]);

    feed.row({ ...failed('a', 1), title: 'renamed', updatedAt: at(30) } as ThreadSummary);
    expect(yield* next).toMatchObject([
      { _tag: 'put', row: { threadId: 'a', title: 'renamed', eventId: 'run-a:failed', at: at(1).toISOString() } },
    ]);

    feed.row({ ...failed('a', 1), archivedAt: at(31) } as ThreadSummary);
    expect(yield* next).toEqual([{ _tag: 'gone', threadId: 'a' }]);
    feed.row(failed('a', 1));
    expect(yield* next).toMatchObject([{ _tag: 'put', row: { eventId: 'run-a:failed' } }]);

    feed.row(asking('b', 'q2'));
    expect(yield* next).toMatchObject([{ _tag: 'put', row: { threadId: 'b', eventId: 'run-b:q2', ask: { text: 'Ship it?' } } }]);
  }),
);
