import { Deferred, Effect, Exit, Queue, Schema } from 'effect';
import { LaneReplyText, readOutputFrame } from '@runlith/executions/protocol/lane';

export const laneViewer = Effect.fnUntraced(function* (url: string, token: string) {
  const replies = yield* Queue.unbounded<string>();
  const frames = yield* Queue.unbounded<{ readonly offset: bigint; readonly bytes: Uint8Array }>();
  const closed = yield* Deferred.make<number>();
  const socket = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const opened = new WebSocket(url);
      opened.binaryType = 'arraybuffer';
      opened.onopen = () => opened.send(JSON.stringify({ lane: token }));
      opened.onmessage = (event) => {
        if (typeof event.data === 'string') return Queue.offerUnsafe(replies, event.data);
        const frame = readOutputFrame(new Uint8Array(event.data as ArrayBuffer));
        if (frame !== undefined) Queue.offerUnsafe(frames, { offset: frame.offset, bytes: frame.bytes.slice() });
      };
      opened.onclose = (event) => Deferred.doneUnsafe(closed, Exit.succeed(event.code));
      return opened;
    }),
    (opened) => Effect.sync(() => opened.close()),
  );
  return {
    reply: Effect.flatMap(Queue.take(replies), (text) => Schema.decodeUnknownEffect(LaneReplyText)(text)),
    frame: Queue.take(frames),
    received: Queue.clear(frames),
    closed: Deferred.await(closed),
    send: (said: unknown) => Effect.sync(() => socket.send(JSON.stringify(said))),
  };
});
