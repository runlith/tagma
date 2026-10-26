import { Cause, Context, Effect, Layer, Queue, Stream } from 'effect';
import type { Headers } from 'effect/http';
import { isSensitiveQueryName, secretsOf } from '../../../redact';
import * as ProviderShared from '../../protocols/shared';
import { LLMError, type TransportFailureKind, TransportReason } from '../../schema/errors';
import * as HttpTransport from './http';
import type { Transport } from './index';

export interface WebSocketRequest {
  readonly url: string;
  readonly headers: Headers.Headers;
}

export interface WebSocketConnection {
  readonly sendText: (message: string) => Effect.Effect<void, LLMError>;
  readonly messages: Stream.Stream<string | Uint8Array, LLMError>;
  readonly close: Effect.Effect<void, never>;
}

type WebSocketConstructorWithHeaders = new (url: string, options?: { readonly headers?: Headers.Headers }) => globalThis.WebSocket;

export class WebSocketTransport extends Context.Service<
  WebSocketTransport,
  { readonly open: (input: WebSocketRequest) => Effect.Effect<WebSocketConnection, LLMError> }
>()('@runlith/llm/WebSocketTransport') {}

const transportError = (
  method: string,
  message: string,
  input: { readonly url?: string; readonly kind: TransportFailureKind; readonly cause?: unknown },
) =>
  new LLMError({
    module: 'WebSocketExecutor',
    method,
    reason: new TransportReason({
      message,
      kind: input.kind,
      host: input.url !== undefined && URL.canParse(input.url) ? new URL(input.url).host : undefined,
      cause: ProviderShared.causeChain(input.cause),
    }),
  });

const eventMessage = (event: Event) => {
  if ('message' in event && typeof event.message === 'string') return event.message;
  return event.type;
};

const binaryMessage = (data: unknown) => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return undefined;
};

const waitOpen = (ws: globalThis.WebSocket, input: WebSocketRequest) => {
  if (ws.readyState === globalThis.WebSocket.OPEN) return Effect.void;
  if (ws.readyState === globalThis.WebSocket.CLOSING || ws.readyState === globalThis.WebSocket.CLOSED) {
    return Effect.fail(
      transportError('open', `WebSocket closed before opening (state ${ws.readyState})`, {
        url: input.url,
        kind: 'reset',
      }),
    );
  }
  return Effect.callback<void, LLMError>((resume, signal) => {
    const cleanup = () => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
      ws.removeEventListener('close', onClose);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      if (ws.readyState !== globalThis.WebSocket.CLOSED && ws.readyState !== globalThis.WebSocket.CLOSING) ws.close(1000);
    };
    const onOpen = () => {
      cleanup();
      resume(Effect.void);
    };
    const onError = (event: Event) => {
      cleanup();
      resume(
        Effect.fail(
          transportError('open', `Failed to open WebSocket: ${eventMessage(event)}`, {
            url: input.url,
            kind: 'unknown',
          }),
        ),
      );
    };
    const onClose = (event: CloseEvent) => {
      cleanup();
      resume(
        Effect.fail(
          transportError('open', `WebSocket closed before opening with code ${event.code}`, {
            url: input.url,
            kind: 'reset',
          }),
        ),
      );
    };
    ws.addEventListener('open', onOpen, { once: true });
    ws.addEventListener('error', onError, { once: true });
    ws.addEventListener('close', onClose, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

const webSocketUrl = (value: string) =>
  Effect.try({
    try: () => {
      const url = new URL(value);
      if (url.protocol === 'https:') {
        url.protocol = 'wss:';
        return url.toString();
      }
      if (url.protocol === 'http:') {
        url.protocol = 'ws:';
        return url.toString();
      }
      throw new Error(`Unsupported WebSocket URL protocol ${url.protocol}`);
    },
    catch: (error) =>
      ProviderShared.invalidRequest(error instanceof Error ? error.message : `A WebSocket deployment cannot be reached at ${value}`),
  });

export const open = (input: WebSocketRequest) =>
  Effect.try({
    try: () => new (globalThis.WebSocket as unknown as WebSocketConstructorWithHeaders)(input.url, { headers: input.headers }),
    catch: (error) =>
      transportError('open', error instanceof Error ? error.message : 'Failed to construct WebSocket', {
        url: input.url,
        kind: 'unknown',
        cause: error,
      }),
  }).pipe(Effect.flatMap((ws) => fromWebSocket(ws, input)));

export const webSocketTransportLayer: Layer.Layer<WebSocketTransport> = Layer.succeed(WebSocketTransport, WebSocketTransport.of({ open }));

export const fromWebSocket = Effect.fn('WebSocket.connect')(function* (
  ws: globalThis.WebSocket,
  input: WebSocketRequest,
): Effect.fn.Return<WebSocketConnection, LLMError> {
  yield* waitOpen(ws, input);
  const messages = yield* Queue.bounded<string | Uint8Array, LLMError | Cause.Done<void>>(128);

  const onMessage = (event: MessageEvent) => {
    if (typeof event.data === 'string') return Queue.offerUnsafe(messages, event.data);
    const binary = binaryMessage(event.data);
    if (binary) return Queue.offerUnsafe(messages, binary);
    Queue.failCauseUnsafe(
      messages,
      Cause.fail(
        ProviderShared.failureOf(undefined, {
          module: 'WebSocketExecutor',
          method: 'message',
          route: input.url,
          message: 'The peer sent a message payload this transport cannot read',
          family: 'invalid-output',
        }),
      ),
    );
  };
  const onError = (event: Event) => {
    Queue.failCauseUnsafe(
      messages,
      Cause.fail(
        ProviderShared.failureOf(undefined, {
          module: 'WebSocketExecutor',
          method: 'message',
          route: input.url,
          message: `The socket errored: ${eventMessage(event)}`,
          family: 'socket-closed',
        }),
      ),
    );
  };
  const onClose = (event: CloseEvent) => {
    if (event.code === 1000 || event.code === 1005) return Queue.endUnsafe(messages);
    Queue.failCauseUnsafe(
      messages,
      Cause.fail(
        ProviderShared.failureOf(undefined, {
          module: 'WebSocketExecutor',
          method: 'message',
          route: input.url,
          message: `The peer closed the socket with code ${event.code}`,
          family: 'socket-closed',
          excerpt: event.reason === '' ? undefined : event.reason,
        }),
      ),
    );
  };
  const cleanup = Effect.sync(() => {
    ws.removeEventListener('message', onMessage);
    ws.removeEventListener('error', onError);
    ws.removeEventListener('close', onClose);
  }).pipe(Effect.andThen(Queue.shutdown(messages)));

  ws.addEventListener('message', onMessage);
  ws.addEventListener('error', onError);
  ws.addEventListener('close', onClose);

  return {
    sendText: (message) =>
      Effect.try({
        try: () => ws.send(message),
        catch: (error) =>
          transportError('sendText', error instanceof Error ? error.message : 'Failed to send WebSocket message', {
            url: input.url,
            kind: 'reset',
            cause: error,
          }),
      }),
    messages: Stream.fromQueue(messages),
    close: cleanup.pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (ws.readyState === globalThis.WebSocket.CLOSED || ws.readyState === globalThis.WebSocket.CLOSING) return;
          ws.close(1000);
        }),
      ),
    ),
  };
});

export const messageText = (message: string | Uint8Array, decoder: TextDecoder) =>
  typeof message === 'string' ? message : decoder.decode(message);

export interface JsonPrepared {
  readonly url: string;
  readonly headers: Headers.Headers;
  readonly message: string;
}

export interface JsonInput<Body, Message> {
  readonly toMessage: (body: Body | Record<string, unknown>) => Effect.Effect<Message, LLMError>;
  readonly encodeMessage: (message: Message) => string;
}

export type JsonPatch<Body, Message> = Partial<JsonInput<Body, Message>>;

export interface JsonTransport<Body, Message> extends Transport<Body, JsonPrepared, string> {
  readonly with: (patch: JsonPatch<Body, Message>) => JsonTransport<Body, Message>;
}

export const json = <Body, Message>(input: JsonInput<Body, Message>): JsonTransport<Body, Message> => ({
  id: 'websocket-json',
  with: (patch) => json({ ...input, ...patch }),
  prepare: Effect.fnUntraced(function* (prepareInput) {
    const parts = yield* HttpTransport.jsonRequestParts({
      ...prepareInput,
    });
    return {
      url: yield* webSocketUrl(parts.url),
      headers: parts.headers,
      message: input.encodeMessage(yield* input.toMessage(parts.jsonBody)),
    };
  }),
  frames: (prepared, _request, runtime, _lifetime, reading) => {
    const webSocket = runtime.webSocket;
    if (!webSocket) {
      return Stream.fail(ProviderShared.invalidRequest('A WebSocket JSON transport requires the WebSocketTransport service'));
    }
    const decoder = new TextDecoder();
    return Stream.unwrap(
      Effect.gen(function* () {
        reading.secrets = new Set([
          ...secretsOf(Object.entries(prepared.headers)),
          ...secretsOf(new URL(prepared.url).searchParams, isSensitiveQueryName),
        ]);
        const connection = yield* Effect.acquireRelease(
          webSocket.open({ url: prepared.url, headers: prepared.headers }),
          (connection) => connection.close,
        );
        yield* connection.sendText(prepared.message);
        return connection.messages.pipe(Stream.map((message) => messageText(message, decoder)));
      }),
    );
  },
});

export const jsonTransport = {
  id: 'websocket-json',
  with: json,
} as const;
