import { Clock, Context, Effect, Layer, Schema } from 'effect';
import { Headers, HttpClient, HttpClientRequest } from 'effect/http';
import * as Auth from '../llm/route/auth';
import { HttpExecutor, httpExecutorLayer } from '../llm/route/executor';
import * as VerbatimHttpClient from '../llm/route/transport/verbatim';
import { VENDOR_CALL_TIMEOUT_MS } from '../vendorCall';
import type { LLMError } from '../llm/schema/errors';
import {
  QuotaInvalidResponse,
  type QuotaFailure,
  QuotaMissingScope,
  QuotaRateLimited,
  QuotaServerFailure,
  QuotaStaleToken,
  QuotaTransportFailure,
  QuotaUnsupported,
} from '../llm/schema/quota';

export type QuotaReply = {
  readonly body: Schema.Json;
  readonly observedAt: Date;
};

export type QuotaGetInput = {
  readonly url: string;
  readonly auth: Auth.Auth;
  readonly headers?: Record<string, string>;
};

export type QuotaPostInput = QuotaGetInput & { readonly body: Schema.Json };

type QuotaRequestInput = QuotaGetInput & { readonly method: 'GET' | 'POST'; readonly body?: Schema.Json };

const responseBody = (error: LLMError): string => ('http' in error.reason ? (error.reason.http?.body ?? '') : '');

export const quotaFailure = (error: LLMError): QuotaFailure => {
  if (error.status === 401) return new QuotaStaleToken();
  if (error.status === 403) {
    return /user:profile/i.test(responseBody(error)) ? new QuotaMissingScope({ scope: 'user:profile' }) : new QuotaStaleToken();
  }
  if (error.status === 429) {
    return new QuotaRateLimited({ retryAfterMs: error.retryAfterMs });
  }
  if (error.status !== undefined && error.status >= 500) {
    return new QuotaServerFailure({ status: error.status });
  }
  if (error.reason._tag === 'Transport') {
    return new QuotaTransportFailure({ message: error.message });
  }
  if (error.reason._tag === 'Authentication') return new QuotaStaleToken();
  return new QuotaInvalidResponse({ message: error.message });
};

export const unsupportedQuota = () => Effect.fail(new QuotaUnsupported());

const requestQuota = Effect.fn('LLM.quotaGet')(function* (input: QuotaRequestInput) {
  const method = input.method;
  const headers = yield* Auth.toEffect(input.auth)({
    method,
    url: input.url,
    body: input.body === undefined ? '' : JSON.stringify(input.body),
    headers: Headers.fromInput(input.headers ?? {}),
  }).pipe(Effect.mapError(quotaFailure));
  const initial = HttpClientRequest.make(method)(input.url).pipe(HttpClientRequest.setHeaders(headers));
  const request =
    input.body === undefined
      ? initial
      : yield* HttpClientRequest.bodyJson(initial, input.body).pipe(
          Effect.mapError((error) => new QuotaInvalidResponse({ message: error.message })),
        );
  const executor = yield* HttpExecutor;
  const body = yield* Effect.scopedWith((lifetime) =>
    executor.execute(request, lifetime, undefined, { retry: false }).pipe(
      Effect.mapError(quotaFailure),
      Effect.flatMap((response) =>
        response.json.pipe(Effect.mapError(() => new QuotaInvalidResponse({ message: 'The quota endpoint answer was not JSON.' }))),
      ),
    ),
  );
  return { body, observedAt: new Date(yield* Clock.currentTimeMillis) };
});

export const QuotaDoor = Context.Reference<HttpClient.HttpClient | undefined>('@runlith/llm/QuotaDoor', { defaultValue: () => undefined });

export const withQuotaWire = Effect.fnUntraced(function* <A, E>(
  call: Effect.Effect<A, E, HttpClient.HttpClient | HttpExecutor>,
): Effect.fn.Return<A, E> {
  const door = yield* QuotaDoor;
  const http: Layer.Layer<HttpClient.HttpClient, never, never> =
    door === undefined ? VerbatimHttpClient.layer : HttpClient.layerMergedContext(Effect.succeed(door));
  return yield* call.pipe(Effect.provide(httpExecutorLayer.pipe(Layer.provideMerge(http))));
});

const quotaRequest = (input: QuotaRequestInput) =>
  withQuotaWire(
    requestQuota(input).pipe(
      Effect.timeoutOrElse({
        duration: VENDOR_CALL_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(
            new QuotaTransportFailure({
              message: `The quota endpoint did not answer within ${VENDOR_CALL_TIMEOUT_MS}ms.`,
            }),
          ),
      }),
    ),
  );

export const quotaGet = (input: QuotaGetInput) => quotaRequest({ ...input, method: 'GET' });

export const quotaPost = (input: QuotaPostInput) => quotaRequest({ ...input, method: 'POST' });
