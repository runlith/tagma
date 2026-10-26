import { Effect, Fiber, Stream } from 'effect';
import { expect, vi } from 'vitest';
import { it } from '@runlith/effect-test/vitest';
import type { FeedPosition } from '@runlith/agent/transcript/live';
import { CallFailed, LiveConnection } from '$lib/wire/Live.js';
import { Refusal } from '$lib/wire/refusal.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { ThreadPort } from './ThreadPort.js';

const unopened = (): WebSocket => {
  throw new Error('This test opens no socket.');
};
const connection = LiveConnection.make(unopened, new ServerOrigin('http://localhost'));
const restart = { watch: () => () => undefined, placeReturned: () => undefined } as never;

type HeldOpen = Parameters<LiveConnection['hold']>[0];
type HeldClient = Parameters<HeldOpen>[0];

it.live('every generation of a held thread feed names the position the session holds now', () =>
  Effect.gen(function* () {
    const live = yield* connection;
    const opens: HeldOpen[] = [];
    const hold = vi.spyOn(live, 'hold').mockImplementation((open) => {
      opens.push(open);
      return { unsubscribe: () => {} };
    });
    yield* Effect.addFinalizer(() => Effect.sync(() => hold.mockRestore()));
    const requests: unknown[] = [];
    const client = {
      'thread.subscribe': (request: unknown) => {
        requests.push(request);
        return Stream.empty;
      },
    } as unknown as HeldClient;
    let held: FeedPosition | null = null;
    const reading = yield* Effect.forkScoped(
      Stream.runDrain(
        new ThreadPort(live, 7, restart).feed(
          'thread-1',
          Effect.sync(() => held),
        ),
      ),
    );

    yield* Effect.promise(() => vi.waitFor(() => expect(opens).toHaveLength(1)));
    yield* Stream.runDrain(opens[0]!(client));
    held = { position: 42, seq: 9 };
    yield* Stream.runDrain(opens[0]!(client));
    yield* Fiber.interrupt(reading);

    expect(requests).toEqual([
      { projectId: 7, threadId: 'thread-1' },
      { projectId: 7, threadId: 'thread-1', since: { position: 42, seq: 9 } },
    ]);
  }),
);

it.live('a subscription the server refused ends the feed refused, and one that broke without a refusal ends it broken', () =>
  Effect.gen(function* () {
    const live = yield* connection;
    const ended = Effect.fnUntraced(function* (failure: Parameters<Parameters<LiveConnection['hold']>[2]>[0]) {
      const hold = vi.spyOn(live, 'hold').mockImplementation((_open, _onItem, onFailure) => {
        queueMicrotask(() => onFailure(failure));
        return { unsubscribe: () => {} };
      });
      return yield* Effect.flip(Stream.runDrain(new ThreadPort(live, 7, restart).feed('thread-1', Effect.succeed(null)))).pipe(
        Effect.ensuring(Effect.sync(() => hold.mockRestore())),
      );
    });

    expect(yield* ended({ kind: 'subscription', message: 'thread-gone', code: 'thread-gone' })).toMatchObject({ _tag: 'ChatFeedRefused' });
    expect(yield* ended({ kind: 'subscription', message: 'Expected JSON value at ["entry"]["toolOutput"]' })).toMatchObject({
      _tag: 'ChatFeedBroken',
      message: 'Expected JSON value at ["entry"]["toolOutput"]',
    });
  }),
);

it.live('a command that left and lost its connection has an unknown outcome; one refused or never sent did nothing', () =>
  Effect.gen(function* () {
    const live = yield* connection;
    yield* Effect.addFinalizer(() => Effect.sync(() => vi.restoreAllMocks()));
    const port = new ThreadPort(live, 7, restart);
    const failing = (refusal: Refusal, sent: boolean) =>
      vi.spyOn(live, 'attempt').mockReturnValue(Effect.fail(new CallFailed({ refusal, sent })) as never);
    const send = () => Effect.flip(port.send('thread-1', { text: 'hi', key: 'turn-1' }));
    const transport = new Refusal({ gate: false, code: 'transport', reason: 'the socket closed', unblock: [] });

    failing(transport, true);
    expect(yield* send()).toMatchObject({ _tag: 'ChatCommandLost', message: 'the socket closed' });
    failing(transport, false);
    expect(yield* send()).toMatchObject({ _tag: 'ChatCommandRefused', code: 'transport' });
    failing(new Refusal({ gate: true, code: 'run-active', reason: 'a run is going', unblock: [] }), true);
    expect(yield* send()).toMatchObject({ _tag: 'ChatCommandRefused', code: 'run-active', message: 'a run is going' });
    failing(
      new Refusal({
        gate: true,
        code: 'demo-unavailable',
        reason: 'this act needs Tagma itself',
        unblock: ['install Tagma'],
        words: { text: 'Steering needs the app' },
      }),
      true,
    );
    expect(yield* send()).toMatchObject({
      _tag: 'ChatCommandRefused',
      message: 'Steering needs the app',
      told: { details: ['this act needs Tagma itself', 'install Tagma'], code: 'demo-unavailable' },
    });
  }),
);
