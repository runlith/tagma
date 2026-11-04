import { it } from '@runlith/effect-test/vitest';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { expect } from 'vitest';
import { LiveConnection } from './Live.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';
import { FIXTURE_MODULE, testCatalog } from './testing.js';

class StalledServerSocket extends EventTarget {
  readyState = 0;
  binaryType = 'arraybuffer';
  pings = 0;
  readonly requested = Promise.withResolvers<string>();

  constructor() {
    super();
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    });
  }

  send(text: string): void {
    const frame = JSON.parse(text) as { _tag: string; id: string };
    if (frame._tag === 'Ping') this.pings += 1;
    if (frame._tag === 'Request') this.requested.resolve(frame.id);
  }

  reply(requestId: string, event: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ _tag: 'Chunk', requestId, values: [event] }) }));
  }

  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code: 1000, wasClean: true }));
  }
}

it.effect('a server that answers nothing for a minute keeps the live connection and its feed, while pings keep going out', () =>
  Effect.gen(function* () {
    const sockets: StalledServerSocket[] = [];
    const first = Promise.withResolvers<StalledServerSocket>();
    const live = yield* LiveConnection.make(
      () => {
        const socket = new StalledServerSocket();
        sockets.push(socket);
        first.resolve(socket);
        return socket as unknown as WebSocket;
      },
      new ServerOrigin('http://localhost'),
      testCatalog(FIXTURE_MODULE),
    );
    const received = Promise.withResolvers<{ readonly label: string }>();
    const held = live.hold(
      (client) => client['fixture.stamps']({}),
      (event) => received.resolve(event),
      (failure) => received.reject(new Error(failure.message)),
    );
    yield* Effect.addFinalizer(() => Effect.sync(held.unsubscribe));
    const socket = yield* Effect.promise(() => first.promise);
    const request = yield* Effect.promise(() => socket.requested.promise);

    yield* TestClock.adjust('1 minute');

    expect(live.status).toBe('open');
    expect(sockets).toHaveLength(1);
    expect(socket.pings).toBeGreaterThan(1);
    socket.reply(request, { label: 'after the stall' });
    expect(yield* Effect.promise(() => received.promise)).toEqual({ label: 'after the stall' });
  }),
);
