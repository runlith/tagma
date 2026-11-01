import { Effect, Exit, Option } from 'effect';
import { HttpMiddleware, HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { MCP_SESSION_HEADER, parseSessionToken, SESSION_HEADER } from '../platform/contract/wire/session.js';
import { OUTCOME_HEADER, type Outcome } from '../invocation/contract/wire/headers.js';
import type { DoorPath } from '../platform/contract/service/route.js';
import { API_PREFIX, ARTIFACT_PREFIX, HEALTH_PATH, STARTUP_PATH } from './contract/wire/served.js';
import { RETIRED_PATHS } from './retired.js';
import { Api } from './contract/wire/Api.js';

const API_PATHS: readonly DoorPath[] = Object.values(Api.groups).flatMap((group) =>
  Object.values(group.endpoints).map((endpoint) => ({ path: endpoint.path, prefix: false })),
);

export const DOOR_PATHS: readonly DoorPath[] = [
  { path: API_PREFIX, prefix: true, modules: true },
  ...API_PATHS,
  { path: ARTIFACT_PREFIX, prefix: true },
  { path: HEALTH_PATH, prefix: false },
  { path: STARTUP_PATH, prefix: false },
  ...RETIRED_PATHS,
];

const OPERATION_PATH = '/api/op/';

const outcomeOf = (status: number): Outcome => (status >= 500 ? 'defect' : status >= 400 ? 'refusal' : 'answer');

export const outcomeStamp = HttpMiddleware.make((app) =>
  Effect.flatMap(app, (response) =>
    response.headers[OUTCOME_HEADER] !== undefined
      ? Effect.succeed(response)
      : Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
          request.url.startsWith(OPERATION_PATH)
            ? HttpServerResponse.setHeader(response, OUTCOME_HEADER, outcomeOf(response.status))
            : response,
        ),
  ),
);

export const oneRefusalShape = HttpMiddleware.make((app) =>
  Effect.flatMap(app, (response) =>
    response.status !== 415
      ? Effect.succeed(response)
      : Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
          HttpServerResponse.json(
            {
              code: 'unsupported-media-type',
              reason: `this route takes no body of type "${request.headers['content-type'] ?? ''}"`,
              unblock: ['send the body in a type the route declares'],
            },
            { status: 409 },
          ).pipe(Effect.orDie),
        ),
  ),
);

const askedBy = (headers: Record<string, string | undefined>): string | null => {
  const bridge = headers[MCP_SESSION_HEADER]?.trim();
  if (bridge !== undefined && bridge !== '') {
    const ref = parseSessionToken(bridge);
    return ref === null ? null : `${ref.harness}/mcp`;
  }
  const shell = headers[SESSION_HEADER]?.trim();
  if (shell === undefined || shell === '') return null;
  const ref = parseSessionToken(shell);
  return ref === null ? null : ref.harness;
};

const pathOf = (url: string): string => {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
};

export const requestLine = HttpMiddleware.make((app) =>
  Effect.flatMap(Effect.exit(app), (exit) =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
      const asked = askedBy(request.headers);
      const named = {
        'http.method': request.method,
        'http.url': pathOf(request.url),
        ...(asked === null ? {} : { 'http.asked': asked }),
      };
      if (Exit.isSuccess(exit)) {
        return Effect.as(Effect.annotateLogs(Effect.log('Sent HTTP response'), { ...named, 'http.status': exit.value.status }), exit.value);
      }
      const [response, cause] = HttpServerError.causeResponseStripped(exit.cause);
      return Effect.andThen(
        Effect.annotateLogs(Effect.log(Option.getOrElse(cause, () => 'Sent HTTP response')), {
          ...named,
          'http.status': response.status,
        }),
        exit,
      );
    }),
  ).pipe(Effect.withLogSpan('http.span')),
);

export const unknownApiPath = HttpRouter.add('*', '/api/*', (request) =>
  HttpServerResponse.json(
    {
      code: 'not-found',
      reason: `no such API route: ${new URL(request.url, 'http://localhost').pathname}`,
      unblock: ['read the route table this door serves at /api/openapi.json — every served path is one of its endpoints'],
    },
    { status: 404 },
  ),
);
