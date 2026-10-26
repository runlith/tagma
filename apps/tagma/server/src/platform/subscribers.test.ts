import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { subscribersOf } from './subscribers.js';

it.effect('a subscriber that throws or fails does not stop the others or the publisher, and an unsubscribed one is not told', () =>
  Effect.gen(function* () {
    const feed = subscribersOf<number>('a subscriber failed', (event) => ({ event }));
    const heard: number[] = [];
    feed.subscribe(() => {
      throw new Error('broken');
    });
    feed.subscribe(() => Effect.die('refused'));
    feed.subscribe((event) => Effect.sync(() => void heard.push(event)));
    const leave = feed.subscribe((event) => Effect.sync(() => void heard.push(-event)));
    yield* feed.publish(1);
    leave();
    yield* feed.publish(2);
    expect(heard).toEqual([1, -1, 2]);
  }),
);
