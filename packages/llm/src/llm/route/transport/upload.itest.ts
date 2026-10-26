import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Stream } from 'effect';
import { HttpBody, HttpClient, HttpClientRequest } from 'effect/http';
import { wireExecutorLayer } from '../executor';
import * as OneShotTransport from './one-shot';
import { layer } from './verbatim';

const serve = (handler: { readonly fetch: (request: Request) => Response | Promise<Response> }) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler.fetch })),
    (server) => Effect.promise(() => server.stop(true)),
  );

it.live('multipart edits deliver repeated binary files and read a delayed JSON answer', () =>
  Effect.gen(function* () {
    const files = [Uint8Array.of(0, 255, 12, 34), Uint8Array.of(128, 13, 10, 0)];
    const form = new FormData();
    form.append('prompt', 'Draw a café');
    for (const [index, bytes] of files.entries()) form.append('image', new Blob([bytes], { type: 'image/png' }), `${index}.png`);
    const received = yield* Deferred.make<{ prompt: unknown; files: Array<{ name: string; type: string; bytes: number[] }> }>();
    const server = yield* serve({
      async fetch(request) {
        const actual = await request.formData();
        Deferred.doneUnsafe(
          received,
          Effect.succeed({
            prompt: actual.get('prompt'),
            files: await Promise.all(
              actual.getAll('image').map(async (file) => {
                if (!(file instanceof File)) throw new Error('Expected an uploaded file');
                return { name: file.name, type: file.type, bytes: [...new Uint8Array(await file.arrayBuffer())] };
              }),
            ),
          }),
        );
        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode('{"accepted":'));
              await Bun.sleep(25);
              controller.enqueue(new TextEncoder().encode('true}'));
              controller.close();
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const answer = yield* OneShotTransport.post({ baseURL: `http://127.0.0.1:${server.port}` }, { path: '/images/edits', form }).pipe(
      Effect.provide(wireExecutorLayer),
    );
    expect(answer).toEqual({ accepted: true });
    const actual = yield* Deferred.await(received);
    expect(actual.prompt).toBe('Draw a café');
    expect(actual.files).toHaveLength(2);
    for (const [index, file] of actual.files.entries()) {
      expect(file.name).toBe(`${index}.png`);
      expect(file.type).toBe('image/png');
      expect(file.bytes).toEqual([...files[index]!]);
    }
  }),
);

it.live('raw Web bodies preserve bytes and their content types', () =>
  Effect.gen(function* () {
    const bytes = Uint8Array.of(0, 255, 128, 13, 10);
    const cases = [
      { body: 'café', bytes: new TextEncoder().encode('café'), type: 'text/plain;charset=UTF-8' },
      { body: bytes.buffer, bytes, type: null },
      { body: new DataView(bytes.buffer, 1, 3), bytes: bytes.slice(1, 4), type: null },
      { body: new Blob([bytes], { type: 'image/png' }), bytes, type: 'image/png' },
      {
        body: new URLSearchParams({ query: 'a b&c' }),
        bytes: new TextEncoder().encode('query=a+b%26c'),
        type: 'application/x-www-form-urlencoded;charset=UTF-8',
      },
    ];
    const server = yield* serve({
      async fetch(request) {
        return Response.json({ bytes: [...new Uint8Array(await request.arrayBuffer())], type: request.headers.get('content-type') });
      },
    });
    for (const item of cases) {
      const answer = yield* Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const response = yield* client.execute(
          HttpClientRequest.post(`http://127.0.0.1:${server.port}`).pipe(HttpClientRequest.setBody(HttpBody.raw(item.body))),
        );
        return yield* response.json;
      }).pipe(Effect.provide(layer));
      expect(answer).toEqual({ bytes: [...item.bytes], type: item.type });
    }
  }),
);

for (const length of [undefined, 6]) {
  it.live(`uploads a stream incrementally with ${length === undefined ? 'chunked' : 'known length'} framing`, () =>
    Effect.gen(function* () {
      const observed = yield* Deferred.make<void>();
      yield* Effect.addFinalizer(() => Deferred.succeed(observed, undefined));
      const server = yield* serve({
        async fetch(request) {
          let text = '';
          for await (const chunk of request.body!) {
            text += new TextDecoder().decode(chunk);
            Deferred.doneUnsafe(observed, Effect.void);
          }
          return Response.json({ text, length: request.headers.get('content-length') });
        },
      });
      const stream = Stream.concat(
        Stream.make(new TextEncoder().encode('one')),
        Stream.fromEffect(Deferred.await(observed).pipe(Effect.as(new TextEncoder().encode('two')))),
      );
      const answer = yield* Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const response = yield* client.execute(
          HttpClientRequest.post(`http://127.0.0.1:${server.port}`).pipe(
            HttpClientRequest.bodyStream(stream, { contentType: 'application/octet-stream', contentLength: length }),
          ),
        );
        return yield* response.json;
      }).pipe(Effect.provide(layer));
      expect(answer).toEqual({ text: 'onetwo', length: length === undefined ? null : '6' });
    }),
  );
}

it.live('an early HTTP refusal releases a stalled upload producer', () =>
  Effect.gen(function* () {
    const released = yield* Deferred.make<void>();
    const server = yield* serve({ fetch: () => new Response('Too large', { status: 413 }) });
    const stream = Stream.concat(Stream.make(Uint8Array.of(1)), Stream.fromEffect(Effect.never)).pipe(
      Stream.ensuring(Deferred.succeed(released, undefined)),
    );
    const answer = yield* Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(
        HttpClientRequest.post(`http://127.0.0.1:${server.port}`).pipe(HttpClientRequest.bodyStream(stream)),
      );
      const text = yield* response.text;
      yield* Deferred.await(released);
      return { status: response.status, text };
    }).pipe(Effect.provide(layer));
    expect(answer).toEqual({ status: 413, text: 'Too large' });
    yield* Deferred.await(released);
  }),
);

it.live('upload producer errors remain typed failures and release the request', () =>
  Effect.gen(function* () {
    const server = yield* serve({
      async fetch(request) {
        await request.arrayBuffer().catch(() => undefined);
        return new Response('done');
      },
    });
    const body = Stream.concat(Stream.make(Uint8Array.of(1)), Stream.fail(new Error('Source failed')));
    const result = yield* Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return yield* client.execute(HttpClientRequest.post(`http://127.0.0.1:${server.port}`).pipe(HttpClientRequest.bodyStream(body)));
    }).pipe(Effect.provide(layer), Effect.result);
    expect(result).toMatchObject({ _tag: 'Failure', failure: { reason: { _tag: 'EncodeError' } } });
  }),
);
