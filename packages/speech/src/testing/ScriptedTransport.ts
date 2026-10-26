import { type Cause, Deferred, Effect, Layer, Queue, Stream } from 'effect';
import type { SpeechFailure } from '../wire/failure.ts';
import { type DuplexLink, type DuplexRequest, DuplexTransport, type Message } from '../protocol/transport.ts';

export type ScriptedLink = {
  readonly request: DuplexRequest;
  readonly sent: Array<Message>;
  readonly receive: (message: Message) => Effect.Effect<void>;
  readonly hangUp: Effect.Effect<void>;
  readonly drop: (failure: SpeechFailure) => Effect.Effect<void>;
  readonly setBuffered: (bytes: number) => void;
  readonly breakSends: (failure: SpeechFailure) => void;
  readonly isClosed: () => boolean;
};

export type ScriptedTransport = {
  readonly layer: Layer.Layer<DuplexTransport>;
  readonly next: Effect.Effect<ScriptedLink>;
  readonly hold: Effect.Effect<Deferred.Deferred<void>>;
  readonly live: () => number;
};

const link = Effect.fnUntraced(function* (request: DuplexRequest) {
  const incoming = yield* Queue.unbounded<Message, SpeechFailure | Cause.Done>();
  const sent: Array<Message> = [];
  let buffered = 0;
  let closed = false;
  let broken: SpeechFailure | undefined;
  const duplex: DuplexLink = {
    send: (message) =>
      Effect.suspend(() => {
        if (broken !== undefined) return Effect.fail(broken);
        if (!closed) sent.push(message);
        return Effect.void;
      }),
    buffered: Effect.sync(() => buffered),
    messages: Stream.fromQueue(incoming),
    close: Effect.sync(() => {
      closed = true;
    }),
  };
  const scripted: ScriptedLink = {
    request,
    sent,
    receive: (message) => Effect.asVoid(Queue.offer(incoming, message)),
    hangUp: Effect.asVoid(Queue.end(incoming)),
    drop: (failure) => Effect.asVoid(Queue.fail(incoming, failure)),
    setBuffered: (bytes) => {
      buffered = bytes;
    },
    breakSends: (failure) => {
      broken = failure;
    },
    isClosed: () => closed,
  };
  const shut = Effect.andThen(
    Effect.sync(() => {
      closed = true;
    }),
    Queue.end(incoming),
  );
  return { duplex, scripted, shut };
});

export const scriptedTransport: Effect.Effect<ScriptedTransport> = Effect.gen(function* () {
  const opened = yield* Queue.unbounded<ScriptedLink>();
  let gate: Deferred.Deferred<void> | undefined;
  let live = 0;

  const open = Effect.fnUntraced(function* (request: DuplexRequest) {
    if (gate !== undefined) yield* Deferred.await(gate);
    const made = yield* Effect.acquireRelease(
      Effect.tap(link(request), () =>
        Effect.sync(() => {
          live += 1;
        }),
      ),
      (held) =>
        Effect.andThen(
          held.shut,
          Effect.sync(() => {
            live -= 1;
          }),
        ),
    );
    yield* Queue.offer(opened, made.scripted);
    return made.duplex;
  });

  return {
    layer: Layer.succeed(DuplexTransport, { open }),
    next: Queue.take(opened),
    hold: Effect.gen(function* () {
      const deferred = yield* Deferred.make<void>();
      gate = deferred;
      return deferred;
    }),
    live: () => live,
  };
});
