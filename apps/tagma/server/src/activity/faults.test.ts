import { expect } from 'bun:test';
import { ActivityFaults, type ActivityFaultsPage } from '@runlith/activity/store/faults';
import { it } from '@runlith/effect-test';
import { Effect, PubSub, Queue, Stream } from 'effect';
import type { FaultsFrame } from './contract/wire/faults.js';
import { faultsFeed } from './faults.js';

const EMPTY: ActivityFaultsPage = { faults: [], total: 0, since: 0, next: null, lost: [] };

const ONE: ActivityFaultsPage = {
  ...EMPTY,
  total: 1,
  faults: [
    {
      fingerprint: 'agent.turn.call\nbody is not a string',
      kind: 'degraded',
      place: 'agent.turn.call',
      message: 'body is not a string',
      stack: 'TypeError: body is not a string\n    at limit (body.ts:12:3)',
      count: 2,
      firstAt: 1_000,
      lastAt: 2_000,
      activity: 'a1',
      thread: 't1',
      run: 'r1',
      project: 5,
    },
  ],
};

it.effect('the faults feed answers the page on subscribe and the page again after a change', () =>
  Effect.gen(function* () {
    let page = EMPTY;
    const moved = yield* PubSub.sliding<void>({ capacity: 1, replay: 1 });
    const faults = ActivityFaults.of({
      read: () => Effect.sync(() => page),
      since: () => 0,
      clear: Effect.die('clear is not reached'),
      changes: Stream.fromPubSub(moved),
    });
    const frames = yield* Queue.unbounded<FaultsFrame>();
    yield* Effect.forkScoped(Stream.runForEach(faultsFeed(faults, 10), (frame) => Queue.offer(frames, frame)));

    expect(yield* Queue.take(frames)).toEqual({ type: 'page', faults: [], total: 0, since: 0, lost: [] });
    page = ONE;
    yield* PubSub.publish(moved, undefined);
    expect(yield* Queue.take(frames)).toEqual({ type: 'page', faults: ONE.faults, total: 1, since: 0, lost: [] });
  }),
);
