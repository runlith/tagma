import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { openMemoryStorage } from '@runlith/agent/thread/conformance/memoryStorage';
import { ServedGraphs, type ServedGraph } from '../../graph/contract/service/serving.js';
import { Tasks } from '../../graph/contract/service/work.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ThreadLookup } from '../contract/service/reads.js';
import { type PendingCopies, WorkPlaces } from '../contract/service/working.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { ThreadPlacement } from '../contract/service/placement.js';
import type { ThreadSummary } from '../list/summary.js';
import type { EventLine } from '../subscriptions/delivery.js';
import { makeHeldTasks } from './heldTasks.js';

const setup = Effect.gen(function* () {
  const memory = yield* openMemoryStorage();
  const summary = Effect.fnUntraced(function* (parentThreadId: string | null) {
    const row = yield* memory.aggregate.insert({ ownerId: 'operator', agentId: 'tagma' });
    const value: ThreadSummary = {
      ...row,
      parentThreadId,
      projectId: 1,
      title: row.id,
      titleOrigin: 'random',
      life: 'idle',
      owes: false,
      scopeBlockUuid: null,
      readerOrderAt: row.createdAt,
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
    };
    return value;
  });
  const parent = yield* summary(null);
  const child = yield* summary(parent.id);
  const threads = new Map([
    [parent.id, parent],
    [child.id, child],
  ]);
  const owners = new Map([
    ['/main', child.id],
    ['/branch', child.id],
  ]);
  const notices: EventLine[] = [];
  let unreadable = false;
  let filedAt = 0;
  const lookup = yield* ThreadLookup.pipe(
    Effect.provide(
      Layer.mock(ThreadLookup, {
        summary: (id) => Effect.sync(() => threads.get(id)),
        summaries: (ids) => Effect.sync(() => ids.flatMap((id) => (threads.has(id) ? [threads.get(id)!] : []))),
      }),
    ),
  );
  const handed: PendingCopies[] = [];
  const places = yield* WorkPlaces.pipe(
    Effect.provide(
      Layer.mock(WorkPlaces, {
        taking: () => Effect.succeed({ copies: [{ projectId: 1, root: '/branch' }], through: new Date(0) }),
        handed: (_threadId, pending) =>
          Effect.sync(() => {
            handed.push(pending);
          }),
      }),
    ),
  );
  const placement = yield* ThreadPlacement.pipe(
    Effect.provide(
      Layer.mock(ThreadPlacement, {
        rootsOf: () => Effect.succeed([]),
      }),
    ),
  );
  const copy = Effect.fnUntraced(function* (checkout: string) {
    const task = { name: checkout === '/main' ? '11111111' : '22222222', title: 'Work in this copy' };
    const tasks = yield* Tasks.pipe(
      Effect.provide(
        Layer.mock(Tasks, {
          holdings: ({ from }) =>
            Effect.sync(() => ({
              held: owners.get(checkout) === from.key ? [task] : [],
              filed: [{ name: '33333333', title: 'Open work', changedAt: filedAt }],
            })),
          handOver: ({ from, to }) =>
            Effect.sync(() => {
              if (owners.get(checkout) !== from.key) return [];
              owners.set(checkout, to?.key ?? 'open');
              return [task];
            }),
        }),
      ),
    );
    const served: ServedGraph = {
      projectId: 1,
      checkout,
      shadow: null,
      stealth: null,
      git: { run: () => Effect.die('held task decisions do not run git') },
      layout: { mode: 'team', treeRoot: checkout, mirrorPath: `${checkout}/mirror` },
      context: Context.makeUnsafe(new Map([[Tasks.key, tasks]])),
      fresh: () => Effect.void,
      settled: () => Effect.void,
      copyFailures: () => Effect.succeed([]),
      dispose: () => Effect.void,
    };
    return served;
  });
  const main = yield* copy('/main');
  const branch = yield* copy('/branch');
  const held = yield* makeHeldTasks({
    threads: lookup,
    places,
    placement,
    lines: (line) =>
      Effect.sync(() => {
        notices.push(line);
      }),
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ServedGraphs, {
          hold: ({ cwd }) =>
            unreadable
              ? Effect.fail(new GateRefusal('not-found', 'The graph copy is unavailable.', ['restore its project']))
              : Effect.succeed(cwd === '/main' ? main : branch),
          held: () => [],
          copies: { subscribe: () => () => {} },
        }),
        Layer.mock(Projects, {
          byId: (id) => Effect.succeed({ id, name: 'home', repoKey: 'home', rootPath: '/main', createdAt: new Date(0), global: false }),
          removed: () => Effect.succeed([]),
        }),
      ),
    ),
  );
  return {
    parent,
    child,
    threads,
    owners,
    notices,
    handed,
    held: held.service,
    rested: (runId: string) =>
      held.recipient.handle({
        kind: 'rested',
        thread: child,
        run: { runId, threadId: child.id, kind: 'turn', status: 'completed', failureReason: null, failure: null, stoppedBy: null },
        words: null,
        byOperator: false,
      }),
    unreadable: () => {
      unreadable = true;
    },
    reopened: () => {
      filedAt += 1;
    },
  };
});

it.effect('leaving hands work from every graph copy to the living parent and names it and the open work in non-waking notices', () =>
  Effect.gen(function* () {
    const world = yield* setup;
    yield* world.held.left([world.child.id]);
    expect([...world.owners.values()]).toEqual([world.parent.id, world.parent.id]);
    expect(world.notices.map((line) => ['11111111', '22222222', '33333333'].filter((name) => line.text.includes(name)))).toEqual([
      ['11111111', '22222222'],
      ['33333333'],
    ]);
    for (const line of world.notices) {
      expect(line).toMatchObject({
        subscriberId: world.parent.id,
        about: world.child.id,
        wakes: false,
        notice: { kind: 'child-update', child: { threadId: world.child.id }, event: 'tasks' },
      });
    }
  }),
);

it.effect('a child resting again names unchanged open work under the line its parent already received, and changed work anew', () =>
  Effect.gen(function* () {
    const world = yield* setup;
    const ids = () =>
      new Set(world.notices.filter((line) => line.text.includes('33333333')).map((line) => `${line.type}:${line.about}:${line.key}`));
    yield* world.rested('run-1');
    yield* world.rested('run-2');
    expect(ids().size).toBe(1);
    world.reopened();
    yield* world.rested('run-3');
    expect(ids().size).toBe(2);
  }),
);

it.effect('a root releases the work it owns when it leaves', () =>
  Effect.gen(function* () {
    const world = yield* setup;
    world.owners.set('/main', world.parent.id);
    world.owners.set('/branch', world.parent.id);
    yield* world.held.left([world.parent.id]);
    expect([...world.owners.values()]).toEqual(['open', 'open']);
    expect(world.notices).toEqual([]);
  }),
);

it.effect('an archived parent receives no work or notice', () =>
  Effect.gen(function* () {
    const world = yield* setup;
    world.threads.set(world.parent.id, { ...world.parent, archivedAt: world.parent.createdAt });
    yield* world.held.left([world.child.id]);
    expect([...world.owners.values()]).toEqual(['open', 'open']);
    expect(world.notices).toEqual([]);
  }),
);

it.effect('ending the family releases its tasks instead of handing them to a parent that is also leaving', () =>
  Effect.gen(function* () {
    const world = yield* setup;
    yield* world.held.left([world.child.id, world.parent.id]);
    expect([...world.owners.values()]).toEqual(['open', 'open']);
    expect(world.notices).toEqual([]);
  }),
);

it.effect('an unreadable graph copy refuses the ending without relinquishing its tasks', () =>
  Effect.gen(function* () {
    const world = yield* setup;
    world.unreadable();
    expect(yield* Effect.flip(world.held.left([world.child.id]))).toMatchObject({ code: 'thread-tasks-unreadable' });
    expect([...world.owners.values()]).toEqual([world.child.id, world.child.id]);
    expect(world.notices).toEqual([]);
  }),
);
