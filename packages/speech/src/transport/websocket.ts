import { Cause, Deferred, Effect, Layer, Queue, type Scope, Stream } from 'effect';
import { type DuplexLink, type DuplexRequest, DuplexTransport, type Message } from '../protocol/transport.ts';
import { SpeechFailure } from '../wire/failure.ts';

export interface WebSocketLike {
  binaryType: string;
  readonly bufferedAmount: number;
  send(data: string | Uint8Array): void;
  close(): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event: { readonly code: number; readonly reason: string }) => void): void;
  addEventListener(type: 'error', listener: (event: { readonly message?: string }) => void): void;
}

export type OpenSocket = (url: string, protocols: string[], headers: Record<string, string>) => WebSocketLike;

const NORMAL_CLOSE = 1000;

const received = (data: unknown): Message | undefined => {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return undefined;
};

const opened = Effect.fnUntraced(function* (
  open: OpenSocket,
  request: DuplexRequest,
): Effect.fn.Return<DuplexLink, SpeechFailure, Scope.Scope> {
  const host = new URL(request.url).host;
  const messages = yield* Queue.unbounded<Message, SpeechFailure | Cause.Done>();
  const ready = Deferred.makeUnsafe<void, SpeechFailure>();
  const socket = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const ws = open(request.url, [...request.protocols], { ...request.headers });
      ws.binaryType = 'arraybuffer';
      let isOpen = false;
      let error: string | undefined;
      ws.addEventListener('open', () => {
        isOpen = true;
        Deferred.doneUnsafe(ready, Effect.void);
      });
      ws.addEventListener('message', (event) => {
        const message = received(event.data);
        if (message !== undefined) Queue.offerUnsafe(messages, message);
        else
          Queue.failCauseUnsafe(
            messages,
            Cause.fail(SpeechFailure.transport(`the socket to ${host} delivered a frame of an unknown kind`)),
          );
      });
      ws.addEventListener('error', (event) => {
        error = event.message;
      });
      ws.addEventListener('close', (event) => {
        const why = event.reason !== '' ? event.reason : (error ?? '');
        const lost = SpeechFailure.transport(`the socket to ${host} closed with ${event.code}${why === '' ? '' : `: ${why}`}`);
        if (!isOpen) Deferred.doneUnsafe(ready, Effect.fail(lost));
        else if (event.code === NORMAL_CLOSE) Queue.endUnsafe(messages);
        else Queue.failCauseUnsafe(messages, Cause.fail(lost));
      });
      return ws;
    }),
    (ws) => Effect.sync(() => ws.close()),
  );
  yield* Deferred.await(ready);
  return {
    send: (message) =>
      Effect.try({
        try: () => socket.send(message),
        catch: (error) => SpeechFailure.transport(`the socket to ${host} refused a frame: ${String(error)}`),
      }),
    buffered: Effect.sync(() => socket.bufferedAmount),
    messages: Stream.fromQueue(messages),
    close: Effect.sync(() => socket.close()),
  };
});

export const webSocketTransport = (open: OpenSocket): Layer.Layer<DuplexTransport> =>
  Layer.succeed(DuplexTransport, { open: (request) => opened(open, request) });
