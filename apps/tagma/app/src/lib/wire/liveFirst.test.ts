import { Effect, Scope } from 'effect';
import { expect, vi } from 'vitest';
import { it } from '@runlith/effect-test/vitest';
import { LiveConnection } from './Live.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';

class DialedSocket extends EventTarget {
  readyState = 0;
  binaryType = 'arraybuffer';
  readonly sent: string[] = [];

  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {}

  drop(): void {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1006, reason: '', wasClean: false }));
  }

  requests(): string[] {
    return this.sent.flatMap((data) => {
      const parsed: unknown = JSON.parse(data);
      const messages = Array.isArray(parsed) ? parsed : [parsed];
      return messages.flatMap((message: { _tag?: string; tag?: string }) =>
        message._tag === 'Request' && message.tag ? [message.tag] : [],
      );
    });
  }
}

it.live('a stop made while the socket is closed reaches the server first once it opens, ahead of earlier commands and feeds', () =>
  Effect.gen(function* () {
    const sockets: DialedSocket[] = [];
    const life = yield* Scope.fork(yield* Effect.scope);
    const live = yield* Scope.provide(
      LiveConnection.make(() => {
        const socket = new DialedSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      }, new ServerOrigin('http://localhost')),
      life,
    );
    const at = { projectId: 1, threadId: 'thread-1' };
    const feed = live.hold(
      (client) => client['thread.subscribe'](at),
      () => {},
      () => {},
      'frame',
    );
    yield* Effect.addFinalizer(() => Effect.sync(feed.unsubscribe));
    yield* Effect.promise(() => vi.waitFor(() => expect(sockets).toHaveLength(1)));
    sockets[0]?.open();
    yield* Effect.promise(() => vi.waitFor(() => expect(sockets[0]?.requests()).toEqual(['thread.subscribe'])));
    sockets[0]?.drop();
    expect(live.status).toBe('closed');

    yield* Effect.forkScoped(Effect.exit(live.attempt((client) => client['thread.send']({ ...at, params: { text: 'next', key: 'k-1' } }))));
    yield* Effect.forkScoped(Effect.exit(live.attemptFirst((client) => client['thread.stop']({ ...at, params: {} }))));
    yield* Effect.promise(() => vi.waitFor(() => expect(sockets).toHaveLength(2)));
    sockets[1]?.open();

    yield* Effect.promise(() => vi.waitFor(() => expect(sockets[1]?.requests()).toHaveLength(3)));
    expect(sockets[1]?.requests()[0]).toBe('thread.stop');
  }),
);
