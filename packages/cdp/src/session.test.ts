import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Queue, Stream } from 'effect';
import { connect } from './session.js';

it.live('posted answers once every command posted before it is answered, a refused one included', () =>
  Effect.gen(function* () {
    const incoming = yield* Queue.unbounded<string>();
    const sent: number[] = [];
    const connection = yield* connect({
      incoming: Stream.fromQueue(incoming),
      send: (text) =>
        Effect.sync(() => {
          sent.push((JSON.parse(text) as { readonly id: number }).id);
        }),
    });
    const session = connection.root;
    yield* session.post('Input.insertText', { text: 'a' });
    yield* session.post('Input.insertText', { text: 'b' });
    const done = yield* Deferred.make<void>();
    yield* Effect.forkChild(Effect.andThen(session.posted, Deferred.succeed(done, undefined)));
    yield* Queue.offer(incoming, JSON.stringify({ id: sent[0], result: {} }));
    const probe = yield* Effect.forkChild(session.send('Runtime.evaluate', { expression: '0' }));
    while (sent.length < 3) yield* Effect.yieldNow;
    yield* Queue.offer(incoming, JSON.stringify({ id: sent[2], result: { result: { type: 'number', value: 0 } } }));
    yield* Fiber.join(probe);
    expect(Deferred.isDoneUnsafe(done)).toBe(false);
    yield* Queue.offer(incoming, JSON.stringify({ id: sent[1], error: { code: -32000, message: 'refused' } }));
    yield* Deferred.await(done);
  }),
);
