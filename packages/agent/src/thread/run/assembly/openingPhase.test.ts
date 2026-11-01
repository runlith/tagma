import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import type { AgentPhase, AgentWaiting } from '../../../agent/AgentPhase';
import { APPROVAL, lifecycleWorld, started } from '../../conformance/lifecycleWorld';
import { openMemoryStorage } from '../../conformance/memoryStorage';
import { openingPhase } from './openingPhase';
const SETUP: AgentWaiting = { reason: 'setup', place: 'tagma-exp-classes-d74152' };
const opened = Effect.gen(function* () {
  const world = yield* lifecycleWorld(openMemoryStorage, 30_000, 60_000);
  const { run } = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' }));
  const published: (AgentPhase | null)[] = [];
  world.feed.subscribe(run.threadId, (event) => {
    if (event.type === 'open' && event.change.op === 'progress') published.push(event.change.progress?.phase ?? null);
  });
  const progress = world.progress;
  yield* TestClock.adjust('10 seconds');
  const { waitingOn } = yield* openingPhase(progress, run);
  return { run, progress, waitingOn, published, shown: () => world.feed.view(run.threadId).progress?.phase ?? null };
});
it.effect(
  'a wait that outlasts the grace names what the opening waits on from its own start, then gives the opening back',
  Effect.fnUntraced(function* () {
    const { waitingOn, shown } = yield* opened;
    expect(shown()).toEqual({ phase: 'opening', since: 10_000 });
    yield* TestClock.adjust('2 seconds');
    const release = yield* Deferred.make<void>();
    const waiting = yield* Effect.forkChild(waitingOn(SETUP, Deferred.await(release)));
    yield* TestClock.adjust('1500 millis');
    expect(shown()).toEqual({ phase: 'opening', since: 12_000, waiting: SETUP });
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(waiting);
    expect(shown()).toEqual({ phase: 'opening', since: 13_500 });
  }),
);
it.effect(
  'a wait shorter than the grace publishes nothing of itself',
  Effect.fnUntraced(function* () {
    const { waitingOn, published } = yield* opened;
    const release = yield* Deferred.make<void>();
    const waiting = yield* Effect.forkChild(waitingOn(SETUP, Deferred.await(release)));
    yield* TestClock.adjust('900 millis');
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(waiting);
    expect(published).toEqual([{ phase: 'opening', since: 10_000 }]);
  }),
);
it.effect(
  'the first step phase takes the place of the opening, and a wait that ended never takes it back',
  Effect.fnUntraced(function* () {
    const { run, progress, waitingOn, shown } = yield* opened;
    const release = yield* Deferred.make<void>();
    const waiting = yield* Effect.forkChild(waitingOn(SETUP, Deferred.await(release)));
    yield* TestClock.adjust('3 seconds');
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(waiting);
    yield* progress.enter(run, 'preparing');
    expect(shown()).toEqual({ phase: 'preparing', since: 13_000 });
  }),
);
