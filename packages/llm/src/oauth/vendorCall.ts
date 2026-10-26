import { Effect, type Layer } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import { layer as wire } from '../llm/route/transport/verbatim';
import { namedHeaders } from '../llm/utils/headers';
import { oauthFailure } from './flows/vendorPayload';

export type VendorAnswer = {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly text: string;
};

export const vendorCall = Effect.fn('OAuth.vendorCall')(function* (url: string, headers: Readonly<Record<string, string>>, body?: string) {
  const client = yield* HttpClient.HttpClient;
  const type = headers['Content-Type'] ?? headers['content-type'] ?? 'application/json';
  const request =
    body === undefined
      ? HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(headers))
      : HttpClientRequest.post(url).pipe(HttpClientRequest.setHeaders(headers), HttpClientRequest.bodyText(body, type));
  const response = yield* client
    .execute(request.pipe(HttpClientRequest.updateHeaders((values) => namedHeaders(values, Object.keys(headers)))))
    .pipe(Effect.scoped);
  const text = yield* response.text;
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: '',
    text,
  } satisfies VendorAnswer;
});

export const vendorCallOrFail = (url: string, headers: Readonly<Record<string, string>>, body?: string) =>
  vendorCall(url, headers, body).pipe(Effect.mapError((cause) => oauthFailure(cause)));

export const vendorWire: Layer.Layer<HttpClient.HttpClient> = wire;

export const runFlow = <A, E>(flow: Effect.Effect<A, E, HttpClient.HttpClient>): Promise<A> =>
  Effect.runPromise(flow.pipe(Effect.provide(vendorWire)));
