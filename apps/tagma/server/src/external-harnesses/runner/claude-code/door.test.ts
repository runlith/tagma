import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Fiber } from 'effect';
import { HttpClientRequest, HttpClientResponse } from 'effect/http';
import * as HttpClientError from 'effect/http/HttpClientError';
import { TestClock } from 'effect/testing';
import { Invocation } from '../../../platform/cli/verb.js';
import type { ServerCli } from '../../cli/server.js';
import { ServerDoor, type HostedCalled } from '../hosted/door.js';

const at = new Invocation({}, '/', () => new Blob([]).stream(), '/main.ts');

const called: HostedCalled = {
  status: 'called',
  content: [{ type: 'text', text: 'written' }],
  failed: false,
  offered: false,
  words: [],
};

const transport = (code: string) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request: HttpClientRequest.post('http://127.0.0.1/api/op'), cause: { code } }),
  });

const unreached = transport('ECONNREFUSED');

const cut = transport('ECONNRESET');

const unheld = { code: 'run-not-held', reason: 'this server does not hold the run yet', unblock: ['send the same call again'] };

const asked = HttpClientRequest.post('http://127.0.0.1/api/op/call_hosted_tool');

const stopped = new HttpClientError.HttpClientError({
  reason: new HttpClientError.DecodeError({
    request: asked,
    response: HttpClientResponse.fromWeb(asked, new Response(null, { status: 503 })),
  }),
});

const serverAnswering = (answers: readonly Effect.Effect<unknown, unknown>[]) => {
  let asked = 0;
  const server: ServerCli = {
    ask: (call) => Effect.suspend(() => call({ operations: { perform: () => answers[Math.min(asked++, answers.length - 1)]! } }, at)),
    here: (place) => ({ cwd: place.cwd }),
  };
  return { door: new ServerDoor(server, at), asked: () => asked };
};

it.effect(
  'a hosted call waits out a server it cannot reach, one that cut it, one that stopped under it and one that does not hold its run yet, then takes the answer',
  () =>
    Effect.gen(function* () {
      const { door, asked } = serverAnswering([
        Effect.fail(unreached),
        Effect.fail(cut),
        Effect.fail(stopped),
        Effect.fail(unheld),
        Effect.succeed(called),
      ]);
      const answering = yield* Effect.forkChild(door.call('toolu_1', 'write', {}));
      yield* TestClock.adjust('4 seconds');
      expect(yield* Fiber.join(answering)).toEqual(called);
      expect(asked()).toBe(5);
    }),
);

it.effect('an opening, which no record answers again, is asked again only when its request never reached a server', () =>
  Effect.gen(function* () {
    const opened = { status: 'opened', context: 'the graph moved', prompt: null, web: 'none' };
    const waited = serverAnswering([Effect.fail(unreached), Effect.fail(unheld), Effect.succeed(opened)]);
    const opening = yield* Effect.forkChild(waited.door.turn());
    yield* TestClock.adjust('2 seconds');
    expect(yield* Fiber.join(opening)).toEqual({ context: 'the graph moved', prompt: null, web: 'none' });

    const lost = serverAnswering([Effect.fail(cut), Effect.succeed(opened)]);
    expect(yield* Effect.flip(lost.door.turn())).toMatchObject({ data: 'failed' });
    expect(lost.asked()).toBe(1);

    const aborted = serverAnswering([Effect.fail(stopped), Effect.succeed(opened)]);
    expect(yield* Effect.flip(aborted.door.turn())).toMatchObject({ data: 'failed' });
    expect(aborted.asked()).toBe(1);
  }),
);

it.effect('a server that broke or refused is answered at once, never asked again', () =>
  Effect.gen(function* () {
    const broke = serverAnswering([Effect.fail(new Error('server-fault: this call broke inside the server'))]);
    expect(yield* Effect.flip(broke.door.call('toolu_1', 'write', {}))).toMatchObject({ data: 'failed' });
    expect(broke.asked()).toBe(1);

    const refused = serverAnswering([
      Effect.fail({ code: 'not-hosted', reason: 'this thread hosts no agent', unblock: ['open it natively'] }),
    ]);
    expect(yield* Effect.flip(refused.door.call('toolu_2', 'write', {}))).toMatchObject({ data: 'not-hosted' });
    expect(refused.asked()).toBe(1);
  }),
);
