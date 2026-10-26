import { Cause, Clock, Context, Duration, Effect, Layer, Option, Random, Scope } from 'effect';
import * as ProviderShared from '../protocols/shared';
import { Headers, HttpClient, HttpClientError, type HttpClientRequest, type HttpClientResponse } from 'effect/http';
import * as VerbatimHttpClient from './transport/verbatim';
import { noted, sent } from './notes';
import { CurrentCachePrefix } from './protocol';
import { isContextOverflow } from '../provider-error';
import { isSensitiveName, isSensitiveQueryName, REDACTED, redactSecrets, secretsOf, SENSITIVE_NAME } from '../../redact';
import { VENDOR_CALL_TIMEOUT_MS } from '../../vendorCall';
import {
  familyRetries,
  HttpContext,
  HttpRateLimitDetails,
  HttpRequestDetails,
  HttpResponseDetails,
  LLMError,
  statusReason,
  type TransportFailureKind,
  TransportReason,
  type WireFailureFamily,
} from '../schema/errors';
import type { QuotaObservation } from '../schema/quota';

export type ReplyQuotaParser = (headers: Headers.Headers, observedAt: Date) => QuotaObservation | null;

export interface ReplyQuotaSink {
  readonly fromHeaders: ReplyQuotaParser;
  readonly accept: (observation: QuotaObservation | null) => void;
}

export type RateLimitKind = 'limit' | 'remaining' | 'reset';

export interface RateLimitField {
  readonly bucket: string;
  readonly kind: RateLimitKind;
}

export type RateLimitHeaders = (name: string) => RateLimitField | undefined;

export interface RequestOptions {
  readonly retry?: boolean;
  readonly rateLimits?: RateLimitHeaders | undefined;
}

export class HttpExecutor extends Context.Service<
  HttpExecutor,
  {
    readonly execute: (
      request: HttpClientRequest.HttpClientRequest,
      lifetime: Scope.Scope,
      quota?: ReplyQuotaSink,
      options?: RequestOptions,
    ) => Effect.Effect<HttpClientResponse.HttpClientResponse, LLMError>;
  }
>()('@runlith/llm/HttpExecutor') {}

const BODY_LIMIT = 16_384;
export const MAX_RETRIES = 4;
const BASE_DELAY_MS = 200;
const JITTER = 0.1;

const redactHeaders = (headers: Headers.Headers, redactedNames: ReadonlyArray<string | RegExp>) =>
  Object.fromEntries(
    Object.entries(Headers.redact(headers, [...redactedNames, SENSITIVE_NAME])).map(([name, value]) => [name, String(value)]),
  );

const redactUrl = (value: string) => {
  if (!URL.canParse(value)) return REDACTED;
  const url = new URL(value);
  url.searchParams.forEach((_, key) => {
    if (isSensitiveQueryName(key)) url.searchParams.set(key, REDACTED);
  });
  return url.toString();
};

export const normalizedHeaders = (headers: Headers.Headers) =>
  Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));

export const upstreamRequestId = (headers: Record<string, string>) => {
  return (
    headers['x-request-id'] ??
    headers['request-id'] ??
    headers['x-amzn-requestid'] ??
    headers['x-amz-request-id'] ??
    headers['x-goog-request-id'] ??
    headers['cf-ray']
  );
};

const retryAfterMs = (headers: Record<string, string>, now: number) => {
  const millis = Number(headers['retry-after-ms']);
  if (Number.isFinite(millis)) return Math.max(0, millis);

  const value = headers['retry-after'];
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
};

const rateLimitDetails = (headers: Record<string, string>, retryAfter: number | undefined, read: RateLimitHeaders | undefined) => {
  const found: Record<RateLimitKind, Record<string, string>> = { limit: {}, remaining: {}, reset: {} };
  if (read !== undefined)
    for (const [name, value] of Object.entries(headers)) {
      const field = read(name);
      if (field !== undefined && field.bucket.length > 0) found[field.kind][field.bucket] = value;
    }
  const { limit, remaining, reset } = found;

  if (retryAfter === undefined && Object.keys(limit).length === 0 && Object.keys(remaining).length === 0 && Object.keys(reset).length === 0)
    return undefined;

  return HttpRateLimitDetails.make({
    retryAfterMs: retryAfter,
    limit: Object.keys(limit).length === 0 ? undefined : limit,
    remaining: Object.keys(remaining).length === 0 ? undefined : remaining,
    reset: Object.keys(reset).length === 0 ? undefined : reset,
  });
};

const requestDetails = (request: HttpClientRequest.HttpClientRequest, redactedNames: ReadonlyArray<string | RegExp>) =>
  new HttpRequestDetails({
    method: request.method,
    url: redactUrl(request.url),
    headers: redactHeaders(request.headers, redactedNames),
  });

const responseDetails = (response: HttpClientResponse.HttpClientResponse, redactedNames: ReadonlyArray<string | RegExp>) =>
  new HttpResponseDetails({
    status: response.status,
    headers: redactHeaders(response.headers, redactedNames),
  });

export const secretValues = (request: HttpClientRequest.HttpClientRequest) => {
  const query = URL.canParse(request.url) ? [...new URL(request.url).searchParams] : [];
  return new Set([...secretsOf(Object.entries(request.headers), isSensitiveName), ...secretsOf(query, isSensitiveQueryName)]);
};

const responseBody = (
  read: { readonly _tag: 'Read'; readonly text: string } | { readonly _tag: 'Unreadable'; readonly reason: string },
  request: HttpClientRequest.HttpClientRequest,
): { readonly body?: string; readonly bodyTruncated?: true; readonly bodyUnreadable?: string } => {
  if (read._tag === 'Unreadable') return { bodyUnreadable: read.reason };
  const body = read.text;
  const redacted = redactSecrets(body, secretValues(request));
  if (redacted.length <= BODY_LIMIT) return { body: redacted };
  return { body: redacted.slice(0, BODY_LIMIT), bodyTruncated: true };
};

const providerMessage = (status: number, body: { readonly body?: string }) => {
  if (body.body && body.body.length <= 500) return `Provider request failed with HTTP ${status}: ${body.body}`;
  return `Provider request failed with HTTP ${status}`;
};

const responseHttp = (input: {
  readonly request: HttpClientRequest.HttpClientRequest;
  readonly response: HttpClientResponse.HttpClientResponse;
  readonly redactedNames: ReadonlyArray<string | RegExp>;
  readonly body: ReturnType<typeof responseBody>;
  readonly requestId?: string | undefined;
  readonly rateLimit?: HttpRateLimitDetails | undefined;
}) =>
  new HttpContext({
    request: requestDetails(input.request, input.redactedNames),
    response: responseDetails(input.response, input.redactedNames),
    ...input.body,
    requestId: input.requestId,
    rateLimit: input.rateLimit,
  });

const statusError = (
  request: HttpClientRequest.HttpClientRequest,
  redactedNames: ReadonlyArray<string | RegExp>,
  rateLimits: RateLimitHeaders | undefined,
) =>
  Effect.fnUntraced(function* (response: HttpClientResponse.HttpClientResponse) {
    if (response.status >= 200 && response.status < 300) return response;
    const read = yield* response.text.pipe(
      Effect.map((text) => ({ _tag: 'Read' as const, text })),
      Effect.catchTag('HttpClientError', (failure) => Effect.succeed({ _tag: 'Unreadable' as const, reason: failure.message })),
    );
    const headers = normalizedHeaders(response.headers);
    const retryAfter = retryAfterMs(headers, yield* Clock.currentTimeMillis);
    const rateLimit = rateLimitDetails(headers, retryAfter, rateLimits);
    const details = responseBody(read, request);
    const http = responseHttp({
      request,
      response,
      redactedNames,
      body: details,
      requestId: upstreamRequestId(headers),
      rateLimit,
    });
    return yield* new LLMError({
      module: 'RequestExecutor',
      method: 'execute',
      reason: statusReason({
        status: response.status,
        message: providerMessage(response.status, details),
        retryAfterMs: retryAfter,
        rateLimit,
        http,
        classification: isContextOverflow(http.body ?? '') ? 'context-overflow' : undefined,
      }),
    });
  });

const TRANSPORT_KIND: Readonly<Record<string, TransportFailureKind>> = {
  ENOTFOUND: 'dns',
  EAI_AGAIN: 'dns',
  EAI_NODATA: 'dns',
  EAI_NONAME: 'dns',
  ECONNRESET: 'reset',
  ECONNABORTED: 'reset',
  EPIPE: 'reset',
  ETIMEDOUT: 'connect-timeout',
  ECONNREFUSED: 'connect-timeout',
  EHOSTUNREACH: 'connect-timeout',
  ENETUNREACH: 'connect-timeout',
};

const isTlsCode = (code: string) => code.includes('CERT') || code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL');

const transportKind = (cause: unknown): TransportFailureKind => {
  const code = ProviderShared.causeCode(cause);
  if (code === undefined) return 'unknown';
  if (isTlsCode(code)) return 'tls';
  return TRANSPORT_KIND[code] ?? 'unknown';
};

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host : REDACTED);

interface TransportContext {
  readonly redactedNames: ReadonlyArray<string | RegExp>;
  readonly attempt: number;
  readonly elapsedMs: number;
}

const toHttpError = (context: TransportContext) => (error: unknown) => {
  const transportError = (input: {
    readonly message: string;
    readonly kind: TransportFailureKind;
    readonly cause: unknown;
    readonly request?: HttpClientRequest.HttpClientRequest | undefined;
  }) =>
    new LLMError({
      module: 'RequestExecutor',
      method: 'execute',
      reason: new TransportReason({
        message: input.message,
        kind: input.kind,
        host: input.request ? hostOf(input.request.url) : undefined,
        attempt: context.attempt,
        elapsedMs: context.elapsedMs,
        cause: ProviderShared.causeChain(input.cause, input.request ? secretValues(input.request) : []),
        http: input.request ? new HttpContext({ request: requestDetails(input.request, context.redactedNames) }) : undefined,
      }),
    });

  if (Cause.isTimeoutError(error)) {
    return transportError({ message: error.message, kind: 'connect-timeout', cause: error });
  }
  if (!HttpClientError.isHttpClientError(error)) {
    const kind = transportKind(error);
    return transportError({ message: `The request never left: ${kind}`, kind, cause: error });
  }
  const request = 'request' in error ? error.request : undefined;
  const kind = transportKind(error);
  return transportError({
    message: error.reason.description ?? `The request never left: ${kind}`,
    kind,
    cause: error,
    request,
  });
};

export interface RetryContext {
  readonly attempt: number;
  readonly remaining: number;
  readonly retryAfterMs?: number | undefined;
}

export type RetryVerdict = { readonly retry: false } | { readonly retry: true; readonly after: Duration.Duration };

const NO_RETRY: RetryVerdict = { retry: false };

const retryDelay = (context: RetryContext) => {
  const rung = Math.min(BASE_DELAY_MS * 2 ** context.attempt, VENDOR_CALL_TIMEOUT_MS);
  return Random.nextBetween(rung * (1 - JITTER), rung * (1 + JITTER)).pipe(Effect.map((delay) => Duration.millis(Math.round(delay))));
};

export const RetryHint = Context.Reference<boolean>('@runlith/llm/RetryHint', { defaultValue: () => false });

const REPLAY_PAUSE_MS = 250;

export const retryPause = (after: Duration.Duration): Effect.Effect<void> =>
  Effect.flatMap(RetryHint, (fast) => Effect.sleep(fast ? Duration.millis(Math.min(Duration.toMillis(after), REPLAY_PAUSE_MS)) : after));

export const retryPolicy = (family: WireFailureFamily, context: RetryContext): Effect.Effect<RetryVerdict> => {
  if (context.remaining <= 0 || !familyRetries(family)) return Effect.succeed(NO_RETRY);
  if (context.retryAfterMs !== undefined) {
    return Effect.succeed(
      context.retryAfterMs > VENDOR_CALL_TIMEOUT_MS ? NO_RETRY : ({ retry: true, after: Duration.millis(context.retryAfterMs) } as const),
    );
  }
  return Effect.map(retryDelay(context), (after) => ({ retry: true, after }) as const);
};

const retryStatusFailures = <A, R>(
  attemptOf: (transportAttempt: number) => Effect.Effect<A, LLMError, R>,
  retries = MAX_RETRIES,
  attempt = 0,
): Effect.Effect<A, LLMError, R> =>
  Effect.catchTag(attemptOf(attempt), 'LLM.Error', (error): Effect.Effect<A, LLMError, R> =>
    retryPolicy(error.family, {
      attempt,
      remaining: retries,
      retryAfterMs: error.retryAfterMs,
    }).pipe(
      Effect.flatMap((verdict) => {
        if (!verdict.retry) return Effect.fail(error);
        return noted({ type: 'retry-scheduled', transportAttempt: attempt, delayMs: Duration.toMillis(verdict.after) }).pipe(
          Effect.flatMap(() => retryPause(verdict.after)),
          Effect.flatMap(() => retryStatusFailures(attemptOf, retries - 1, attempt + 1)),
        );
      }),
    ),
  );

const reportResponded = (request: number | null, startedAt: number, response: HttpClientResponse.HttpClientResponse) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) => {
    const answered = upstreamRequestId(normalizedHeaders(response.headers));
    return noted({
      type: 'http-responded',
      request,
      status: response.status,
      afterMs: now - startedAt,
      upstreamRequestId: answered || undefined,
    });
  });

const reportFailed = (request: number | null, startedAt: number, error: LLMError) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) => {
    const http = 'http' in error.reason ? error.reason.http : undefined;
    const status = http?.response?.status;
    const upstreamRequestId = http?.requestId;
    return noted({
      type: 'http-failed',
      request,
      reason: error.reason._tag,
      family: error.family,
      retryable: error.retryable,
      message: error.reason.message,
      afterMs: now - startedAt,
      status,
      upstreamRequestId,
      retryAfterMs: error.retryAfterMs,
    });
  });

export const httpExecutorLayer: Layer.Layer<HttpExecutor, never, HttpClient.HttpClient> = Layer.effect(
  HttpExecutor,
  Effect.gen(function* () {
    const http = HttpClient.withScope(yield* HttpClient.HttpClient);
    const executeOnce = Effect.fn('HttpExecutor.attempt')(function* (
      request: HttpClientRequest.HttpClientRequest,
      transportAttempt: number,
      quota: ReplyQuotaSink | undefined,
      rateLimits: RateLimitHeaders | undefined,
      body: number | null,
    ) {
      const redactedNames = yield* Headers.CurrentRedactedNames;
      const startedAt = yield* Clock.currentTimeMillis;
      const cachePrefix = yield* CurrentCachePrefix;
      const sent = yield* noted({
        type: 'http-started',
        transportAttempt,
        body,
        method: request.method,
        url: redactUrl(request.url),
        cachePrefix: cachePrefix || undefined,
      });
      return yield* http.execute(request).pipe(
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        Effect.catch((error) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Effect.fail(toHttpError({ redactedNames, attempt: transportAttempt, elapsedMs: now - startedAt })(error)),
          ),
        ),
        Effect.tap((response) => reportResponded(sent, startedAt, response)),
        Effect.flatMap(statusError(request, redactedNames, rateLimits)),
        Effect.tap((response) =>
          quota === undefined
            ? Effect.void
            : Clock.currentTimeMillis.pipe(
                Effect.flatMap((observedAt) =>
                  Effect.sync(() =>
                    quota.accept(quota.fromHeaders(Headers.fromInput(normalizedHeaders(response.headers)), new Date(observedAt))),
                  ),
                ),
              ),
        ),
        Effect.tapError((error) => reportFailed(sent, startedAt, error)),
      );
    });
    return HttpExecutor.of({
      execute: (request, lifetime, quota, options) =>
        Effect.flatMap(sent(request), (body) =>
          retryStatusFailures(
            (transportAttempt) => executeOnce(request, transportAttempt, quota, options?.rateLimits, body),
            options?.retry === false ? 0 : MAX_RETRIES,
          ),
        ).pipe(Effect.provideService(Scope.Scope, lifetime)),
    });
  }),
);

export const wireExecutorLayer = httpExecutorLayer.pipe(Layer.provide(VerbatimHttpClient.layer));

export const doorExecutorLayer = (client: HttpClient.HttpClient) =>
  httpExecutorLayer.pipe(Layer.provide(HttpClient.layerMergedContext(Effect.succeed(client))));
