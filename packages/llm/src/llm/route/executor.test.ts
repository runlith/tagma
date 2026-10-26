import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Random, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Headers, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from 'effect/http';
import { activity } from '@runlith/activity/Activity';
import type { ActivityFact } from '@runlith/activity/fact';
import { ActivityLog } from '@runlith/activity/log';
import { MODEL_CALL } from '@runlith/activity/modelCall';
import * as LLM from '../call';
import * as OpenAIResponses from '../protocols/openai-responses';
import * as AnthropicRateLimits from '../protocols/anthropic/rateLimits';
import * as OpenAIRateLimits from '../protocols/openai/rateLimits';
import { LLMError, type WireFailureFamily } from '../schema/errors';
import { QuotaObservation, QuotaWindow } from '../schema/quota';
import { HttpExecutor, RetryHint, httpExecutorLayer, retryPause, retryPolicy } from './executor';
import type { ReplyQuotaSink, RequestOptions, RetryContext } from './executor';
import { CurrentCachePrefix } from './protocol';
import { fold, llmClientLayer } from './client';

interface Reply {
  readonly status: number;
  readonly body?: string;
  readonly headers?: Record<string, string>;
}

const call = HttpClientRequest.post('https://provider.test/v1/chat?api_key=secret-query-value&debug=1').pipe(
  HttpClientRequest.setHeaders(Headers.fromInput({ authorization: 'Bearer secret-header-value', 'x-trace': 'visible' })),
);

const redactedUrl = 'https://provider.test/v1/chat?api_key=%3Credacted%3E&debug=1';

const wire = (
  answer: (
    request: HttpClientRequest.HttpClientRequest,
    attempt: number,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>,
) => {
  let attempts = 0;
  const client = HttpClient.make((request) => Effect.suspend(() => answer(request, attempts++)));
  return {
    layer: httpExecutorLayer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client))),
    attempts: () => attempts,
  };
};

const replying = (...replies: ReadonlyArray<Reply>) =>
  wire((request, attempt) => {
    const reply = replies[Math.min(attempt, replies.length - 1)]!;
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(reply.body ?? '', { status: reply.status, headers: reply.headers })),
    );
  });

type Wire = ReturnType<typeof wire>;

const execute = Effect.fnUntraced(
  function* (open: Wire, request: HttpClientRequest.HttpClientRequest = call, quota?: ReplyQuotaSink, options?: RequestOptions) {
    const executor = yield* HttpExecutor;
    const lifetime = yield* Scope.make();
    return yield* executor.execute(request, lifetime, quota, options).pipe(Effect.ensuring(Scope.close(lifetime, Exit.void)));
  },
  (effect, open, _request?: HttpClientRequest.HttpClientRequest, _quota?: ReplyQuotaSink, _options?: RequestOptions) =>
    Effect.provide(effect, open.layer),
);

const hanging = Effect.fnUntraced(function* () {
  const reached = yield* Deferred.make<AbortSignal>();
  const client = HttpClient.make((request, _url, signal) => {
    Deferred.doneUnsafe(reached, Effect.succeed(signal));
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(new ReadableStream({ start() {} }), { status: 200 })));
  });
  return {
    reached,
    layer: httpExecutorLayer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client))),
  };
});

const aborting = (signal: AbortSignal) =>
  signal.aborted
    ? Effect.void
    : Effect.callback<void>((resume) => {
        const done = () => resume(Effect.void);
        signal.addEventListener('abort', done, { once: true });
        return Effect.sync(() => signal.removeEventListener('abort', done));
      });

const failure = (open: Wire, request?: HttpClientRequest.HttpClientRequest) => Effect.flip(execute(open, request));

const httpOf = (error: LLMError) => ('http' in error.reason ? error.reason.http : undefined);

const midpointRandom = { nextDoubleUnsafe: () => 0.5, nextIntUnsafe: () => 0 };

const callerFault: ReadonlyArray<{
  readonly status: number;
  readonly tag: LLMError['reason']['_tag'];
  readonly kind?: string;
}> = [
  { status: 400, tag: 'InvalidRequest' },
  { status: 401, tag: 'Authentication', kind: 'invalid' },
  { status: 403, tag: 'Authentication', kind: 'insufficient-permissions' },
  { status: 404, tag: 'InvalidRequest' },
  { status: 409, tag: 'InvalidRequest' },
  { status: 413, tag: 'InvalidRequest' },
  { status: 422, tag: 'InvalidRequest' },
  { status: 418, tag: 'UnknownProvider' },
];
it.live('a non-2xx the caller must fix carries its own tagged reason and is never retried', () =>
  Effect.gen(function* () {
    for (const expected of callerFault) {
      const open = replying({ status: expected.status, body: 'refused' });
      const error = yield* failure(open);

      expect(error).toBeInstanceOf(LLMError);
      expect(error.reason._tag).toBe(expected.tag);
      if (expected.kind !== undefined) expect(error.reason).toMatchObject({ kind: expected.kind });
      expect(error.retryable).toBe(false);
      expect(open.attempts()).toBe(1);
    }
  }),
);

it.live('a 3xx redirect fails here instead of being followed', () =>
  Effect.gen(function* () {
    const open = replying({ status: 302, body: 'moved', headers: { location: 'https://elsewhere.test/v1/chat' } });
    const error = yield* failure(open);

    expect(error.reason).toMatchObject({ _tag: 'UnknownProvider', status: 302 });
    expect(open.attempts()).toBe(1);
  }),
);

it.live('a server-side status becomes a retryable ProviderInternal and stops after four retries', () =>
  Effect.gen(function* () {
    for (const status of [500, 503, 504, 529]) {
      const open = replying({ status, body: 'busy', headers: { 'retry-after-ms': '0' } });
      const error = yield* failure(open);

      expect(error.reason).toMatchObject({ _tag: 'ProviderInternal', status, retryAfterMs: 0 });
      expect(error.retryable).toBe(true);
      expect(open.attempts()).toBe(5);
    }
  }),
);

it.live('a retryable failure that clears answers the response instead of the error', () =>
  Effect.gen(function* () {
    const open = replying({ status: 503, body: 'busy', headers: { 'retry-after-ms': '0' } }, { status: 200, body: 'ok' });
    const response = yield* execute(open);

    expect(response.status).toBe(200);
    expect(open.attempts()).toBe(2);
  }),
);

it.live('a caller may keep a retryable status to one transport attempt', () =>
  Effect.gen(function* () {
    const open = replying({ status: 503, body: 'busy', headers: { 'retry-after-ms': '0' } });
    const error = yield* Effect.flip(execute(open, call, undefined, { retry: false }));

    expect(error.reason).toMatchObject({ _tag: 'ProviderInternal', status: 503 });
    expect(open.attempts()).toBe(1);
  }),
);

it.effect('a successful reply is parsed for quota at the runtime clock before its body is read', () =>
  Effect.gen(function* () {
    const open = replying({ status: 200, body: 'ok', headers: { 'x-provider-used-percent': '12.5' } });
    let parserObservedAt: Date | undefined;
    let accepted: QuotaObservation | null | undefined;

    yield* execute(open, call, {
      fromHeaders: (headers, observedAt) => {
        parserObservedAt = observedAt;
        return headers['x-provider-used-percent'] === '12.5'
          ? new QuotaObservation({
              observedAt,
              source: 'reply',
              windows: [
                new QuotaWindow({
                  kind: 'session',
                  usedPercent: 12.5,
                }),
              ],
            })
          : null;
      },
      accept: (value) => {
        accepted = value;
      },
    });

    expect(parserObservedAt).toEqual(new Date(0));
    expect(accepted?.observedAt).toEqual(parserObservedAt);
  }),
);

it.live('the mapped reply quota rides the call step-finish event', () =>
  Effect.gen(function* () {
    const observation = new QuotaObservation({
      observedAt: new Date('2026-09-02T12:00:00Z'),
      source: 'reply',
      windows: [],
    });
    const open = replying({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-provider-quota': 'seen' },
      body: 'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
    });
    const model = OpenAIResponses.route
      .with({
        provider: 'quota-test',
        endpoint: { baseURL: 'https://provider.test/v1' },
        quota: (headers) => (headers['x-provider-quota'] === 'seen' ? observation : null),
      })
      .model({ id: 'model-test' });
    const request = LLM.request({ model, prompt: 'Hello' });
    const events: Array<unknown> = [];

    yield* fold(request, (event) => events.push(event)).pipe(Effect.provide(llmClientLayer.pipe(Layer.provide(open.layer))));

    expect(events).toContainEqual(expect.objectContaining({ type: 'step-finish', quota: observation }));
  }),
);

it.live('a 429 records the retry hint and the rate-limit buckets of the dialect the caller names', () =>
  Effect.gen(function* () {
    const openai = replying({
      status: 429,
      body: 'slow down',
      headers: {
        'retry-after-ms': '0',
        'x-request-id': 'req_42',
        'x-ratelimit-limit-requests': '500',
        'x-ratelimit-remaining-requests': '499',
        'x-ratelimit-reset-requests': '1s',
      },
    });
    const openaiError = yield* Effect.flip(execute(openai, call, undefined, { rateLimits: OpenAIRateLimits.rateLimits }));

    expect(openaiError.reason).toMatchObject({
      _tag: 'RateLimit',
      retryAfterMs: 0,
      rateLimit: {
        retryAfterMs: 0,
        limit: { requests: '500' },
        remaining: { requests: '499' },
        reset: { requests: '1s' },
      },
    });
    expect(openaiError.retryable).toBe(true);
    expect(httpOf(openaiError)?.requestId).toBe('req_42');

    const anthropic = replying({
      status: 429,
      body: 'slow down',
      headers: {
        'retry-after-ms': '0',
        'anthropic-ratelimit-input-tokens-limit': '10000',
        'anthropic-ratelimit-input-tokens-remaining': '9000',
        'anthropic-ratelimit-input-tokens-reset': '2026-05-06T12:00:10Z',
      },
    });
    const anthropicError = yield* Effect.flip(execute(anthropic, call, undefined, { rateLimits: AnthropicRateLimits.rateLimits }));

    expect(httpOf(anthropicError)?.rateLimit).toMatchObject({
      limit: { 'input-tokens': '10000' },
      remaining: { 'input-tokens': '9000' },
      reset: { 'input-tokens': '2026-05-06T12:00:10Z' },
    });

    const unnamed = yield* failure(anthropic);
    expect(httpOf(unnamed)?.rateLimit).toEqual({ retryAfterMs: 0 });
  }),
);

it.live('a 429 whose body names an exhausted quota is QuotaExceeded and stops retrying', () =>
  Effect.gen(function* () {
    const open = replying({ status: 429, body: '{"error":{"code":"insufficient_quota"}}' });
    const error = yield* failure(open);

    expect(error.reason._tag).toBe('QuotaExceeded');
    expect(error.retryable).toBe(false);
    expect(open.attempts()).toBe(1);
  }),
);

it.live('a body naming a content policy classifies as ContentPolicy whatever the status says', () =>
  Effect.gen(function* () {
    for (const status of [400, 500]) {
      const open = replying({ status, body: '{"error":{"code":"content_filter"}}' });
      const error = yield* failure(open);

      expect(error.reason._tag).toBe('ContentPolicy');
      expect(error.retryable).toBe(false);
      expect(open.attempts()).toBe(1);
    }
  }),
);

it.live('a 400 naming a context overflow is classified as one; an ordinary 400 is not', () =>
  Effect.gen(function* () {
    const overflow = replying({
      status: 400,
      body: '{"error":{"code":"context_length_exceeded","message":"prompt is too long"}}',
    });
    const overflowError = yield* failure(overflow);

    expect(overflowError.reason).toMatchObject({ _tag: 'InvalidRequest', classification: 'context-overflow' });

    const ordinary = replying({ status: 400, body: '{"error":{"message":"unsupported value for temperature"}}' });
    const ordinaryError = yield* failure(ordinary);

    expect(ordinaryError.reason._tag).toBe('InvalidRequest');
    expect('classification' in ordinaryError.reason ? ordinaryError.reason.classification : 'absent').toBeUndefined();
  }),
);

it.effect('without a provider hint the four retries climb the fast ladder from 200 ms', () =>
  Effect.gen(function* () {
    const open = replying({ status: 503, body: 'busy' });
    const running = yield* Effect.forkChild(failure(open));

    yield* Effect.yieldNow;
    expect(open.attempts()).toBe(1);

    yield* TestClock.adjust(199);
    yield* Effect.yieldNow;
    expect(open.attempts()).toBe(1);

    yield* TestClock.adjust(1);
    yield* Effect.yieldNow;
    expect(open.attempts()).toBe(2);

    yield* TestClock.adjust(399);
    yield* Effect.yieldNow;
    expect(open.attempts()).toBe(2);

    yield* TestClock.adjust(1);
    yield* Effect.yieldNow;
    expect(open.attempts()).toBe(3);

    yield* TestClock.adjust(800);
    yield* Effect.yieldNow;
    expect(open.attempts()).toBe(4);

    yield* TestClock.adjust(1_600);
    const error = yield* Fiber.join(running);

    expect(error.reason).toMatchObject({ _tag: 'ProviderInternal', status: 503 });
    expect(open.attempts()).toBe(5);
  }).pipe(Effect.provideService(Random.Random, midpointRandom)),
);

it.effect('Retry-After decides the wait when it fits under one call, and a longer one is handed up unretried', () =>
  Effect.gen(function* () {
    const seconds = replying({ status: 503, body: 'busy', headers: { 'retry-after': '2' } }, { status: 200, body: 'ok' });
    const running = yield* Effect.forkChild(execute(seconds));

    yield* Effect.yieldNow;
    yield* TestClock.adjust(1_999);
    yield* Effect.yieldNow;
    expect(seconds.attempts()).toBe(1);

    yield* TestClock.adjust(1);
    const afterSeconds = yield* Fiber.join(running);

    expect(afterSeconds.status).toBe(200);
    expect(seconds.attempts()).toBe(2);

    const long = replying({ status: 429, body: 'slow down', headers: { 'retry-after-ms': '60000' } });
    const handedUp = yield* failure(long);

    expect(handedUp.reason).toMatchObject({ _tag: 'RateLimit', retryAfterMs: 60_000 });
    expect(handedUp.retryable).toBe(true);
    expect(long.attempts()).toBe(1);
  }),
);

it.effect('Retry-After as an HTTP date is measured against the runtime clock', () =>
  Effect.gen(function* () {
    const dated = replying(
      { status: 503, body: 'busy', headers: { 'retry-after': new Date(3_000).toUTCString() } },
      { status: 200, body: 'ok' },
    );
    const running = yield* Effect.forkChild(execute(dated));

    yield* Effect.yieldNow;
    yield* TestClock.adjust(2_999);
    yield* Effect.yieldNow;
    expect(dated.attempts()).toBe(1);

    yield* TestClock.adjust(1);
    const answered = yield* Fiber.join(running);

    expect(answered.status).toBe(200);
    expect(dated.attempts()).toBe(2);
  }),
);

it.live('secrets in request headers, response headers and URL query never reach the recorded context', () =>
  Effect.gen(function* () {
    const open = replying({
      status: 400,
      body: 'bad request',
      headers: { 'x-api-key': 'response-secret', 'x-trace': 'response-visible' },
    });
    const error = yield* failure(open);
    const http = httpOf(error);

    expect(http?.request.url).toBe(redactedUrl);
    expect(http?.request.headers.authorization).toBe('<redacted>');
    expect(http?.request.headers['x-trace']).toBe('visible');
    expect(http?.response?.headers['x-api-key']).toBe('<redacted>');
    expect(http?.response?.headers['x-trace']).toBe('response-visible');
  }),
);

it.live('the ambient redacted-name list widens what the recorded context hides', () =>
  Effect.gen(function* () {
    const open = replying({ status: 400, body: 'bad request', headers: { 'x-trace': 'response-secret' } });
    const error = yield* failure(open).pipe(Effect.provideService(Headers.CurrentRedactedNames, ['x-trace']));

    expect(httpOf(error)?.request.headers['x-trace']).toBe('<redacted>');
    expect(httpOf(error)?.response?.headers['x-trace']).toBe('<redacted>');
  }),
);

it.live('sensitive body fields and echoed request secrets are replaced in the recorded body', () =>
  Effect.gen(function* () {
    const open = replying({
      status: 400,
      body: '{"message":"bad","key":"body-secret","detail":"api_key=leaked-in-body","echo":"sent secret-header-value and secret-query-value"}',
    });
    const error = yield* failure(open);
    const body = httpOf(error)?.body ?? '';

    expect(body).toContain('"key":"<redacted>"');
    expect(body).toContain('api_key=<redacted>');
    expect(body).not.toContain('body-secret');
    expect(body).not.toContain('leaked-in-body');
    expect(body).not.toContain('secret-header-value');
    expect(body).not.toContain('secret-query-value');
  }),
);

it.live('an oversized error body is recorded truncated rather than whole', () =>
  Effect.gen(function* () {
    const open = replying({ status: 400, body: 'x'.repeat(20_000) });
    const error = yield* failure(open);

    expect(httpOf(error)?.body).toHaveLength(16_384);
    expect(httpOf(error)?.bodyTruncated).toBe(true);
  }),
);

const neverLeft = (cause: unknown) =>
  wire((request) =>
    Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({ request, cause, description: 'connection failed' }),
      }),
    ),
  );

const platformFailure = (code: string) => Object.assign(new Error(`the socket said ${code}`), { code });

it.live('a failure before the first status byte names its kind and keeps the platform code in its chain', () =>
  Effect.gen(function* () {
    const kinds = [
      ['ECONNRESET', 'reset'],
      ['EPIPE', 'reset'],
      ['ENOTFOUND', 'dns'],
      ['EAI_AGAIN', 'dns'],
      ['ECONNREFUSED', 'connect-timeout'],
      ['ETIMEDOUT', 'connect-timeout'],
      ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'],
      ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls'],
      ['ESOMETHINGNOBODYNAMED', 'unknown'],
    ] as const;

    for (const [code, kind] of kinds) {
      const open = neverLeft(platformFailure(code));
      const error = yield* Effect.flip(execute(open, call, undefined, { retry: false }));

      expect(error.reason).toMatchObject({ _tag: 'Transport', kind, host: 'provider.test', attempt: 0 });
      const chain = 'cause' in error.reason ? error.reason.cause : undefined;
      expect(chain?.at(-1)?.message).toContain(code);
      expect(open.attempts()).toBe(1);
    }
  }),
);

it.live('a transport failure records the request it never completed, with nothing secret in it', () =>
  Effect.gen(function* () {
    const open = neverLeft(platformFailure('ECONNRESET'));
    const error = yield* Effect.flip(execute(open, call, undefined, { retry: false }));

    expect(httpOf(error)?.request.url).toBe(redactedUrl);
    expect(httpOf(error)?.request.headers.authorization).toBe('<redacted>');
    expect(httpOf(error)?.response).toBeUndefined();
    expect(error.reason).toMatchObject({ message: 'connection failed' });
  }),
);

it.effect('a request that never reached a status byte is asked again, four times, on the same ladder', () =>
  Effect.gen(function* () {
    const open = neverLeft(platformFailure('ECONNRESET'));
    const running = yield* Effect.forkChild(failure(open));

    yield* Effect.yieldNow;
    expect(open.attempts()).toBe(1);

    yield* TestClock.adjust(200);
    yield* Effect.yieldNow;
    expect(open.attempts()).toBe(2);

    yield* TestClock.adjust(400 + 800 + 1_600);
    const error = yield* Fiber.join(running);

    expect(error.reason).toMatchObject({ _tag: 'Transport', kind: 'reset', attempt: 4 });
    expect(error.retryable).toBe(true);
    expect(open.attempts()).toBe(5);
  }).pipe(Effect.provideService(Random.Random, midpointRandom)),
);

describe('the retry table', () => {
  const ask = (family: WireFailureFamily, context: Partial<RetryContext> = {}) =>
    retryPolicy(family, { attempt: 0, remaining: 2, ...context }).pipe(Effect.provideService(Random.Random, midpointRandom));

  it.effect('asks again for what a repeat could answer differently, and not for what it could not', () =>
    Effect.gen(function* () {
      for (const family of ['torn-stream', 'socket-closed', 'clean-eof-no-finish', 'dns', 'reset', 'rate-limit'] as const)
        expect((yield* ask(family)).retry).toBe(true);
      for (const family of ['auth', 'quota', 'content-policy', 'refused', 'invalid-output', 'stalled'] as const)
        expect((yield* ask(family)).retry).toBe(false);
    }),
  );

  it.effect('stops for a caller out of attempts', () =>
    Effect.gen(function* () {
      expect((yield* ask('torn-stream', { remaining: 0 })).retry).toBe(false);
    }),
  );

  it.effect('waits what the provider named when it fits under one call, and hands a longer wait up', () =>
    Effect.gen(function* () {
      const short = yield* ask('rate-limit', { retryAfterMs: 250 });
      expect(short.retry && Duration.toMillis(short.after)).toBe(250);
      expect((yield* ask('rate-limit', { retryAfterMs: 30_000 })).retry).toBe(false);
    }),
  );

  it.effect('climbs the fast ladder from 200 ms, doubling per attempt', () =>
    Effect.gen(function* () {
      const first = yield* ask('torn-stream', { attempt: 0 });
      const third = yield* ask('torn-stream', { attempt: 2 });
      expect(first.retry && Duration.toMillis(first.after)).toBe(200);
      expect(third.retry && Duration.toMillis(third.after)).toBe(800);
    }),
  );
});

it.effect('a replayed pause ends after its grace; an ordinary one waits the decided delay out', () =>
  Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(retryPause(Duration.minutes(3)));
      yield* Effect.yieldNow;
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust(250);
      yield* Fiber.join(fiber);
    }).pipe(Effect.provideService(RetryHint, true));

    const fiber = yield* Effect.forkChild(retryPause(Duration.minutes(3)));
    yield* Effect.yieldNow;
    expect(fiber.pollUnsafe()).toBeUndefined();
    yield* TestClock.adjust(250);
    yield* Effect.yieldNow;
    expect(fiber.pollUnsafe()).toBeUndefined();
    yield* TestClock.adjust(Duration.minutes(3));
    yield* Fiber.join(fiber);
  }),
);

const noting = (facts: ActivityFact[]) => ({ record: (fact: ActivityFact) => void facts.push(fact), settled: Effect.void });

const notesOf = (facts: readonly ActivityFact[]) =>
  facts.flatMap((fact) => (fact._tag === 'Noted' ? [fact.note as { readonly type: string } & Record<string, unknown>] : []));

const called = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  activity(MODEL_CALL, { provider: 'anthropic', model: 'claude', rung: null }, effect);

it.live('the wire notes every request it sends on the model call it serves, and each answer names the request it answers', () =>
  Effect.gen(function* () {
    const open = replying(
      { status: 429, body: 'slow down', headers: { 'retry-after-ms': '0', 'x-request-id': 'req_1' } },
      { status: 200, body: 'ok', headers: { 'x-request-id': 'req_2' } },
    );
    const facts: ActivityFact[] = [];

    yield* called(execute(open)).pipe(Effect.provideService(ActivityLog, noting(facts)));

    const notes = notesOf(facts);
    expect(notes.map((note) => note.type)).toEqual([
      'http-started',
      'http-responded',
      'http-failed',
      'retry-scheduled',
      'http-started',
      'http-responded',
    ]);
    expect(notes[0]).toMatchObject({ transportAttempt: 0, method: 'POST', url: redactedUrl });
    expect(notes[1]).toMatchObject({ request: 1, status: 429 });
    expect(notes[2]).toMatchObject({ request: 1, reason: 'RateLimit', retryable: true, status: 429, upstreamRequestId: 'req_1' });
    expect(notes[4]).toMatchObject({ transportAttempt: 1 });
    expect(notes[5]).toMatchObject({ request: 5, status: 200, upstreamRequestId: 'req_2' });
  }),
);

it.live('transport retries name their wire body and a changed fold retry keeps its own body under the same model call', () =>
  Effect.gen(function* () {
    const facts: ActivityFact[] = [];
    const bytes = (text: string) => HttpClientRequest.bodyUint8Array(call, new TextEncoder().encode(text), 'application/json');
    const first = '{"messages":["first"]}';
    const second = '{"messages":["first","second"]}';
    yield* called(
      Effect.gen(function* () {
        yield* execute(replying({ status: 503, headers: { 'retry-after-ms': '0' } }, { status: 200 }), bytes(first));
        yield* execute(replying({ status: 200 }), bytes(second));
      }),
    ).pipe(Effect.provideService(ActivityLog, noting(facts)));
    const held = facts.filter((fact) => fact._tag === 'Bodied');
    expect(held.map((fact) => fact.n)).toEqual([1, 2]);
    expect(held.map((fact) => ('encoded' in fact.body ? new TextDecoder().decode(fact.body.encoded) : null))).toEqual([first, second]);
    expect(
      notesOf(facts)
        .filter((note) => note.type === 'http-started')
        .map((note) => note.body),
    ).toEqual([1, 1, 2]);
    expect(new Set(held.map((fact) => fact.activity)).size).toBe(1);
  }),
);

it.live('a request carries the digest of the prefix the provider will match, when the wire declares one', () =>
  Effect.gen(function* () {
    const facts: ActivityFact[] = [];
    const run = (prefix?: string) =>
      called(execute(replying({ status: 200, body: 'ok' }))).pipe(
        prefix === undefined ? (self) => self : Effect.provideService(CurrentCachePrefix, prefix),
        Effect.provideService(ActivityLog, noting(facts)),
      );

    yield* run('abc123');
    yield* run();

    const notes = notesOf(facts);
    expect(notes[0]).toMatchObject({ type: 'http-started', cachePrefix: 'abc123' });
    expect(notes[2]?.cachePrefix).toBeUndefined();
  }),
);

it.live('a request outside any activity notes nothing', () =>
  Effect.gen(function* () {
    const facts: ActivityFact[] = [];

    yield* execute(replying({ status: 200, body: 'ok' })).pipe(Effect.provideService(ActivityLog, noting(facts)));

    expect(facts).toEqual([]);
  }),
);

it.live('closing the request scope aborts the request, so a silent body cannot hold the call', () =>
  Effect.gen(function* () {
    const open = yield* hanging();
    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));

    yield* Effect.gen(function* () {
      const executor = yield* HttpExecutor;
      return yield* executor.execute(call, scope);
    }).pipe(Effect.provide(open.layer));

    const signal = yield* Deferred.await(open.reached);
    expect(signal.aborted).toBe(false);

    yield* Scope.close(scope, Exit.void);

    expect(signal.aborted).toBe(true);
  }),
);

it.live('a request opened inside a stream is aborted by closing the caller’s scope', () =>
  Effect.gen(function* () {
    const open = yield* hanging();
    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));

    const events = Stream.unwrap(
      Effect.gen(function* () {
        const executor = yield* HttpExecutor;
        const response = yield* executor.execute(call, scope);
        return response.stream;
      }),
    );

    yield* Effect.forkChild(Stream.runDrain(events).pipe(Effect.provide(open.layer)));
    const signal = yield* Deferred.await(open.reached);
    expect(signal.aborted).toBe(false);

    yield* Scope.close(scope, Exit.void);
    yield* aborting(signal).pipe(Effect.timeout('1 second'));

    expect(signal.aborted).toBe(true);
  }),
);
