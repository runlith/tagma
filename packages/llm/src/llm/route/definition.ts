import { Cause, Clock, Effect, Schema, Scope, Stream } from 'effect';
import * as SchemaIssue from 'effect/SchemaIssue';
import { noted } from './notes';
import { Json, encodeJson, failureOf, withAttempt } from '../protocols/shared';
import { isRecord } from '../utils/record';
import {
  type CachePolicy,
  type ProviderOptions,
  GenerationOptions,
  HttpOptions,
  Model,
  ModelLimits,
  mergeGenerationOptions,
  mergeHttpOptions,
  mergeProviderOptions,
} from '../schema/options';
import type { LLMError } from '../schema/errors';
import { type StepFinish, LLMEvent } from '../schema/events';
import { type ProtocolID, ProviderID } from '../schema/ids';
import type { QuotaObservation } from '../schema/quota';
import type { LLMRequest } from '../schema/messages';
import * as Auth from './auth';
import { type Auth as AuthDef } from './auth';
import { Endpoint, type EndpointPatch } from './endpoint';
import type { RateLimitHeaders, ReplyQuotaParser } from './executor';
import type { Framing } from './framing';
import { liveness } from './liveness';
import type { ModelPresentation } from './ModelPresentation';
import type { ModelRetryPolicy } from './ModelRetryPolicy';
import { CurrentAttempt, type Protocol } from './protocol';
import type { StreamRefusalPolicy } from './refusal';
import type { Transport, TransportRuntime } from './transport/index';
import * as HttpTransport from './transport/http';
import { attemptFacts, lastEventOf, openWireReading, sawEvent, type WireReading } from './wireReading';

export interface RouteBody<Body> {
  readonly schema: Schema.Codec<Body, unknown>;
  readonly from: (request: LLMRequest) => Effect.Effect<Body, LLMError>;
  readonly cachePrefix?: (body: Body) => unknown;
}

export type FrameQuotaParser = (frame: unknown, observedAt: Date) => QuotaObservation | null;

export interface Route<Body, Prepared = unknown> {
  readonly retry?: ModelRetryPolicy;
  readonly id: string;
  readonly provider?: ProviderID;
  readonly protocol: ProtocolID;
  readonly endpoint: Endpoint<Body>;
  readonly auth: AuthDef;
  readonly transport: Transport<Body, Prepared, unknown>;
  readonly quota?: ReplyQuotaParser;
  readonly quotaFrames?: FrameQuotaParser;
  readonly rateLimits?: RateLimitHeaders;
  readonly inlineCacheHints: boolean;
  readonly refusals?: StreamRefusalPolicy;
  readonly presentation?: ModelPresentation<Body>;
  readonly defaults: RouteDefaults;
  readonly body: RouteBody<Body>;
  readonly with: (patch: RoutePatch<Body, Prepared>) => Route<Body, Prepared>;
  readonly model: (input: RouteMappedModelInput) => Model;
  readonly prepareTransport: (body: Body, request: LLMRequest, encode?: (body: Body) => string) => Effect.Effect<Prepared, LLMError>;
  readonly streamPrepared: (
    prepared: Prepared,
    request: LLMRequest,
    runtime: TransportRuntime,
    lifetime: Scope.Scope,
  ) => Stream.Stream<LLMEvent, LLMError>;
}

export type AnyRoute = Route<any, any>;

export type HttpOptionsInput = HttpOptions.Input;

export type RouteModelInput = Omit<Model.Input, 'provider' | 'route'>;

export type RouteRoutedModelInput = Omit<Model.Input, 'route'>;

export interface RouteDefaults {
  readonly headers?: Record<string, string>;
  readonly limits?: ModelLimits;
  readonly generation?: GenerationOptions;
  readonly providerOptions?: ProviderOptions;
  readonly http?: HttpOptions;
  readonly cache?: CachePolicy;
}

export interface RouteDefaultsInput {
  readonly headers?: Record<string, string>;
  readonly limits?: ModelLimits.Input;
  readonly generation?: GenerationOptions.Input;
  readonly providerOptions?: ProviderOptions;
  readonly http?: HttpOptions.Input;
  readonly cache?: CachePolicy;
}

export interface RoutePatch<Body, Prepared> extends RouteDefaultsInput {
  readonly retry?: ModelRetryPolicy;
  readonly id?: string;
  readonly provider?: string | ProviderID;
  readonly auth?: AuthDef;
  readonly transport?: Transport<Body, Prepared, unknown>;
  readonly endpoint?: EndpointPatch<Body>;
  readonly quota?: ReplyQuotaParser;
  readonly quotaFrames?: FrameQuotaParser;
  readonly refusals?: StreamRefusalPolicy;
  readonly presentation?: ModelPresentation<Body>;
}

type RouteMappedModelInput = RouteModelInput | RouteRoutedModelInput;

const makeRouteModel = (route: AnyRoute, mapped: RouteMappedModelInput) => {
  const provider = route.provider ?? ('provider' in mapped ? mapped.provider : undefined);
  if (!provider) throw new Error(`Route.model(${route.id}) requires a provider`);
  if (!endpointBaseURL(route.endpoint))
    throw new Error(`Route.model(${route.id}) requires an endpoint baseURL — configure it on the route first`);
  return Model.make({
    ...mapped,
    provider,
    route,
  });
};

const mergeRouteDefaults = (base: RouteDefaults | undefined, patch: RouteDefaultsInput): RouteDefaults => {
  const headers = mergeHeaders(base?.headers, patch.headers);
  return {
    ...base,
    ...patch,
    headers,
    limits: patch.limits === undefined ? base?.limits : ModelLimits.make(patch.limits),
    generation: mergeGenerationOptions(generationOptions(base?.generation), generationOptions(patch.generation)),
    providerOptions: mergeProviderOptions(base?.providerOptions, patch.providerOptions),
    http: mergeHttpOptions(base?.http, httpOptions(patch.http), headers === undefined ? undefined : new HttpOptions({ headers })),
  };
};

const endpointBaseURL = <Body>(endpoint: Endpoint<Body>) => (typeof endpoint.baseURL === 'string' ? endpoint.baseURL : undefined);

const mergeHeaders = (...items: ReadonlyArray<Record<string, string> | undefined>) => {
  const entries = items.flatMap((item) =>
    item === undefined ? [] : Object.entries(item).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
};

export const generationOptions = (input: GenerationOptions.Input | undefined) =>
  input === undefined ? undefined : GenerationOptions.make(input);

export const httpOptions = (input: HttpOptionsInput | undefined) => {
  if (input === undefined) return input;
  return HttpOptions.make(input);
};

export interface MakeInput<Body, Frame, Event, State> {
  readonly retry?: ModelRetryPolicy;
  readonly id: string;
  readonly provider?: string | ProviderID;
  readonly protocol: Protocol<Body, Frame, Event, State>;
  readonly endpoint: Endpoint<Body>;
  readonly auth?: AuthDef;
  readonly framing: Framing<Frame>;
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>;
  readonly quota?: ReplyQuotaParser;
  readonly quotaFrames?: FrameQuotaParser;
  readonly refusals?: StreamRefusalPolicy;
  readonly presentation?: ModelPresentation<Body>;
  readonly defaults?: RouteDefaultsInput;
}

export interface MakeTransportInput<Body, Prepared, Frame, Event, State> {
  readonly retry?: ModelRetryPolicy;
  readonly id: string;
  readonly provider?: string | ProviderID;
  readonly protocol: Protocol<Body, Frame, Event, State>;
  readonly endpoint: Endpoint<Body>;
  readonly auth?: AuthDef;
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>;
  readonly quota?: ReplyQuotaParser;
  readonly quotaFrames?: FrameQuotaParser;
  readonly refusals?: StreamRefusalPolicy;
  readonly presentation?: ModelPresentation<Body>;
  readonly transport: Transport<Body, Prepared, Frame>;
  readonly defaults?: RouteDefaultsInput;
}

const streamError = (reading: WireReading, cause: Cause.Cause<LLMError>): Stream.Stream<never, LLMError> =>
  Stream.unwrap(
    Effect.map(Clock.currentTimeMillis, (now) =>
      Stream.failCause(Cause.map(cause, (error) => withAttempt(error, attemptFacts(reading, now), reading.secrets))),
    ),
  );

const reportBroken = (error: LLMError, reading: WireReading): Stream.Stream<never, LLMError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      yield* noted({
        type: 'stream-failed',
        transportAttempt: reading.attempt,
        reason: error.reason._tag,
        family: error.family,
        retryable: error.retryable,
        message: error.reason.message,
        afterMs: now - reading.startedAt,
        status: reading.status,
        upstreamRequestId: reading.upstreamRequestId,
      });
      return Stream.fail(error);
    }),
  );

const decodeEventJson = Schema.decodeUnknownResult(Json);

type EventIssue = { readonly path: ReadonlyArray<string | number>; readonly reason: string };

const eventIssue = (issue: SchemaIssue.Issue, path: ReadonlyArray<string | number> = []): EventIssue => {
  if (issue._tag === 'Pointer') {
    const next = issue.path.flatMap((part) => (typeof part === 'string' || typeof part === 'number' ? [part] : []));
    return eventIssue(issue.issue, [...path, ...next]);
  }
  if (issue._tag === 'Filter' || issue._tag === 'Encoding') return eventIssue(issue.issue, path);
  if (issue._tag === 'Composite') return eventIssue(issue.issues[0], path);
  if (issue._tag === 'AnyOf' && issue.issues[0] !== undefined) return eventIssue(issue.issues[0], path);
  return { path, reason: issue._tag };
};

const eventDetail = (frame: unknown, error: Schema.SchemaError) => {
  let value = frame;
  if (typeof frame === 'string') {
    const decoded = decodeEventJson(frame);
    if (decoded._tag !== 'Success')
      return encodeJson({
        kind: 'malformed-json',
        eventType: null,
        keys: [],
        issue: { path: [], reason: 'InvalidJson' },
      });
    value = decoded.success;
  }
  const record = isRecord(value) ? value : undefined;
  const eventType = typeof record?.type === 'string' ? record.type : null;
  const issue = eventIssue(error.issue);
  return encodeJson({
    kind: 'schema-invalid',
    eventType,
    keys: record === undefined ? [] : Object.keys(record).sort(),
    issue,
  });
};

function makeFromTransport<Body, Prepared, Frame, Event, State>(
  input: MakeTransportInput<Body, Prepared, Frame, Event, State>,
): Route<Body, Prepared> {
  const protocol = input.protocol;
  const encodeBody = Schema.encodeSync(Schema.fromJsonString(protocol.body.schema));
  const decodeEventEffect = Schema.decodeUnknownEffect(protocol.stream.event);
  const decodeEvent = (route: string, reading: WireReading) => (frame: Frame) =>
    decodeEventEffect(frame).pipe(
      Effect.mapError((issue) =>
        failureOf(undefined, {
          route: input.id,
          message: `Invalid ${route} stream event`,
          family: 'invalid-output',
          excerpt: eventDetail(frame, issue),
          status: reading.status,
          upstreamRequestId: reading.upstreamRequestId,
          attempt: reading.attempt,
          bytesRead: reading.bytesRead,
          lastEvent: lastEventOf(reading),
        }),
      ),
    );

  type BuiltRouteInput = Omit<MakeTransportInput<Body, Prepared, Frame, Event, State>, 'defaults'> & {
    readonly defaults?: RouteDefaults;
  };

  const build = (routeInput: BuiltRouteInput): Route<Body, Prepared> => {
    const route: Route<Body, Prepared> = {
      id: routeInput.id,
      provider: routeInput.provider === undefined ? undefined : ProviderID.make(routeInput.provider),
      protocol: protocol.id,
      endpoint: routeInput.endpoint,
      auth: routeInput.auth ?? Auth.none,
      transport: routeInput.transport,
      quota: routeInput.quota,
      quotaFrames: routeInput.quotaFrames,
      rateLimits: protocol.rateLimits,
      inlineCacheHints: protocol.inlineCacheHints === true,
      refusals: routeInput.refusals,
      presentation: routeInput.presentation,
      retry: routeInput.retry,
      defaults: routeInput.defaults ?? {},
      body: protocol.body,
      with: (patch: RoutePatch<Body, Prepared>) => {
        const { id, provider, auth, transport, endpoint, quota, quotaFrames, refusals, presentation, retry, ...defaults } = patch;
        return build({
          ...routeInput,
          id: id ?? routeInput.id,
          provider: provider ?? routeInput.provider,
          auth: auth ?? routeInput.auth,
          endpoint: endpoint ? Endpoint.merge(routeInput.endpoint, endpoint) : routeInput.endpoint,
          transport: (transport as Transport<Body, Prepared, Frame> | undefined) ?? routeInput.transport,
          quota: quota ?? routeInput.quota,
          quotaFrames: quotaFrames ?? routeInput.quotaFrames,
          refusals: refusals ?? routeInput.refusals,
          presentation: presentation ?? routeInput.presentation,
          retry: retry ?? routeInput.retry,
          defaults: mergeRouteDefaults(route.defaults, defaults),
        });
      },
      model: (input) => makeRouteModel(route, input),
      prepareTransport: (body, request, presentationEncode) =>
        routeInput.transport.prepare({
          body,
          request,
          endpoint: routeInput.endpoint,
          auth: routeInput.auth ?? Auth.none,
          encodeBody: presentationEncode ?? encodeBody,
          headers: routeInput.headers,
        }),
      streamPrepared: (prepared: Prepared, request: LLMRequest, runtime: TransportRuntime, lifetime: Scope.Scope) => {
        const route = `${request.model.provider}/${request.model.route.id}`;
        return Stream.unwrap(
          Effect.map(Effect.all([Clock.currentTimeMillis, CurrentAttempt]), ([startedAt, attempt]) => {
            const reading = openWireReading(attempt, startedAt);
            let observedQuota: QuotaObservation | null = null;
            const quotaFrames = routeInput.quotaFrames;
            const quota =
              routeInput.quota === undefined && quotaFrames === undefined
                ? undefined
                : {
                    fromHeaders: routeInput.quota ?? (() => null),
                    accept: (observation: QuotaObservation | null) => {
                      observedQuota = observation;
                    },
                  };
            const framed = routeInput.transport.frames(prepared, request, runtime, lifetime, reading, quota);
            const frames =
              quotaFrames === undefined || quota === undefined
                ? framed
                : framed.pipe(
                    Stream.tap((frame) =>
                      Clock.currentTimeMillis.pipe(
                        Effect.flatMap((observedAt) =>
                          Effect.sync(() => {
                            const observation = quotaFrames(frame, new Date(observedAt));
                            if (observation !== null) quota.accept(observation);
                          }),
                        ),
                      ),
                    ),
                  );
            const trailing = quotaFrames !== undefined;
            const events = liveness(frames, request).pipe(
              Stream.mapEffect(decodeEvent(route, reading)),
              protocol.stream.terminal && !trailing ? Stream.takeUntil(protocol.stream.terminal) : (stream) => stream,
            );
            const stepped = events.pipe(
              Stream.mapAccumEffect(
                () => protocol.stream.initial(request),
                protocol.stream.step,
                protocol.stream.onHalt ? { onHalt: protocol.stream.onHalt } : undefined,
              ),
              Stream.tap((event) => Effect.sync(() => sawEvent(reading, event.type))),
            );
            const withQuota = (finish: StepFinish): LLMEvent =>
              observedQuota === null ? finish : LLMEvent.stepFinish({ ...finish, quota: observedQuota });
            const withReading = (finish: StepFinish): LLMEvent =>
              withQuota(reading.upstreamRequestId === undefined ? finish : { ...finish, requestId: reading.upstreamRequestId });
            return (
              trailing
                ? heldFinish(stepped, withReading)
                : Stream.map(stepped, (event) => (LLMEvent.is.stepFinish(event) ? withReading(event) : event))
            ).pipe(
              Stream.catchCause((cause) => streamError(reading, cause)),
              Stream.catchTag('LLM.Error', (error) => reportBroken(error, reading)),
            );
          }),
        );
      },
    } satisfies Route<Body, Prepared>;
    return route;
  };

  return build({ ...input, defaults: mergeRouteDefaults(undefined, input.defaults ?? {}) });
}

export function make<Body, Prepared, Frame, Event, State>(
  input: MakeTransportInput<Body, Prepared, Frame, Event, State>,
): Route<Body, Prepared>;
export function make<Body, Frame, Event, State>(
  input: MakeInput<Body, Frame, Event, State>,
): Route<Body, HttpTransport.HttpPrepared<Frame>>;
export function make<Body, Prepared, Frame, Event, State>(
  input: MakeInput<Body, Frame, Event, State> | MakeTransportInput<Body, Prepared, Frame, Event, State>,
): Route<Body, Prepared> | Route<Body, HttpTransport.HttpPrepared<Frame>> {
  if ('transport' in input) return makeFromTransport(input);
  const protocol = input.protocol;
  return makeFromTransport({
    id: input.id,
    provider: input.provider,
    protocol,
    endpoint: input.endpoint,
    auth: input.auth,
    headers: input.headers,
    quota: input.quota,
    quotaFrames: input.quotaFrames,
    refusals: input.refusals,
    presentation: input.presentation,
    retry: input.retry,
    transport: HttpTransport.httpJson({ framing: input.framing }),
    defaults: input.defaults,
  });
}

const heldFinish = <E, R>(
  events: Stream.Stream<LLMEvent, E, R>,
  withQuota: (finish: StepFinish) => LLMEvent,
): Stream.Stream<LLMEvent, E, R> => {
  let finished = false;
  return events.pipe(
    Stream.mapAccumEffect(
      (): StepFinish | null => null,
      (held, event) =>
        Effect.sync((): readonly [StepFinish | null, ReadonlyArray<LLMEvent>] => {
          if (!LLMEvent.is.stepFinish(event)) return [held, [event]];
          finished = true;
          return [event, []];
        }),
      { onHalt: (held) => (held === null ? [] : [withQuota(held)]) },
    ),
    Stream.catchCause((cause) => (finished ? Stream.empty : Stream.failCause(cause))),
  );
};

export const Route = { make } as const;
