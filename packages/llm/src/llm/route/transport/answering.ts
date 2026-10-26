import { Effect } from 'effect';
import { HttpClient, HttpClientError, HttpClientResponse, type HttpClientRequest } from 'effect/http';

export type Sent = {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly bytes: Uint8Array;
  readonly text: string;
};

const bodyBytes = (body: HttpClientRequest.HttpClientRequest['body']): Uint8Array => {
  if (body._tag === 'Uint8Array') return body.body;
  if (body._tag !== 'Raw') return new Uint8Array();
  const raw = body.body;
  if (typeof raw === 'string') return new TextEncoder().encode(raw);
  return raw instanceof Uint8Array ? raw : new TextEncoder().encode(String(raw));
};

export const answering = (respond: (sent: Sent) => Response | Promise<Response>): HttpClient.HttpClient =>
  HttpClient.make((request, url, signal) => {
    const bytes = bodyBytes(request.body);
    const sent: Sent = {
      url: url.toString(),
      method: request.method,
      headers: { ...request.headers },
      signal,
      bytes,
      get text() {
        return new TextDecoder().decode(bytes);
      },
    };
    return Effect.tryPromise({
      try: (): Promise<Response> => Promise.resolve(respond(sent)),
      catch: (cause) =>
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request, cause }),
        }),
    }).pipe(
      Effect.flatMap((response) => {
        if (signal.aborted) return Effect.never;
        return Effect.succeed(HttpClientResponse.fromWeb(request, response));
      }),
    );
  });
