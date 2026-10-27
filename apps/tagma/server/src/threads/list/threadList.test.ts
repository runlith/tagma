import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Brand, Deferred, Effect, Layer, Queue } from 'effect';
import { newLaunchGate } from '@runlith/agent/thread/AgentHarness';
import { makeThreadLiveFeed } from '@runlith/agent/thread/run/ThreadLiveFeed';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { HarnessId } from '../../platform/contract/wire/session.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { NativeThreadState } from '../contract/service/state.js';
import { ThreadLookup, ThreadWindows, ThreadRunning, ThreadShelving, ThreadReading } from '../contract/service/reads.js';
import { ThreadLive, ThreadLaunchGate } from '../contract/service/engine.js';
import { ThreadRollouts } from '../contract/service/rollouts.js';
import { ThreadReleasing } from '../contract/service/releasing.js';
import { HeldPathCounts } from '../contract/service/parts.js';
import { makeThreadList } from './threadList.js';
import type { ThreadSummary } from './summary.js';

const summary = {
  id: 'thread',
  projectId: 1,
  archivedAt: null,
  parentThreadId: null,
  ownerId: 'operator',
  activeRun: null,
  outcome: null,
} as unknown as ThreadSummary;
const unused = (): never => {
  throw new Error('the list reached an unrelated synchronous service member');
};

const opened = Effect.fnUntraced(function* (source?: 'resource' | 'commands') {
  let stamped = 0;
  let held = 0;
  const reading = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  let emit: (state: NativeThreadState) => void = unused;
  const feed = yield* makeThreadLiveFeed<NativeThreadState>();
  const live = {
    ...feed,
    subscribeStates: (listener: (state: NativeThreadState) => void) => {
      emit = listener;
      return () => {
        emit = unused;
      };
    },
  };
  const gate = newLaunchGate();
  const list = yield* makeThreadList.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ThreadLookup, { summary: () => Effect.succeed(summary) }),
        Layer.mock(ThreadWindows, {
          rootWindow: () =>
            Deferred.succeed(reading, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as({ rows: [summary], roots: 1, windowBefore: null }),
            ),
        }),
        Layer.mock(ThreadRunning, {
          heldSessionsInSubtree: () =>
            Effect.succeed([{ runId: 'run-1', threadId: 'thread', kind: 'harness', harness: Brand.nominal<HarnessId>()('claude-code') }]),
        }),
        Layer.mock(ThreadShelving, {
          setArchived: () =>
            Effect.sync(() => {
              stamped += 1;
              return ['thread'];
            }),
        }),
        Layer.mock(ThreadReading, {}),
        Layer.mock(ThreadRecords, {
          projectOf: () => Effect.succeed(1),
          subtree: () => Effect.succeed([ThreadId.make('thread')]),
          writes: writes('list-test', []),
          birthRecorded: () => () => {},
          removalRecorded: () => () => {},
          titleRecorded: unused,
          statusPublished: unused,
          shelfRecorded: unused,
        }),
        Layer.succeed(ThreadLive, live),
        Layer.succeed(ThreadLaunchGate, gate),
        Layer.mock(ThreadRollouts, { pathOf: unused, appendRecord: unused, queueMeta: unused, shelve: unused, formRested: unused }),
        Layer.succeed(HeldPathCounts, {
          counts: () => Effect.sync(() => new Map([['thread', { paths: held, unproven: 0 }]])),
          moved: () => Effect.sync(() => new Map([['thread', { paths: held, unproven: 0 }]])),
        }),
        Layer.succeed(ThreadReleasing, {
          release: () =>
            source === 'resource'
              ? Effect.fail(new GateRefusal('session-uncertain', 'The agent process ending is unknown.', ['read the thread state']))
              : Effect.succeed('not-running' as const),
          serve: unused,
        }),
      ),
    ),
  );
  return {
    list,
    gate,
    reading,
    release,
    hold: (paths: number) => {
      held = paths;
    },
    stamped: () => stamped,
    emit: (state: NativeThreadState) => emit(state),
  };
});

it.effect.each(['resource', 'commands'] as const)('an archive whose %s closure fails stamps nothing', (source) =>
  Effect.gen(function* () {
    const world = yield* opened(source);
    world.list.serveArchiving((_ids, work) =>
      work(() =>
        source === 'commands'
          ? Effect.fail(new GateRefusal('thread-commands-standing', 'Command cleanup is not confirmed.', ['read the command']))
          : Effect.void,
      ),
    );
    expect(yield* Effect.flip(world.list.setArchived('thread', 1, true))).toMatchObject({
      code: source === 'commands' ? 'thread-commands-standing' : 'session-uncertain',
    });
    expect(world.stamped()).toBe(0);
  }),
);

it.effect('resync publishes its window before row frames announced while it reads', () =>
  Effect.gen(function* () {
    const { list, reading, release } = yield* opened();
    const events = yield* Effect.acquireRelease(Queue.unbounded<string>(), Queue.shutdown);
    const stop = list.subscribe(1, (event) => {
      Queue.offerUnsafe(events, event.kind);
    });
    yield* Effect.addFinalizer(() => Effect.sync(stop));
    list.resync();
    yield* Deferred.await(reading);
    list.announce(summary);
    yield* Deferred.succeed(release, undefined);
    expect([yield* Queue.take(events), yield* Queue.take(events)]).toEqual(['list', 'row']);
  }),
);

it.effect('changed held-path counts publish the row and a cleared count replaces the held value', () =>
  Effect.gen(function* () {
    const { list, hold, release } = yield* opened();
    const events = yield* Effect.acquireRelease(Queue.unbounded<number>(), Queue.shutdown);
    const stop = list.subscribe(1, (event) => {
      if (event.kind === 'row') Queue.offerUnsafe(events, event.row.held.paths);
    });
    yield* Effect.addFinalizer(() => Effect.sync(stop));
    hold(1);
    yield* Deferred.succeed(release, undefined);
    yield* list.openWindow(1);
    expect(yield* Queue.take(events)).toBe(1);
    hold(0);
    yield* list.markHeld('thread');
    expect(yield* Queue.take(events)).toBe(0);
    expect((yield* list.row('thread'))?.held.paths).toBe(0);
  }),
);

it.effect('a launch block reaches the announced thread row and lifting it clears that row', () =>
  Effect.gen(function* () {
    const world = yield* opened();
    const first = yield* Deferred.make<boolean>();
    const second = yield* Deferred.make<boolean>();
    let count = 0;
    world.list.subscribe(1, (event) => {
      if (event.kind !== 'row') return;
      count += 1;
      Deferred.doneUnsafe(count === 1 ? first : second, Effect.succeed(event.row.launchBlocked === true));
    });
    const state = {
      thread: { id: 'thread', ownerId: 'operator' },
      activeRun: null,
      latestRun: null,
      status: {},
    } as unknown as NativeThreadState;
    while (!world.gate.blocked('thread')) world.gate.refused('thread');
    world.emit(state);
    const blocked = yield* Deferred.await(first);
    world.gate.lift('thread');
    world.emit(state);
    expect([blocked, yield* Deferred.await(second)]).toEqual([true, false]);
  }),
);
