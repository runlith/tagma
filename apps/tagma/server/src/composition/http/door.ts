import { Context, Effect, Layer } from 'effect';
import { rootCost } from '@runlith/performance/CostLedger';
import { HttpMiddleware, HttpRouter, HttpServerRequest, HttpServerResponse, HttpStaticServer } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import type { RuntimeStatus } from './status.js';
import { CallerCheckout } from '../../workspace/contract/service/checkouts.js';
import { readCallerCheckout } from '../../workspace/checkouts/git.js';
import { Api } from '../../http/contract/wire/Api.js';
import { CONTRACT_HEADER } from '../../invocation/contract/wire/headers.js';
import { invocationAssembly } from '../../invocation/assembly.js';
import { callLogLayer } from '../../http/callLog.js';
import { oneRefusalShape, outcomeStamp, unknownApiPath } from '../../http/door.js';
import { callerMiddlewareLayer } from './caller.js';
import { SocketOperations } from '../../invocation/contract/service/socketOperations.js';
import { doorStep } from './answering.js';
import { ANSWER_ONLY } from '../../invocation/contract/service/performer.js';
import { OperationId } from '../../platform/contract/wire/ids.js';
import { refusing } from '../../platform/contract/service/body.js';
import { ServedGraphs } from '../../graph/contract/service/serving.js';
import { schemaRefusalLayer } from '../../http/schemaRefusal.js';
import { DoorComposition, handlers, type DoorServices } from './handlers.js';
import { WorkingOrigins } from '../../workspace/contract/service/places.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { TargetSnapshots } from '../../threads/contract/service/targetSnapshots.js';
import { TargetPreparation } from '../../threads/contract/service/preparation.js';
import { ThreadLookup } from '../../threads/contract/service/reads.js';
import { Worlds } from '../../executions/contract/service/worlds.js';
import { ScratchAreas } from '../../threads/contract/service/scratch.js';
import { GrantSigner } from '../../platform/contract/service/grantSigner.js';
import { SessionResolution } from '../../external-harnesses/contract/service/sessionResolution.js';
import { retiredRoutes } from '../../http/retired.js';
import { Devices } from '../../remote/contract/service/devices.js';
import { ConnectionHeaders } from '../../invocation/contract/service/admission.js';
import { OperationCatalog } from '../../invocation/contract/service/catalog.js';
import type { Route, RouteHandler } from '../../platform/contract/service/route.js';
import { admitRight } from '../../platform/contract/service/access.js';
import { refusalBody } from '../../platform/contract/wire/refusal.js';

const callerCheckout = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const cwd = new URL(request.url, 'http://localhost').searchParams.get('cwd');
    if (cwd === null) return yield* app;
    return yield* Effect.provideService(app, CallerCheckout, yield* readCallerCheckout(cwd));
  }),
);

const contractStamp = (contract: string) =>
  HttpMiddleware.make((app) => Effect.map(app, (response) => HttpServerResponse.setHeader(response, CONTRACT_HEADER, contract)));

export type DoorOptions = {
  readonly status: RuntimeStatus;
  readonly routes: readonly Route[];
  readonly appDist?: string;
};

const routeCall = (door: Context.Context<DoorServices>, declared: Route, handler: RouteHandler) => {
  const admission = admissionOf(door);
  return Effect.fnUntraced(
    function* (request: HttpServerRequest.HttpServerRequest) {
      const params = yield* HttpRouter.params;
      const query = new URL(request.url, 'http://localhost').searchParams;
      const call = yield* admission.admit(
        request.headers,
        {
          project: query.get('project') ?? undefined,
          cwd: query.get('cwd') ?? undefined,
          branch: query.get('branch') ?? undefined,
          scope: query.get('scope') ?? undefined,
        },
        null,
      );
      yield* Effect.provide(admitRight(`The route ${declared.path}`, declared.right, 'read'), door);
      return yield* admission.carry(call, { key: null }, handler({ request, params, project: call.project?.id ?? null }));
    },
    Effect.catchTag('GateRefusal', (refusal) => Effect.succeed(HttpServerResponse.jsonUnsafe(refusalBody(refusal), { status: 409 }))),
  );
};

const moduleRoutes = (routes: readonly Route[]) =>
  Layer.unwrap(
    Effect.flatMap(Effect.context<DoorServices>(), (door) =>
      Effect.map(
        Effect.forEach(routes, (declared) =>
          Effect.map(declared.handler(door), (handler) =>
            HttpRouter.add(
              'GET',
              declared.path,
              declared.preAdmitted ? (request) => handler({ request, params: {}, project: null }) : routeCall(door, declared, handler),
            ),
          ),
        ),
        (added) => Layer.mergeAll(Layer.empty, ...added),
      ),
    ),
  );

export const admissionOf = (door: Context.Context<DoorServices>) =>
  invocationAssembly.admission({
    machine: door,
    pool: Context.get(door, ServedGraphs),
    scratch: Context.get(door, ScratchAreas),
    origins: Context.get(door, WorkingOrigins),
    resolution: Context.get(door, SessionResolution),
    grants: Context.get(door, GrantSigner),
    devices: Context.get(door, Devices),
    places: {
      units: Context.get(door, MachineUnits),
      snapshots: Context.get(door, TargetSnapshots),
      targets: Context.get(door, TargetPreparation),
      worlds: Context.get(door, Worlds),
      threads: Context.get(door, ThreadLookup),
    },
    catalog: Context.get(door, OperationCatalog),
  });

const admitting = Layer.unwrap(Effect.map(Effect.context<DoorServices>(), (door) => callerMiddlewareLayer(admissionOf(door))));

export const doorLayer = (options: DoorOptions) => {
  const api = HttpApiBuilder.layer(Api, { openapiPath: '/api/openapi.json' }).pipe(
    Layer.provide(handlers(options.status)),
    Layer.provide(admitting),
    Layer.provide(schemaRefusalLayer),
    Layer.provide(callLogLayer),
  );
  const app =
    options.appDist === undefined ? Layer.empty : HttpStaticServer.layer({ root: options.appDist, spa: true, cacheControl: 'no-cache' });
  return Layer.mergeAll(api, retiredRoutes, unknownApiPath, moduleRoutes(options.routes), app, doorMiddleware);
};

export const doorMiddleware = HttpRouter.middleware<{ provides: never; handles: never }>()(
  Effect.map(OperationCatalog, ({ registry }) => {
    const stamp = contractStamp(invocationAssembly.registryEntries(registry).contract);
    return (app) => stamp(outcomeStamp(callerCheckout(oneRefusalShape(app))));
  }),
  { global: true },
);

export const socketOperationsLayer = Layer.effect(
  SocketOperations,
  Effect.gen(function* () {
    const { performById, catalog } = yield* DoorComposition;
    const admission = admissionOf(yield* Effect.context<DoorServices>());
    return SocketOperations.of({
      admitFeed: (declaration, projectId) => refusing(admission.admitFeed(declaration, projectId)),
      perform: (id, projectId, input, declaration) => {
        const step = doorStep(`live ${declaration.id}`);
        return rootCost(
          id,
          refusing(
            Effect.gen(function* () {
              const call = yield* step(
                Effect.gen(function* () {
                  const admitted = yield* admission.admit(
                    yield* ConnectionHeaders,
                    { project: String(projectId), cwd: undefined, branch: undefined, scope: undefined },
                    id,
                  );
                  yield* admission.admitProtocol(admitted, declaration, catalog.registry.entry(id).meaning);
                  return admitted;
                }),
              );
              const performed = yield* admission.carry(call, { key: null }, performById(OperationId.make(id), input, ANSWER_ONLY));
              return performed.value;
            }),
          ),
        );
      },
    });
  }),
);
