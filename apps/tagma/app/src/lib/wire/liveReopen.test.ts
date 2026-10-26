import { it } from '@runlith/effect-test/vitest';
import { Cause, Effect, Exit, Fiber } from 'effect';
import { expect } from 'vitest';
import { waitFor, waitUntil } from '@runlith/testing/flush';
import { LiveConnection, type LiveFailure } from './Live.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';

class FailingSocket extends EventTarget {
  readonly readyState = 0;

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
    if (type === 'error') queueMicrotask(() => this.dispatchEvent(new Event('error')));
  }

  close(): void {}
}

const connection = LiveConnection.make(() => new FailingSocket() as unknown as WebSocket, new ServerOrigin('http://localhost'));

it.live('a paused page attempts nothing: the loop ends where it started', () =>
  Effect.gen(function* () {
    const liveWire = yield* connection;
    liveWire.pause();
    try {
      const loop = liveWire.reopening();
      const exit = yield* Fiber.await(loop);

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(liveWire.status).toBe('paused');
    } finally {
      liveWire.resume();
    }
  }),
);

it.live('with nothing held, the loop ends instead of reopening a connection nobody reads', () =>
  Effect.gen(function* () {
    const liveWire = yield* connection;
    const loop = liveWire.reopening();
    const exit = yield* Fiber.await(loop);

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(liveWire.status).toBe('idle');
  }),
);

it.live('an attempt that fails leaves the loop waiting for its next one, and interruption ends it', () =>
  Effect.gen(function* () {
    const liveWire = yield* connection;
    const held = liveWire.hold(
      () => {
        throw new Error('the subscription opens only on a live connection');
      },
      () => {},
      () => {},
    );
    yield* Effect.promise(() => waitUntil(() => liveWire.status === 'closed'));

    const seen: string[] = [];
    const off = liveWire.subscribeStatus((status) => seen.push(status));
    const loop = liveWire.reopening();
    try {
      yield* Effect.promise(() => waitUntil(() => seen.includes('connecting')));
      yield* Effect.promise(() => waitUntil(() => liveWire.status === 'closed'));

      expect(loop.pollUnsafe()).toBeUndefined();

      loop.interruptUnsafe();
      const exit = yield* Fiber.await(loop);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    } finally {
      off();
      held.unsubscribe();
    }
  }),
);

it.live('a socket error without details has a connection explanation', () =>
  Effect.gen(function* () {
    const liveWire = yield* connection;
    const failures: LiveFailure[] = [];
    const off = liveWire.subscribeFailure((failure) => failures.push(failure));
    const held = liveWire.hold(
      (client) => client['thread.subscribe']({ projectId: 1, threadId: 'thread-1' }),
      () => {},
      () => {},
      'frame',
    );

    try {
      yield* Effect.promise(() =>
        waitFor(() =>
          expect(failures).toContainEqual(
            expect.objectContaining({ kind: 'connection', message: expect.stringContaining('without saying why') }),
          ),
        ),
      );
    } finally {
      off();
      held.unsubscribe();
    }
  }),
);
