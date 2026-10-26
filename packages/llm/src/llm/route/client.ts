import { Clock, Context, Duration, Effect, Exit, Layer, Schema, Scope, Stream } from 'effect';
import * as Option from 'effect/Option';
import { noted } from './notes';
import { applyCachePolicy } from '../cache-policy';
import { applyOriginPolicy } from '../origin-policy';
import { failureOf, validateWith } from '../protocols/shared';
import { GenerationOptions, ModelIdentity, mergeGenerationOptions, mergeHttpOptions, mergeProviderOptions } from '../schema/options';
import { type LLMError, InvalidRequestReason, LLMError as LLMErrorClass } from '../schema/errors';
import { type PreparedRequestOf, LLMEvent, LLMResponse, PreparedRequest } from '../schema/events';
import { LLMRequest } from '../schema/messages';
import type { AnyRoute } from './definition';
import { HttpExecutor, MAX_RETRIES, retryPause, retryPolicy } from './executor';
import type { ModelPresentationRuntime, PresentedModelCall } from './ModelPresentation';
import { openRetry, type ModelRetrySession } from './ModelRetryPolicy';
import { CurrentAttempt, CurrentCachePrefix } from './protocol';
import type { TransportRuntime } from './transport/index';
import { WebSocketTransport } from './transport/websocket';
import * as ResponseFold from '../schema/responseFold';

export class LlmClient extends Context.Service<
  LlmClient,
  {
    readonly prepare: <Body = unknown>(request: LLMRequest) => Effect.Effect<PreparedRequestOf<Body>, LLMError>;
    readonly stream: (request: LLMRequest, lifetime: Scope.Scope) => Stream.Stream<LLMEvent, LLMError>;
    readonly generate: (request: LLMRequest) => Effect.Effect<LLMResponse, LLMError>;
  }
>()('@runlith/llm/LlmClient') {}

const resolveRequestOptions = (request: LLMRequest) => {
  const routeDefaults = request.model.route.defaults;
  const modelDefaults = request.model.defaults;
  const generation = mergeGenerationOptions(routeDefaults.generation, modelDefaults?.generation, request.generation);
  return LLMRequest.update(request, {
    generation: generation ?? new GenerationOptions({}),
    cache: request.cache ?? routeDefaults.cache,
    providerOptions: mergeProviderOptions(routeDefaults.providerOptions, modelDefaults?.providerOptions, request.providerOptions),
    http: mergeHttpOptions(routeDefaults.http, modelDefaults?.http, request.http),
  });
};

const compile = Effect.fn('LLM.compile')(function* (request: LLMRequest, runtime: ModelPresentationRuntime = {}) {
  const allowed = request.model.compatibility?.toolChoice;
  const choice = request.toolChoice?.type ?? 'auto';
  if (allowed !== undefined && !allowed.includes(choice)) {
    return yield* Effect.fail(
      new LLMErrorClass({
        module: 'LLM',
        method: 'compile',
        reason: new InvalidRequestReason({
          parameter: 'toolChoice',
          message: `Model ${request.model.provider}/${request.model.id} does not support tool choice "${choice}"; allowed modes: ${allowed.join(', ')}.`,
        }),
      }),
    );
  }
  const options = resolveRequestOptions(request);
  const presentation = options.model.route.presentation;
  const restored = presentation?.resolve === undefined ? undefined : yield* presentation.resolve(options);
  const normalized = applyCachePolicy(applyOriginPolicy(restored?.request ?? options));
  const present = restored?.present ?? presentation?.present;
  const presented: PresentedModelCall<unknown> =
    present === undefined ? { request: normalized, receive: Effect.succeed } : yield* present(normalized, runtime);
  const resolved = presented.request;
  const route = resolved.model.route;

  const lowered = yield* route.body.from(resolved);
  const validated = yield* validateWith(Schema.decodeUnknownEffect(route.body.schema))(lowered);
  const body = presented.body === undefined ? validated : presented.body(validated);
  const prepared = yield* route.prepareTransport(body, resolved, presented.encode);

  return {
    request: resolved,
    route,
    body,
    prepared,
    receive: presented.receive,
    failed: presented.failed,
  };
});

const prepareWith = Effect.fn('LLMClient.prepare')(function* (request: LLMRequest) {
  const compiled = yield* compile(request);

  return new PreparedRequest({
    id: compiled.request.id ?? 'request',
    route: compiled.route.id,
    protocol: compiled.route.protocol,
    model: compiled.request.model,
    body: compiled.body,
    metadata: { transport: compiled.route.transport.id },
  });
});

const streamRequestWith = (runtime: TransportRuntime) => (request: LLMRequest, lifetime: Scope.Scope) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const compiled = yield* compile(request, { executor: runtime.http });
      let finished = false;
      const stream = compiled.route.streamPrepared(compiled.prepared, compiled.request, runtime, lifetime).pipe(
        Stream.map((event) => (event.type === 'step-start' ? { ...event, origin: ModelIdentity.of(compiled.request.model) } : event)),
        Stream.mapEffect(compiled.receive),
        Stream.flatMap((event) => Stream.fromIterable(Array.isArray(event) ? event : ([event] as const))),
        Stream.tap((event) =>
          Effect.sync(() => {
            if (event.type === 'finish') finished = true;
          }),
        ),
        Stream.concat(
          Stream.unwrap(
            Effect.sync(() =>
              finished
                ? Stream.empty
                : Stream.fail(
                    failureOf(undefined, {
                      route: `${compiled.request.model.provider}/${compiled.route.id}`,
                      family: 'clean-eof-no-finish',
                      message: 'The stream ended without its terminal finish event',
                    }),
                  ),
            ),
          ),
        ),
        Stream.tapError((failure) => compiled.failed?.(failure) ?? Effect.void),
      );
      const prefix = cachePrefixDigest(compiled.route, compiled.body);
      return prefix === undefined ? stream : Stream.provideService(stream, CurrentCachePrefix, prefix);
    }),
  );

function cachePrefixDigest(route: AnyRoute, body: unknown) {
  const of = route.body.cachePrefix;
  if (of === undefined) return undefined;
  const text = JSON.stringify(of(body as never)) ?? '';
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

const foldOnce = Effect.fn('LLM.fold')(function* (
  events: (lifetime: Scope.Scope) => Stream.Stream<LLMEvent, LLMError>,
  request: LLMRequest,
  observe?: (event: LLMEvent) => void,
) {
  const lifetime = yield* Scope.make();
  const startedAt = yield* Clock.currentTimeMillis;
  const arrived = { events: 0, lastEventType: undefined as string | undefined };
  const opened = Stream.tap(events(lifetime), (event) =>
    Effect.sync(() => {
      arrived.events += 1;
      arrived.lastEventType = event.type;
      observe?.(event);
    }),
  );
  const state = yield* opened.pipe(
    Stream.runFold(() => ResponseFold.empty(ModelIdentity.of(request.model)), ResponseFold.reduce),
    Effect.ensuring(Scope.close(lifetime, Exit.void)),
  );
  const response = ResponseFold.complete(state);
  if (response) return response;
  const endedAt = yield* Clock.currentTimeMillis;
  return yield* failureOf(undefined, {
    route: `${request.model.provider}/${request.model.route.id}`,
    message: 'The stream ended without a terminal finish event',
    family: 'clean-eof-no-finish',
    elapsedMs: endedAt - startedAt,
    lastEvent: { type: arrived.lastEventType, count: arrived.events },
  });
});

const brokeInTheBody = (error: LLMError) =>
  error.reason._tag !== 'Transport' && !('http' in error.reason && error.reason.http !== undefined);

const foldStream = (
  events: (lifetime: Scope.Scope) => Stream.Stream<LLMEvent, LLMError>,
  request: LLMRequest,
  observe?: (event: LLMEvent) => void,
  attempt = 0,
  failures: readonly LLMError[] = [],
  recovery: ModelRetrySession = openRetry(request.model.route.retry, {
    decide: (failure, context) =>
      retryPolicy(failure.family, {
        attempt: context.attempt - 1,
        remaining: MAX_RETRIES - (context.attempt - 1),
        retryAfterMs: failure.retryAfterMs,
      }).pipe(
        Effect.map((verdict) =>
          verdict.retry
            ? { again: true as const, after: verdict.after, of: MAX_RETRIES }
            : { again: false as const, stop: 'not-retryable' as const, of: MAX_RETRIES },
        ),
      ),
  }),
): Effect.Effect<LLMResponse, LLMError> =>
  Effect.catchTag(Effect.provideService(foldOnce(events, request, observe), CurrentAttempt, attempt), 'LLM.Error', (error) => {
    const policy = request.model.route.retry;
    if (policy?.open === undefined && error.status !== 401 && !brokeInTheBody(error)) return Effect.fail(error);
    const failed = [...failures, error];
    const decision = recovery.decide(error, { attempt: attempt + 1, failures: failed, outputStarted: false });
    return decision.pipe(
      Effect.flatMap((verdict) => {
        if (!verdict.again) return Effect.fail('failure' in verdict && verdict.failure !== undefined ? verdict.failure : error);
        return noted({ type: 'retry-scheduled', transportAttempt: attempt, delayMs: Duration.toMillis(verdict.after) }).pipe(
          Effect.flatMap(() => retryPause(verdict.after)),
          Effect.flatMap(() => verdict.prepare ?? Effect.void),
          Effect.flatMap(() => foldStream(events, request, observe, attempt + 1, failed, recovery)),
        );
      }),
    );
  });

const generateWith = (stream: LlmClient['Service']['stream']) => (request: LLMRequest) =>
  foldStream((lifetime) => stream(request, lifetime), request);

export const prepare = <Body = unknown>(request: LLMRequest) => prepareWith(request) as Effect.Effect<PreparedRequestOf<Body>, LLMError>;

export const stream = (request: LLMRequest, lifetime: Scope.Scope): Stream.Stream<LLMEvent, LLMError, LlmClient> =>
  Stream.unwrap(LlmClient.useSync((client) => client.stream(request, lifetime)));

export const generate = (request: LLMRequest): Effect.Effect<LLMResponse, LLMError, LlmClient> =>
  LlmClient.use((client) => client.generate(request));

export const fold = (
  request: LLMRequest,
  observe: ((event: LLMEvent) => void) | undefined,
): Effect.Effect<LLMResponse, LLMError, LlmClient> =>
  LlmClient.use((client) => foldStream((lifetime) => client.stream(request, lifetime), request, observe));

export const llmClientLayer: Layer.Layer<LlmClient, never, HttpExecutor> = Layer.effect(
  LlmClient,
  Effect.gen(function* () {
    const stream = streamRequestWith({
      http: yield* HttpExecutor,
      webSocket: Option.getOrUndefined(yield* Effect.serviceOption(WebSocketTransport)),
    });
    return LlmClient.of({ prepare: prepareWith as LlmClient['Service']['prepare'], stream, generate: generateWith(stream) });
  }),
);
