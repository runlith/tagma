import { Effect, Layer } from 'effect';
import { rootCost } from '@runlith/performance/CostLedger';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/http';
import { CallRequest, type Admission, type DoorFacts } from '../../invocation/contract/service/admission.js';
import { CALL_HEADER, APPROVAL_WAIT_HEADER } from '../../invocation/contract/wire/headers.js';
import { CallerMiddleware, OperationCaller } from '../../http/contract/wire/Caller.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CurrentGraph, type GraphScopes } from '../../graph/contract/service/serving.js';

const callerLens = Effect.fn('CallRequest.lens')(function* (scopes: GraphScopes['Service']) {
  const request = yield* CallRequest;
  const served = yield* CurrentGraph;
  if (served !== null && request.scope === undefined && request.cwd === undefined) {
    return { projectId: served.projectId, scopeId: undefined };
  }
  return yield* scopes.lens({ project: request.project, cwd: request.cwd, scopeName: request.scope });
});

export const scopedLens = Effect.fn('CallRequest.scopedLens')(function* (scopes: GraphScopes['Service']) {
  const lens = yield* callerLens(scopes);
  if (lens.projectId === undefined) {
    return yield* new GateRefusal('project-required', 'name the project or run inside a registered root', ['?project=<name|id>']);
  }
  return { projectId: lens.projectId, scopeId: lens.scopeId };
});

const doorFacts = (headers: Readonly<Record<string, string | undefined>>): Effect.Effect<DoorFacts, GateRefusal> => {
  const key = headers[CALL_HEADER]?.trim();
  const wait = headers[APPROVAL_WAIT_HEADER];
  if (wait !== undefined && (!Number.isFinite(Number(wait)) || Number(wait) < 0)) {
    return Effect.fail(
      new GateRefusal('field-invalid', `${APPROVAL_WAIT_HEADER} must be a nonnegative duration in milliseconds.`, [
        'send the duration as a number',
      ]),
    );
  }
  return Effect.succeed({
    key: key === undefined || key === '' ? null : key,
    approvalWaitMs: wait === undefined ? undefined : Number(wait),
  });
};

const admitting = (admission: Admission['Service'], operation: Effect.Effect<string | null, never, HttpRouter.RouteContext>) =>
  Effect.fnUntraced(function* <E, R>(endpoint: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const query = new URL(request.url, 'http://localhost').searchParams;
    const name = yield* operation;
    const admitted = Effect.gen(function* () {
      const call = yield* admission.admit(
        request.headers,
        {
          project: query.get('project') ?? undefined,
          cwd: query.get('cwd') ?? undefined,
          branch: query.get('branch') ?? undefined,
          scope: query.get('scope') ?? undefined,
        },
        name,
      );
      return yield* admission.carry(call, yield* doorFacts(request.headers), endpoint);
    });
    return yield* name === null ? admitted : rootCost(name, admitted);
  });

export const callerMiddlewareLayer = (admission: Admission['Service']) =>
  Layer.merge(
    Layer.succeed(CallerMiddleware, CallerMiddleware.of(admitting(admission, Effect.succeed(null)))),
    Layer.succeed(
      OperationCaller,
      OperationCaller.of(
        admitting(
          admission,
          Effect.map(HttpRouter.params, (params) => params.id ?? null),
        ),
      ),
    ),
  );
