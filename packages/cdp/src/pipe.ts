import { Effect, Queue, type Scope, type Sink, Stream } from 'effect';
import { type Transport, TransportLost } from './session.js';

const encoder = new TextEncoder();

const joined = (parts: readonly Uint8Array[], length: number): Uint8Array => {
  if (parts.length === 1) return parts[0]!;
  const whole = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    whole.set(part, at);
    at += part.length;
  }
  return whole;
};

export const frames = <E>(bytes: Stream.Stream<Uint8Array, E>): Stream.Stream<string, E> =>
  Stream.suspend(() => {
    const decoder = new TextDecoder();
    let held: Uint8Array[] = [];
    let length = 0;
    return Stream.flatMap(bytes, (chunk) => {
      const out: string[] = [];
      let start = 0;
      for (let end = chunk.indexOf(0); end >= 0; end = chunk.indexOf(0, start)) {
        const tail = chunk.subarray(start, end);
        out.push(decoder.decode(joined([...held, tail], length + tail.length)));
        held = [];
        length = 0;
        start = end + 1;
      }
      if (start < chunk.length) {
        held.push(chunk.slice(start));
        length += chunk.length - start;
      }
      return Stream.fromIterable(out);
    });
  });

export const pipeTransport = Effect.fnUntraced(function* <E1, E2>(input: {
  readonly writer: Sink.Sink<void, Uint8Array, never, E1>;
  readonly reader: Stream.Stream<Uint8Array, E2>;
}): Effect.fn.Return<Transport, never, Scope.Scope> {
  const outbox = yield* Queue.unbounded<Uint8Array>();
  let closed = false;
  yield* Stream.fromQueue(outbox).pipe(
    Stream.run(input.writer),
    Effect.exit,
    Effect.ensuring(
      Effect.sync(() => {
        closed = true;
      }),
    ),
    Effect.forkScoped,
  );
  return {
    send: (text) =>
      closed
        ? Effect.fail(new TransportLost({ message: 'the pipe to the browser is closed' }))
        : Effect.asVoid(Queue.offer(outbox, encoder.encode(`${text}\0`))),
    incoming: frames(input.reader).pipe(
      Stream.mapError((cause) => new TransportLost({ message: `the pipe from the browser broke: ${String(cause)}` })),
    ),
  };
});
