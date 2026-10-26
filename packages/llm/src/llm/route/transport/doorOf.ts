import { Effect } from 'effect';
import { HttpClient, HttpClientError, HttpClientResponse, type HttpClientRequest } from 'effect/http';

const stubBody = (body: HttpClientRequest.HttpClientRequest['body']): RequestInit['body'] => {
  if (body._tag === 'Uint8Array') return body.body as Uint8Array<ArrayBuffer>;
  if (body._tag !== 'Raw') return undefined;
  const raw = body.body;
  if (typeof raw === 'string') return new TextEncoder().encode(raw) as Uint8Array<ArrayBuffer>;
  return raw instanceof Uint8Array ? (raw as Uint8Array<ArrayBuffer>) : undefined;
};

export const doorOf = (fetch: typeof globalThis.fetch): HttpClient.HttpClient =>
  HttpClient.transformResponse(
    HttpClient.make((request, url, signal) =>
      Effect.tryPromise({
        try: () =>
          fetch(url.toString(), {
            method: request.method,
            headers: { ...request.headers },
            body: stubBody(request.body),
            signal,
          }),
        catch: (cause) =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause }),
          }),
      }).pipe(Effect.map((response) => HttpClientResponse.fromWeb(request, response))),
    ),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
  );
