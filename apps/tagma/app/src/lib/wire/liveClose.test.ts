import { Effect, Exit, Scope, Stream } from 'effect';
import { RpcClientError } from 'effect/rpc';
import { expect, vi } from 'vitest';
import { it } from '@runlith/effect-test/vitest';
import { DEVICE_REVOKED_CLOSE } from '@tagma/server/remote/contract/wire/access';
import { LiveConnection, type LiveFailure } from './Live.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';

const origin = new ServerOrigin('http://localhost');

const liveOver = (socket: () => EventTarget, life: Scope.Scope) =>
  Scope.provide(
    LiveConnection.make(() => socket() as unknown as WebSocket, origin),
    life,
  );

it.live('closing the owner’s lifetime closes the socket the connection holds', () =>
  Effect.gen(function* () {
    const closes: number[] = [];
    let opened = 0;

    class OpenSocket extends EventTarget {
      readonly readyState = 1;
      binaryType = 'arraybuffer';

      constructor() {
        super();
        opened += 1;
      }

      send(): void {}

      close(code?: number): void {
        closes.push(code ?? 0);
      }
    }

    const life = yield* Scope.fork(yield* Effect.scope);
    const live = yield* liveOver(() => new OpenSocket(), life);
    const held = live.hold(
      (client) => client['thread.subscribe']({ projectId: 1, threadId: 'thread-1' }),
      () => {},
      () => {},
      'frame',
    );

    yield* Effect.addFinalizer(() => Effect.sync(held.unsubscribe));
    yield* Effect.promise(() => vi.waitFor(() => expect(opened).toBe(1)));
    expect(closes).toEqual([]);

    yield* Scope.close(life, Exit.void);

    expect(closes.length).toBeGreaterThan(0);
  }),
);

it.live('a defect the client sends to every request ends the connection, never each hold as its own failure', () =>
  Effect.gen(function* () {
    class OpenSocket extends EventTarget {
      readonly readyState = 1;
      binaryType = 'arraybuffer';
      send(): void {}
      close(): void {}
    }

    const life = yield* Scope.fork(yield* Effect.scope);
    const live = yield* liveOver(() => new OpenSocket(), life);
    const broken = new RpcClientError.RpcClientError({
      reason: new RpcClientError.RpcClientDefect({ message: 'Unknown socket error', cause: null }),
    });
    const failures: LiveFailure[] = [];
    const holds = [
      live.hold(
        () => Stream.fail(broken),
        () => {},
        (failure) => failures.push(failure),
      ),
      live.hold(
        () => Stream.never,
        () => {},
        (failure) => failures.push(failure),
      ),
    ];

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const held of holds) held.unsubscribe();
      }),
    );
    yield* Effect.promise(() => vi.waitFor(() => expect(live.status).toBe('closed')));

    expect(new Set(failures.map((failure) => failure.kind))).toEqual(new Set(['connection']));
  }),
);

it.live('a socket the server closes for a revoked device stays shut: no reconnection follows', () =>
  Effect.gen(function* () {
    const sockets: EventTarget[] = [];

    class OpenSocket extends EventTarget {
      readonly readyState = 1;
      binaryType = 'arraybuffer';
      constructor() {
        super();
        sockets.push(this);
        queueMicrotask(() => this.dispatchEvent(new Event('open')));
      }
      send(): void {}
      close(): void {}
    }

    const life = yield* Scope.fork(yield* Effect.scope);
    const live = yield* liveOver(() => new OpenSocket(), life);
    const held = live.hold(
      (client) => client['thread.subscribe']({ projectId: 1, threadId: 'thread-1' }),
      () => {},
      () => {},
      'frame',
    );

    yield* Effect.addFinalizer(() => Effect.sync(held.unsubscribe));
    yield* Effect.promise(() => vi.waitFor(() => expect(sockets).toHaveLength(1)));
    sockets[0]?.dispatchEvent(Object.assign(new Event('close'), { code: DEVICE_REVOKED_CLOSE, reason: 'device-revoked', wasClean: true }));
    expect(live.status).toBe('refused');
    live.reopen();
    yield* Effect.yieldNow;
    expect(sockets).toHaveLength(1);
    expect(live.status).toBe('refused');
  }),
);
