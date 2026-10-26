import { gzipSync } from 'node:zlib';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Clock, Deferred, Effect, Exit, Layer, Scope, Stream } from 'effect';
import { Headers, HttpClient, type HttpClientRequest, HttpClientResponse } from 'effect/http';
import * as LLM from '../../call';
import * as OpenAIResponses from '../../protocols/openai-responses';
import type { HttpOptions } from '../../schema/options';
import { LLMError, type WireFailureFamily } from '../../schema/errors';
import * as Auth from '../auth';
import { Endpoint } from '../endpoint';
import { HttpExecutor, httpExecutorLayer } from '../executor';
import { openWireReading } from '../wireReading';
import * as ConnectTransport from './connect';
import { type ConnectFrame } from './connect';

const encoder = new TextEncoder();

const model = OpenAIResponses.route
  .with({ provider: 'connect-test', endpoint: { baseURL: 'https://provider.test/v1' } })
  .model({ id: 'model-test' });

const request = (http?: HttpOptions.Input) => LLM.request({ model, prompt: 'hello', http });

const envelope = (flags: number, payload: Uint8Array) => {
  const bytes = new Uint8Array(5 + payload.byteLength);
  bytes[0] = flags;
  new DataView(bytes.buffer).setUint32(1, payload.byteLength, false);
  bytes.set(payload, 5);
  return bytes;
};

const joined = (...parts: ReadonlyArray<Uint8Array>) => {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  return bytes;
};

const cut = (bytes: Uint8Array, size: number) => {
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < bytes.byteLength; at += size) chunks.push(bytes.slice(at, at + size));
  return chunks;
};

const response = (outgoing: HttpClientRequest.HttpClientRequest, chunks: ReadonlyArray<Uint8Array>) =>
  HttpClientResponse.fromWeb(
    outgoing,
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'application/connect+proto' } },
    ),
  );

const transport = ConnectTransport.make<{ readonly value: number }>({
  encode: (body) => Uint8Array.of(body.value),
});

const prepare = (input = request(), auth = Auth.none) =>
  transport.prepare({
    body: { value: 7 },
    request: input,
    endpoint: Endpoint.path('/rpc', { baseURL: 'https://provider.test' }),
    auth,
    encodeBody: () => '',
  });

const collect = Effect.fnUntraced(function* (chunks: ReadonlyArray<Uint8Array>) {
  const prepared = yield* prepare();
  const runtime = {
    http: HttpExecutor.of({
      execute: (outgoing) => Effect.succeed(response(outgoing, chunks)),
    }),
  };
  const lifetime = yield* Scope.make();
  return yield* Stream.runCollect(
    transport.frames(prepared, request(), runtime, lifetime, openWireReading(0, yield* Clock.currentTimeMillis)),
  ).pipe(Effect.ensuring(Scope.close(lifetime, Exit.void)));
});

const failure = Effect.fnUntraced(function* (chunks: ReadonlyArray<Uint8Array>) {
  const exit = yield* Effect.exit(collect(chunks));
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) return yield* Effect.die('expected Connect stream failure');
  const found = Cause.findErrorOption(exit.cause);
  if (found._tag === 'None') return yield* Effect.die('expected typed Connect stream failure');
  expect(found.value).toBeInstanceOf(LLMError);
  return found.value as LLMError;
});

it.effect('preparation signs and sends the exact binary envelope with HTTP route options', () =>
  Effect.gen(function* () {
    let signed: string | Uint8Array | undefined;
    const auth = Auth.custom((input) => {
      signed = input.body;
      return Effect.succeed(Headers.set(input.headers, 'authorization', 'test-token'));
    });
    const prepared = yield* prepare(request({ query: { trace: 'yes' }, headers: { 'x-call': 'one' } }), auth);

    expect(signed).toBeInstanceOf(Uint8Array);
    expect([...((signed as Uint8Array) ?? [])]).toEqual([0, 0, 0, 0, 1, 7]);
    expect(prepared.request.url).toBe('https://provider.test/rpc?trace=yes');
    expect(prepared.request.headers).toMatchObject({
      authorization: 'test-token',
      'connect-protocol-version': '1',
      'content-type': 'application/connect+proto',
      'x-call': 'one',
    });
    expect(Object.keys(prepared.request.headers).toSorted()).toEqual([
      'authorization',
      'connect-protocol-version',
      'content-length',
      'content-type',
      'x-call',
    ]);
    expect(prepared.request.body).toMatchObject({ _tag: 'Uint8Array', contentLength: 6 });
    if (prepared.request.body._tag !== 'Uint8Array') return yield* Effect.die('expected byte request body');
    expect([...prepared.request.body.body]).toEqual([0, 0, 0, 0, 1, 7]);
  }),
);

it.effect('a JSON body overlay is refused instead of being dropped from a binary request', () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(prepare(request({ body: { model: 'other' } })));
    expect(error.reason).toMatchObject({ _tag: 'InvalidRequest', message: 'http.body cannot overlay a binary Connect request' });
  }),
);

it.effect('messages survive arbitrary read boundaries, gzip, and finish only at validated EOF', () =>
  Effect.gen(function* () {
    const first = encoder.encode('first');
    const second = encoder.encode('second');
    const wire = joined(envelope(0, first), envelope(1, gzipSync(second)), envelope(3, gzipSync(encoder.encode('{}'))));

    for (const size of [1, 2, 5, 17, wire.byteLength]) {
      expect(yield* collect(cut(wire, size))).toEqual<ConnectFrame[]>([
        { _tag: 'Message', bytes: first },
        { _tag: 'Message', bytes: second },
        { _tag: 'End' },
      ]);
    }
  }),
);

it.effect('framing rejects every incomplete or malformed stream lifecycle', () =>
  Effect.gen(function* () {
    const cases: ReadonlyArray<{ readonly wire: Uint8Array; readonly family: WireFailureFamily }> = [
      { wire: envelope(0, encoder.encode('message')), family: 'torn-stream' },
      { wire: Uint8Array.of(0, 0, 0), family: 'torn-stream' },
      { wire: Uint8Array.of(0, 0, 0, 0, 2, 1), family: 'torn-stream' },
      { wire: envelope(4, new Uint8Array()), family: 'invalid-output' },
      { wire: Uint8Array.of(0, 1, 0, 0, 1), family: 'invalid-output' },
      { wire: envelope(2, encoder.encode('not-json')), family: 'invalid-output' },
      { wire: envelope(2, encoder.encode('{"error":{"code":7,"message":"bad"}}')), family: 'invalid-output' },
      { wire: joined(envelope(2, encoder.encode('{}')), Uint8Array.of(0)), family: 'invalid-output' },
    ];

    for (const item of cases) {
      const error = yield* failure([item.wire]);
      expect(error.family).toBe(item.family);
    }
  }),
);

it.effect('a Connect error trailer fails with its code and never emits End', () =>
  Effect.gen(function* () {
    const prepared = yield* prepare();
    const trailer = envelope(2, encoder.encode('{"error":{"code":"unavailable","message":"try later","details":[]}}'));
    const runtime = {
      http: HttpExecutor.of({
        execute: (outgoing) => Effect.succeed(response(outgoing, [trailer])),
      }),
    };
    const lifetime = yield* Scope.make();
    const seen: ConnectFrame[] = [];
    const error = yield* Effect.flip(
      transport.frames(prepared, request(), runtime, lifetime, openWireReading(0, yield* Clock.currentTimeMillis)).pipe(
        Stream.tap((frame) => Effect.sync(() => seen.push(frame))),
        Stream.runDrain,
      ),
    ).pipe(Effect.ensuring(Scope.close(lifetime, Exit.void)));

    expect(seen).toEqual([]);
    expect(error.reason).toMatchObject({ _tag: 'ProviderInternal', message: 'unavailable: try later' });
  }),
);

it.effect('standard Connect refusal codes retain authentication, permission, rate-limit, and request families', () =>
  Effect.gen(function* () {
    const cases = [
      { code: 'unauthenticated', message: 'session rejected', reason: { _tag: 'Authentication', kind: 'invalid' } },
      {
        code: 'permission_denied',
        message: 'subscription lacks access',
        reason: { _tag: 'Authentication', kind: 'insufficient-permissions' },
      },
      { code: 'resource_exhausted', message: 'slow down', reason: { _tag: 'RateLimit' } },
      {
        code: 'invalid_argument',
        message: 'maximum context length exceeded',
        reason: { _tag: 'InvalidRequest' },
      },
    ] as const;

    for (const item of cases) {
      const trailer = envelope(
        2,
        encoder.encode(JSON.stringify({ error: { code: item.code, message: item.message, details: [{ source: 'connect-trailer' }] } })),
      );
      const error = yield* failure([trailer]);
      expect(error.reason).toMatchObject(item.reason);
      expect(error.reason.message).toContain(`${item.code}: ${item.message}`);
      expect(error.reason.message).toContain('connect-trailer');
      if (error.reason._tag === 'InvalidRequest') expect(error.reason.classification).toBeUndefined();
    }
  }),
);

it.live('closing the caller lifetime aborts a Connect request whose body stopped speaking', () =>
  Effect.gen(function* () {
    const reached = yield* Deferred.make<AbortSignal>();
    const client = HttpClient.make((outgoing, _url, signal) => {
      Deferred.doneUnsafe(reached, Effect.succeed(signal));
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          outgoing,
          new Response(new ReadableStream({ start() {} }), {
            status: 200,
            headers: { 'content-type': 'application/connect+proto' },
          }),
        ),
      );
    });
    const layer = httpExecutorLayer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)));
    const prepared = yield* prepare();
    const lifetime = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(lifetime, Exit.void));
    const stream = Stream.unwrap(
      Effect.gen(function* () {
        const executor = yield* HttpExecutor;
        return transport.frames(prepared, request(), { http: executor }, lifetime, openWireReading(0, yield* Clock.currentTimeMillis));
      }),
    );

    yield* Effect.forkChild(Stream.runDrain(stream).pipe(Effect.provide(layer)));
    const signal = yield* Deferred.await(reached);
    expect(signal.aborted).toBe(false);

    yield* Scope.close(lifetime, Exit.void);
    yield* Effect.callback<void>((resume) => {
      const done = () => resume(Effect.void);
      if (signal.aborted) done();
      else signal.addEventListener('abort', done, { once: true });
    }).pipe(Effect.timeout('1 second'));
    expect(signal.aborted).toBe(true);
  }),
);
