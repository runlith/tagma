import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest, type RequestOptions as NodeRequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { pipeline, Readable, type Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate, createZstdDecompress } from 'node:zlib';
import { Context, Effect, Layer, Stream } from 'effect';
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/http';
import type { HttpClientRequest } from 'effect/http';
import { declaredHeaders, headerNames, namedHeaders } from '../../utils/headers';

export const RequestOptions = Context.Reference<NodeRequestOptions>('@runlith/llm/verbatim/RequestOptions', {
  defaultValue: () => ({}),
});

const makeAgents = () => {
  const env = process.env;
  const proxyEnv = {
    ...env,
    http_proxy: env.http_proxy || env.HTTP_PROXY || env.all_proxy || env.ALL_PROXY,
    https_proxy: env.https_proxy || env.HTTPS_PROXY || env.all_proxy || env.ALL_PROXY,
  };
  for (const address of [proxyEnv.http_proxy, proxyEnv.https_proxy]) {
    if (!address) continue;
    const { protocol } = new URL(address);
    if (protocol !== 'http:' && protocol !== 'https:') throw new Error(`Unsupported proxy protocol: ${protocol}`);
  }
  const options = { keepAlive: true, scheduling: 'lifo' as const, timeout: 5000, proxyEnv };
  return { http: new HttpAgent(options), https: new HttpsAgent(options) };
};

const Agents = Context.Reference('@runlith/llm/verbatim/Agents', { defaultValue: makeAgents });

export const head = (
  headers: HttpClientRequest.HttpClientRequest['headers'],
  authority: string,
  length: number | undefined,
  hasBody: boolean,
) => {
  const written: Record<string, string> = {};
  for (const [name, value] of Object.entries(declaredHeaders(headers))) {
    const key = name.toLowerCase();
    if (key === 'host') written[name] = authority;
    else if (key === 'content-length') {
      if (length !== undefined) written[name] = String(length);
    } else written[name] = value;
  }
  if (!('host' in headers)) written['Host'] = authority;
  if (hasBody && length !== undefined && !('content-length' in headers) && !('transfer-encoding' in headers)) {
    written['content-length'] = String(length);
  }
  return written;
};

const send = (
  request: HttpClientRequest.HttpClientRequest,
  url: URL,
  outer: AbortSignal,
  options: NodeRequestOptions,
  payload: Uint8Array | ReadableStream<Uint8Array> | undefined,
  headers: HttpClientRequest.HttpClientRequest['headers'],
  length: number | undefined,
) =>
  Effect.callback<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>((resume, signal) => {
    const secure = url.protocol === 'https:';
    const fail = (cause: unknown) =>
      resume(
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause }),
          }),
        ),
      );
    if (outer.aborted || signal.aborted) {
      const cause = outer.reason ?? signal.reason;
      if (payload instanceof ReadableStream) void payload.cancel(cause).catch(() => undefined);
      fail(cause);
      return;
    }
    let call: ReturnType<typeof httpRequest>;
    let upload: Readable | undefined;
    try {
      call = (secure ? httpsRequest : httpRequest)(url, {
        ...options,
        method: request.method,
        headers: head(headers, url.host, length, payload !== undefined),
        signal: outer,
      });
    } catch (cause) {
      if (payload instanceof ReadableStream) void payload.cancel(cause).catch(() => undefined);
      fail(cause);
      return;
    }
    if (!('connection' in request.headers)) call.removeHeader('connection');
    call.on('error', fail);
    if (options.timeout !== undefined && options.timeout > 0) {
      call.once('timeout', () => call.destroy(Object.assign(new Error('HTTP socket timed out'), { code: 'ETIMEDOUT' })));
    }
    const stop = () => call.destroy(new Error('HTTP request interrupted'));
    signal.addEventListener('abort', stop, { once: true });
    call.once('close', () => {
      signal.removeEventListener('abort', stop);
      upload?.destroy();
    });
    call.on('response', (incoming: IncomingMessage) => {
      incoming.once('end', () => {
        if (!call.writableFinished) upload?.destroy();
      });
      const status = incoming.statusCode ?? 0;
      const hasBody = request.method !== 'HEAD' && status !== 204 && status !== 205 && status !== 304;
      const decoders: Transform[] = [];
      if (hasBody) {
        for (const coding of (incoming.headers['content-encoding'] ?? '').split(',').reverse()) {
          switch (coding.trim().toLowerCase()) {
            case '':
            case 'identity':
              break;
            case 'gzip':
              decoders.push(createGunzip());
              break;
            case 'deflate':
              decoders.push(createInflate());
              break;
            case 'br':
              decoders.push(createBrotliDecompress());
              break;
            case 'zstd':
              decoders.push(createZstdDecompress());
              break;
            default:
              incoming.destroy();
              for (const decoder of decoders) decoder.destroy();
              fail(new Error(`Unsupported HTTP content encoding: ${coding}`));
              return;
          }
        }
      }
      const decoded = decoders.at(-1) ?? incoming;
      const body = hasBody
        ? (Readable.toWeb(decoded, {
            strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength },
          }) as unknown as ReadableStream<Uint8Array>)
        : null;
      if (hasBody) {
        const abortBody = () => decoded.destroy(new Error('HTTP response interrupted'));
        outer.addEventListener('abort', abortBody, { once: true });
        decoded.once('close', () => outer.removeEventListener('abort', abortBody));
      }
      if (decoders.length > 0)
        pipeline([incoming, ...decoders], (cause) => {
          if (cause) decoded.destroy(cause);
        });
      if (!hasBody) incoming.resume();
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined) continue;
        for (const entry of Array.isArray(value) ? value : [value]) headers.append(name, entry);
      }
      if (decoders.length > 0) {
        headers.delete('content-encoding');
        headers.delete('content-length');
      }
      try {
        const web = new Response(body, { status, statusText: incoming.statusMessage, headers });
        resume(Effect.succeed(HttpClientResponse.fromWeb(request, web)));
      } catch (cause) {
        incoming.destroy();
        for (const decoder of decoders) decoder.destroy();
        fail(cause);
      }
    });
    if (payload instanceof ReadableStream) {
      upload = Readable.fromWeb(payload as unknown as Parameters<typeof Readable.fromWeb>[0]);
      upload.once('error', (cause) =>
        resume(
          Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.EncodeError({ request, cause }),
            }),
          ),
        ),
      );
      pipeline(upload, call, (cause) => {
        if (cause) fail(cause);
      });
    } else {
      call.end(payload);
    }
  });

export const verbatimHttpClient: HttpClient.HttpClient = HttpClient.transformResponse(
  HttpClient.make((request, url, signal, fiber) =>
    Effect.gen(function* () {
      const agents = fiber.getRef(Agents);
      const body = request.body;
      let payload: Uint8Array | ReadableStream<Uint8Array> | undefined;
      let length = body._tag === 'Empty' ? 0 : body.contentLength;
      let headers = request.headers;
      switch (body._tag) {
        case 'Empty':
          length = 0;
          break;
        case 'Uint8Array':
          payload = body.body;
          break;
        case 'Stream':
          payload = yield* Stream.toReadableStreamEffect(body.stream, {
            strategy: new ByteLengthQueuingStrategy({ highWaterMark: 64 * 1024 }),
          });
          break;
        case 'Raw':
        case 'FormData': {
          const encoded = yield* Effect.try({
            try: () => new Response(body._tag === 'FormData' ? body.formData : (body.body as ConstructorParameters<typeof Response>[0])),
            catch: (cause) =>
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.EncodeError({ request, cause }),
              }),
          });
          const contentType =
            encoded.headers.get('content-type') ??
            (body._tag === 'Raw' && typeof body.body === 'string' ? 'text/plain;charset=UTF-8' : null);
          payload = encoded.body ?? undefined;
          if (contentType && !(body._tag === 'Raw' && headers['content-type'])) {
            headers = namedHeaders({ ...headers, 'content-type': contentType }, headerNames(headers));
          }
          if (body._tag === 'Raw') {
            if (typeof body.body === 'string') length = Buffer.byteLength(body.body);
            else if (body.body instanceof ArrayBuffer || ArrayBuffer.isView(body.body)) length = body.body.byteLength;
            else if (body.body instanceof Blob) length = body.body.size;
            else if (body.body instanceof URLSearchParams) length = Buffer.byteLength(body.body.toString());
          }
          break;
        }
      }
      return yield* send(
        request,
        url,
        signal,
        {
          agent: url.protocol === 'https:' ? agents.https : agents.http,
          ...fiber.getRef(RequestOptions),
        },
        payload,
        headers,
        length,
      );
    }),
  ),
  Effect.provideService(HttpClient.TracerPropagationEnabled, false),
);

export const layer: Layer.Layer<HttpClient.HttpClient> = HttpClient.layerMergedContext(
  Effect.map(Agents, (agents) => HttpClient.transformResponse(verbatimHttpClient, Effect.provideService(Agents, agents))),
).pipe(
  Layer.provide(
    Layer.effect(
      Agents,
      Effect.acquireRelease(Effect.sync(makeAgents), (agents) =>
        Effect.sync(() => {
          agents.http.destroy();
          agents.https.destroy();
        }),
      ),
    ),
  ),
);
