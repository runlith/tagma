import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { heldFeed } from './held.js';

it.effect('a failing subscriber neither stops the others nor fails the publisher, and a left subscriber hears nothing', () =>
  Effect.gen(function* () {
    const feed = heldFeed();
    const heard: string[] = [];
    feed.heldChanged(() => Effect.die('broken'));
    const leave = feed.heldChanged((change) => Effect.sync(() => heard.push(`left:${change.threadId}`)));
    feed.heldChanged((change) => Effect.sync(() => heard.push(`kept:${change.threadId}`)));
    const moved = { projectId: 1, places: [] };
    yield* feed.publish({ threadId: 'one', moved });
    leave();
    yield* feed.publish({ threadId: 'two', moved });
    expect(heard).toEqual(['left:one', 'kept:one', 'kept:two']);
  }),
);
