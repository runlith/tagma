import { type Cause, Effect, Queue } from 'effect';
import * as Socket from 'effect/socket/Socket';

export type SocketPair = {
  readonly client: Socket.Socket;
  readonly helper: Socket.Socket;
  readonly breakClientWrites: Effect.Effect<void>;
};

const encoder = new TextEncoder();

const refused = (cause: string) => new Socket.SocketError({ reason: new Socket.SocketWriteError({ cause }) });

const closed = new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1000 }) });

const end = (
  inbox: Queue.Queue<Uint8Array, Cause.Done>,
  outbox: Queue.Queue<Uint8Array, Cause.Done>,
  broken: () => boolean,
): Socket.Socket => {
  const write = (chunk: Uint8Array | string | Socket.CloseEvent): Effect.Effect<void, Socket.SocketError> => {
    if (Socket.isCloseEvent(chunk)) return Effect.asVoid(Queue.end(outbox));
    if (broken()) return Effect.fail(refused('the writable side broke'));
    return Queue.offer(outbox, typeof chunk === 'string' ? encoder.encode(chunk) : chunk).pipe(
      Effect.flatMap((accepted) => (accepted ? Effect.void : Effect.fail(refused('the peer closed')))),
    );
  };
  return Socket.make({
    reader: Effect.succeed({
      pull: Queue.takeAll(inbox).pipe(Effect.mapError(() => closed)),
      upgrade: Socket.SocketUpgradeError.unsupported,
    }),
    writer: Effect.acquireRelease(Effect.succeed({ write, writeAll: (chunks) => Effect.forEach(chunks, write, { discard: true }) }), () =>
      Effect.asVoid(Queue.end(outbox)),
    ),
  });
};

export const socketPair: Effect.Effect<SocketPair> = Effect.gen(function* () {
  const toHelper = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  const toClient = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  let broken = false;
  return {
    client: end(toClient, toHelper, () => broken),
    helper: end(toHelper, toClient, () => false),
    breakClientWrites: Effect.sync(() => {
      broken = true;
    }),
  };
});
