import { Effect } from 'effect';
import { HttpClientRequest, type HttpClientResponse } from 'effect/http';
import { headerNames, namedHeaders } from '../../utils/headers';
import * as ProviderShared from '../../protocols/shared';
import { WIRE_EXCERPT_LIMIT } from '../../schema/errors';
import * as Auth from '../auth';
import { type Auth as AuthDef } from '../auth';
import { HttpExecutor, normalizedHeaders, type RequestOptions, secretValues, upstreamRequestId } from '../executor';

export interface Deployment {
  readonly baseURL: string;
  readonly auth?: AuthDef;
  readonly headers?: Record<string, string>;
}

export type Body = {
  readonly path: string;
  readonly json?: Record<string, unknown>;
  readonly form?: FormData;
};

export const post = Effect.fn('LLM.oneShot')(function* (deployment: Deployment, body: Body, options?: RequestOptions) {
  const url = `${ProviderShared.trimBaseUrl(deployment.baseURL)}${body.path}`;
  const text = body.json === undefined ? '' : ProviderShared.encodeJson(body.json);
  const headers = yield* Auth.toEffect(deployment.auth ?? Auth.none)({
    method: 'POST',
    url,
    body: text,
    headers: namedHeaders(deployment.headers ?? {}),
  });
  const request =
    body.form === undefined
      ? ProviderShared.jsonPost({ url, body: text, headers })
      : HttpClientRequest.post(url).pipe(
          HttpClientRequest.updateHeaders(() => headers),
          HttpClientRequest.bodyFormData(body.form),
          HttpClientRequest.updateHeaders((written) => namedHeaders(written, headerNames(headers))),
        );
  const lifetime = yield* Effect.scope;
  const response = yield* (yield* HttpExecutor).execute(request, lifetime, undefined, options);
  const answer = yield* response.text.pipe(
    Effect.mapError((cause) =>
      ProviderShared.failureOf(cause, {
        ...broken(url, request, response),
        message: 'The answer could not be read',
      }),
    ),
  );
  return yield* Effect.try({
    try: () => ProviderShared.decodeJson(answer),
    catch: (cause) =>
      ProviderShared.failureOf(cause, {
        ...broken(url, request, response),
        message: 'The answer was not JSON',
        excerpt: answer.slice(0, WIRE_EXCERPT_LIMIT),
      }),
  });
}, Effect.scoped);

const broken = (url: string, request: HttpClientRequest.HttpClientRequest, response: HttpClientResponse.HttpClientResponse) =>
  ({
    module: 'OneShotTransport',
    method: 'post',
    route: url,
    family: 'non-json-answer',
    status: response.status,
    upstreamRequestId: upstreamRequestId(normalizedHeaders(response.headers)),
    secrets: secretValues(request),
  }) as const;
