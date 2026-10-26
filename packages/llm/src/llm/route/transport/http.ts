import { Clock, Effect, type Scope, Stream } from 'effect';
import type { Headers, HttpClientError, HttpClientRequest } from 'effect/http';
import { encodeJson, failureOf, invalidRequest, jsonPost } from '../../protocols/shared';
import { isRecord } from '../../utils/record';
import type { LLMError } from '../../schema/errors';
import type { LLMRequest } from '../../schema/messages';
import { mergeJsonRecords } from '../../schema/options';
import { namedHeaders } from '../../utils/headers';
import * as Auth from '../auth';
import { render as renderEndpoint } from '../endpoint';
import { normalizedHeaders, type ReplyQuotaSink, secretValues, upstreamRequestId } from '../executor';
import * as Framing from '../framing';
import { type Framing as FramingDef } from '../framing';
import { lastEventOf, type WireReading } from '../wireReading';
import type { Transport, TransportPrepareInput, TransportRuntime } from './index';

export type JsonRequestInput<Body> = TransportPrepareInput<Body>;

export interface JsonRequestParts<Body = unknown> {
  readonly url: string;
  readonly jsonBody: Body | Record<string, unknown>;
  readonly bodyText: string;
  readonly headers: Headers.Headers;
}

export interface HttpPrepared<Frame> {
  readonly request: HttpClientRequest.HttpClientRequest;
  readonly framing: FramingDef<Frame>;
}

const applyQuery = (url: string, query: Record<string, string> | undefined) => {
  if (!query) return url;
  const next = new URL(url);
  Object.entries(query).forEach(([key, value]) => next.searchParams.set(key, value));
  return next.toString();
};

export const requestUrl = <Body>(input: Pick<TransportPrepareInput<Body>, 'body' | 'request' | 'endpoint'>) =>
  applyQuery(renderEndpoint(input.endpoint, { request: input.request, body: input.body }).toString(), input.request.http?.query);

const PROTOCOL_BODY_OVERLAY_DENYLIST = new Set([
  'content',
  'contents',
  'diagnostics',
  'frequencyPenalty',
  'frequency_penalty',
  'generationConfig',
  'inferenceConfig',
  'input',
  'maxTokens',
  'max_tokens',
  'messages',
  'model',
  'presencePenalty',
  'presence_penalty',
  'responseFormat',
  'response_format',
  'seed',
  'stop',
  'stopSequences',
  'stop_sequences',
  'stream',
  'streamOptions',
  'stream_options',
  'system',
  'systemInstruction',
  'system_instruction',
  'temperature',
  'thinking',
  'thread',
  'toolChoice',
  'toolConfig',
  'tool_choice',
  'tool_config',
  'tools',
  'topK',
  'topP',
  'top_k',
  'top_p',
]);

const forbiddenBodyOverlayKeys = (body: Record<string, unknown>) =>
  Object.keys(body).filter((key) => PROTOCOL_BODY_OVERLAY_DENYLIST.has(key));

const bodyWithOverlay = Effect.fnUntraced(function* <Body>(body: Body, request: LLMRequest, encodeBody: (body: Body) => string) {
  if (request.http?.body === undefined) return { jsonBody: body, bodyText: encodeBody(body) };
  const forbiddenKeys = forbiddenBodyOverlayKeys(request.http.body);
  if (forbiddenKeys.length > 0)
    return yield* invalidRequest(`http.body cannot overlay protocol-owned field(s): ${forbiddenKeys.join(', ')}`);
  if (isRecord(body)) {
    const overlaid = mergeJsonRecords(body, request.http.body) ?? {};
    return { jsonBody: overlaid, bodyText: encodeJson(overlaid) };
  }
  return yield* invalidRequest('http.body can only overlay JSON object request bodies');
});

export const jsonRequestParts = Effect.fnUntraced(function* <Body>(input: JsonRequestInput<Body>) {
  const url = requestUrl(input);
  const body = yield* bodyWithOverlay(input.body, input.request, input.encodeBody);
  const headers = yield* Auth.toEffect(input.auth)({
    request: input.request,
    method: 'POST',
    url,
    body: body.bodyText,
    headers: namedHeaders({
      ...input.headers?.({ request: input.request }),
      ...input.request.http?.headers,
    }),
  });
  return {
    url,
    jsonBody: body.jsonBody,
    bodyText: body.bodyText,
    headers: namedHeaders(headers, input.request.http?.headerOrder),
  };
});

export interface HttpJsonInput<_Body, Frame> {
  readonly framing: FramingDef<Frame>;
}

export type HttpJsonPatch<Body, Frame> = Partial<HttpJsonInput<Body, Frame>>;

export interface HttpJsonTransport<Body, Frame> extends Transport<Body, HttpPrepared<Frame>, Frame> {
  readonly with: (patch: HttpJsonPatch<Body, Frame>) => HttpJsonTransport<Body, Frame>;
}

export const frames = <Frame>(
  prepared: HttpPrepared<Frame>,
  request: LLMRequest,
  runtime: TransportRuntime,
  lifetime: Scope.Scope,
  reading: WireReading,
  quota?: ReplyQuotaSink,
): Stream.Stream<Frame, LLMError> =>
  Stream.unwrap(
    runtime.http
      .execute(prepared.request, lifetime, quota, {
        retry: request.model.route.retry?.open === undefined,
        rateLimits: request.model.route.rateLimits,
      })
      .pipe(
        Effect.map((response) => {
          const route = `${request.model.provider}/${request.model.route.id}`;
          reading.secrets = secretValues(prepared.request);
          reading.status = response.status;
          reading.upstreamRequestId = upstreamRequestId(normalizedHeaders(response.headers));
          return prepared.framing.frame(
            response.stream.pipe(
              Stream.tap((chunk) =>
                Effect.sync(() => {
                  reading.bytesRead += chunk.byteLength;
                }),
              ),
              Stream.catchTag('HttpClientError', (error: HttpClientError.HttpClientError) =>
                Stream.unwrap(
                  Effect.map(Clock.currentTimeMillis, (now) =>
                    Stream.fail(
                      failureOf(error, {
                        route,
                        message: `Failed to read the ${route} stream`,
                        family: 'torn-stream',
                        status: reading.status,
                        upstreamRequestId: reading.upstreamRequestId,
                        attempt: reading.attempt,
                        bytesRead: reading.bytesRead,
                        elapsedMs: now - reading.startedAt,
                        lastEvent: lastEventOf(reading),
                        secrets: secretValues(prepared.request),
                      }),
                    ),
                  ),
                ),
              ),
            ),
          );
        }),
      ),
  );

export const httpJson = <Body, Frame>(input: HttpJsonInput<Body, Frame>): HttpJsonTransport<Body, Frame> => ({
  id: 'http-json',
  with: (patch) => httpJson({ ...input, ...patch }),
  prepare: (prepareInput) =>
    jsonRequestParts({
      ...prepareInput,
    }).pipe(
      Effect.map((parts) => ({
        request: jsonPost({ url: parts.url, body: parts.bodyText, headers: parts.headers }),
        framing: input.framing,
      })),
    ),
  frames,
});

export const sseJson = {
  id: 'http-json/sse',
  with: <Body>() => httpJson<Body, string>({ framing: Framing.sse }),
} as const;
