import { Effect } from 'effect';
import { expect } from 'vitest';
import { it } from '@runlith/effect-test/vitest';
import { LiveConnection } from './Live.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';
import { testCatalog } from './testing.js';

const unopened = (): WebSocket => {
  throw new Error('This test opens no socket.');
};
const connection = LiveConnection.make(unopened, new ServerOrigin('http://localhost'), testCatalog());

it.effect('a pause reports no failure, and resume returns the page to a connectable state', () =>
  Effect.gen(function* () {
    const liveWire = yield* connection;
    const failures: unknown[] = [];
    const statuses: string[] = [];
    const offFailure = liveWire.subscribeFailure((failure) => failures.push(failure));
    const offStatus = liveWire.subscribeStatus((status) => statuses.push(status));

    liveWire.pause();
    liveWire.resume();

    offFailure();
    offStatus();

    expect(failures).toEqual([]);
    expect(statuses).toContain('paused');
    expect(statuses.at(-1)).toBe('idle');
  }),
);

it.effect('a paused page opens no connection, whichever door is knocked', () =>
  Effect.gen(function* () {
    const liveWire = yield* connection;
    liveWire.pause();
    yield* Effect.addFinalizer(() => Effect.sync(() => liveWire.resume()));
    liveWire.reopen();
    expect(liveWire.status).toBe('paused');

    const failures: unknown[] = [];
    const held = liveWire.hold(
      () => {
        throw new Error('a paused page must not start a subscription');
      },
      () => {},
      (failure) => failures.push(failure),
    );
    expect(liveWire.status).toBe('paused');
    expect(failures).toEqual([]);
    held.unsubscribe();

    yield* Effect.promise(() => expect(liveWire.call(() => Effect.void)).rejects.toMatchObject({ code: 'transport' }));
  }),
);
