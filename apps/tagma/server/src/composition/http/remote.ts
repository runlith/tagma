import { Context, Effect, Exit, Layer, Result, Schema, Scope, Stream } from 'effect';
import {
  HttpServerError,
  HttpEffect,
  HttpMiddleware,
  HttpRouter,
  type HttpServer,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
  HttpStaticServer,
} from 'effect/http';
import { CallDevice, type Admission } from '../../invocation/contract/service/admission.js';
import { RESTARTING_CLOSE } from '../../platform/contract/wire/live.js';
import { GateRefusal, refusalBody } from '../../platform/contract/wire/refusal.js';
import { requestLine } from '../../http/door.js';
import { TAGMA_SOCKET_PATH } from '../../socket/rpc.js';
import type { Connections } from '../../socket/connections.js';
import type { ArtifactStore } from '../../artifacts/contract/service/shelf.js';
import { ListenerRefused, type Listener } from '../../remote/contract/service/exposure.js';
import { Access } from '../../remote/contract/service/access.js';
import { PlacedSites, TerminalSite } from '../../remote/contract/service/sites.js';
import { LaneEndpoint, type ViewLanes } from '../../executions/contract/service/views.js';
import { remoteEndpoint } from './endpoint.js';
import { remoteAddress } from './address.js';
import { DoorAddress } from '../../platform/contract/service/door.js';
import { type Route, type RouteHandler, routedPath } from '../../platform/contract/service/route.js';
import type { Devices } from '../../remote/contract/service/devices.js';
import {
  DEVICE_COOKIE,
  DEVICE_REVOKED_CLOSE,
  DEVICE_TERM_DAYS,
  PAIRING_ENDPOINT,
  type PairedAnswer,
  PairingInput,
} from '../../remote/contract/wire/access.js';
import { liveServing } from '../socketBinding.js';
import type { Assembly } from '../manifest.js';
import { API_PREFIX, ARTIFACT_PREFIX, HEALTH_PATH, STARTUP_PATH } from '../../http/contract/wire/served.js';
import { artifactRoutes } from './artifacts.js';
import { admissionOf, doorLayer, socketOperationsLayer } from './door.js';
import { doorCompositionLayer, type DoorServices } from './handlers.js';
import type { RuntimeStatus } from './status.js';
import { ViewSites } from '../../views/contract/service/views.js';
import { remoteSites } from './sites.js';

const PAIRING_BODY_BYTES = 1024;

const STATUS: Readonly<Record<string, number>> = {
  'body-shape': 400,
  'device-unpaired': 401,
  'device-revoked': 401,
  'pairing-refused': 401,
  'origin-refused': 403,
  'pairing-throttled': 429,
};

const UNAVAILABLE = 503;

const UNFRAMED = { policy: "frame-ancestors 'none'", option: 'DENY' } as const;

const SELF_FRAMED = { policy: "frame-ancestors 'self'", option: 'SAMEORIGIN' } as const;

const deviceCookie = { secure: true, httpOnly: true, path: '/', sameSite: 'lax', maxAge: `${DEVICE_TERM_DAYS} days` } as const;

const framed =
  (path: string | null) =>
  (response: HttpServerResponse.HttpServerResponse): HttpServerResponse.HttpServerResponse => {
    const framing = path?.startsWith(ARTIFACT_PREFIX) === true ? SELF_FRAMED : UNFRAMED;
    const policy = response.headers['content-security-policy'];
    return HttpServerResponse.setHeaders(response, {
      'content-security-policy': policy === undefined ? framing.policy : `${policy}; ${framing.policy}`,
      'x-frame-options': framing.option,
    });
  };

const reading = (method: string): boolean => method === 'GET' || method === 'HEAD';

const gated = (path: string | null): boolean =>
  path === null ||
  path === HEALTH_PATH ||
  path === STARTUP_PATH ||
  path === ARTIFACT_PREFIX.slice(0, -1) ||
  path.startsWith(ARTIFACT_PREFIX) ||
  path === API_PREFIX.slice(0, -1) ||
  path.startsWith(API_PREFIX) ||
  path.endsWith('.map');

type Shell = Effect.Effect<HttpServerResponse.HttpServerResponse, HttpServerError.HttpServerError, HttpServerRequest.HttpServerRequest>;

const shellOf = (shell: Shell | null) =>
  shell === null
    ? Effect.succeed(HttpServerResponse.empty({ status: 404 }))
    : Effect.matchEffect(shell, { onFailure: HttpServerRespondable.toResponse, onSuccess: Effect.succeed });

const bodyShape = (reason: string) =>
  new GateRefusal('body-shape', reason, [`send {"code": "<the code the pairing screen shows>"} in at most ${PAIRING_BODY_BYTES} bytes`]);

const decodePairing = Schema.decodeUnknownEffect(Schema.fromJsonString(PairingInput));

const typedCode = Effect.fnUntraced(function* (request: HttpServerRequest.HttpServerRequest): Effect.fn.Return<string, GateRefusal> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  yield* request.stream.pipe(
    Stream.mapError((failure) => bodyShape(failure.message)),
    Stream.runForEach((chunk) => {
      size += chunk.length;
      if (size > PAIRING_BODY_BYTES) return Effect.fail(bodyShape(`the body is longer than ${PAIRING_BODY_BYTES} bytes`));
      chunks.push(chunk);
      return Effect.void;
    }),
  );
  const body = yield* decodePairing(Buffer.concat(chunks).toString('utf8')).pipe(Effect.mapError((failure) => bodyShape(failure.message)));
  return body.code;
});

const pairing = Effect.fn('remote.pairing')(function* (admission: Admission['Service']) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const paired = yield* Effect.result(
    admission.pair({ origin: request.headers.origin, userAgent: request.headers['user-agent'] }, typedCode(request)),
  );
  if (Result.isFailure(paired))
    return HttpServerResponse.jsonUnsafe(refusalBody(paired.failure), { status: STATUS[paired.failure.code] ?? UNAVAILABLE });
  const answer: PairedAnswer = { device: paired.success.device, machine: paired.success.machine };
  return HttpServerResponse.jsonUnsafe(answer).pipe(
    HttpServerResponse.setCookieUnsafe(DEVICE_COOKIE, paired.success.credential, deviceCookie),
  );
});

const renewing = (credential: string) =>
  HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.succeed(
      response.status === 200 ? HttpServerResponse.setCookieUnsafe(response, DEVICE_COOKIE, credential, deviceCookie) : response,
    ),
  );

const preAdmittedOf = (routes: readonly Route[], door: Context.Context<DoorServices>) =>
  Effect.map(
    Effect.forEach(
      routes.filter((declared) => declared.preAdmitted),
      (declared) => Effect.map(declared.handler(door), (handler) => [declared.path, handler] as const),
    ),
    (entries): ReadonlyMap<string, RouteHandler> => new Map(entries),
  );

export const remoteGate = (admission: Admission['Service'], shell: Shell | null, preAdmitted: ReadonlyMap<string, RouteHandler>) =>
  HttpMiddleware.make((app) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const path = routedPath(request.url);
      const upgrade = path === TAGMA_SOCKET_PATH || request.headers.upgrade?.toLowerCase() === 'websocket';
      const frame = framed(path);
      yield* HttpEffect.appendPreResponseHandler((_request, response) => Effect.succeed(frame(response)));
      return yield* Effect.gen(function* () {
        if (request.method === PAIRING_ENDPOINT.method && path === PAIRING_ENDPOINT.path) return yield* pairing(admission);
        const admitted = request.method === 'GET' && !upgrade && path !== null ? preAdmitted.get(path) : undefined;
        if (admitted !== undefined) return yield* admitted(request);
        if (reading(request.method) && !upgrade && !gated(path)) return yield* shellOf(shell);
        const credential = request.cookies[DEVICE_COOKIE];
        return yield* admission.remote(
          {
            origin: request.headers.origin,
            fetchSite: request.headers['sec-fetch-site'],
            credential,
            mutates: upgrade || !reading(request.method),
            connection: upgrade || path === HEALTH_PATH,
          },
          (renewed) =>
            Effect.andThen(
              renewed && path === HEALTH_PATH && credential !== undefined ? renewing(credential) : Effect.void,
              Effect.flatMap(CallDevice, (device) => Effect.annotateLogs(app, { 'http.device': device ?? 'none' })),
            ),
          (refusal) => HttpServerResponse.jsonUnsafe(refusalBody(refusal), { status: STATUS[refusal.code] ?? UNAVAILABLE }),
        );
      }).pipe(Effect.map(frame));
    }),
  );

export type RemoteDoor = {
  readonly assembly: Assembly;
  readonly door: Context.Context<DoorServices>;
  readonly status: RuntimeStatus;
  readonly appDist?: string;
  readonly artifacts: ArtifactStore['Service'];
  readonly connections: Connections;
};

export const remoteServing = (remote: RemoteDoor) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const admission = admissionOf(remote.door);
      const access = Context.get(remote.door, Access);
      const status: RuntimeStatus = {
        ...remote.status,
        get sandboxOrigin() {
          return access.sandboxOrigin;
        },
      };
      const shell = remote.appDist === undefined ? null : yield* HttpStaticServer.make({ root: remote.appDist, spa: true });
      const door = Context.add(remote.door, ViewSites, remoteSites(Context.get(remote.door, PlacedSites))).pipe(
        Context.add(LaneEndpoint, remoteEndpoint(Context.get(remote.door, TerminalSite))),
        Context.add(DoorAddress, remoteAddress(access)),
      );
      const app = Layer.mergeAll(
        doorLayer({ status, routes: remote.assembly.routes.filter((declared) => !declared.preAdmitted) }),
        liveServing(remote.assembly, remote.connections).pipe(Layer.provide(socketOperationsLayer)),
        artifactRoutes(remote.artifacts, { index: ARTIFACT_PREFIX, sandboxed: true }),
      ).pipe(Layer.provide(doorCompositionLayer), Layer.provide(Layer.succeedContext(door)));
      const gate = remoteGate(admission, shell, yield* preAdmittedOf(remote.assembly.routes, door));
      return HttpRouter.serve(app, { disableLogger: true, middleware: (served) => requestLine(gate(served)) });
    }),
  );

export const remoteListener = <E>(
  serving: (port: number) => Layer.Layer<HttpServer.HttpServer, E>,
  connections: Connections,
  port: number,
  leaving: Effect.Effect<boolean> = Effect.succeed(false),
): Listener => {
  let held: Scope.Closeable | null = null;
  const refusedOpen = (reason: unknown) =>
    new ListenerRefused({ reason: `port ${port} could not be opened: ${reason instanceof Error ? reason.message : String(reason)}` });
  return {
    port,
    open: Effect.gen(function* () {
      const scope = yield* Scope.make();
      yield* Layer.buildWithScope(serving(port), scope).pipe(
        Effect.catchDefect((defect) => Effect.fail(defect)),
        Effect.mapError(refusedOpen),
        Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
      );
      held = scope;
    }),
    close: Effect.gen(function* () {
      const scope = held;
      held = null;
      yield* Effect.flatMap(leaving, (restarting) =>
        restarting
          ? connections.closeAll(RESTARTING_CLOSE, 'the server is restarting')
          : connections.closeAll(1001, 'the door for paired devices closed'),
      );
      if (scope !== null) yield* Scope.close(scope, Exit.void);
    }),
  };
};

export const remoteDriving = (
  devices: Devices['Service'],
  access: Access['Service'],
  lanes: ViewLanes['Service'],
  listener: Listener,
  connections: Connections,
) =>
  Effect.andThen(
    Effect.forkScoped(
      Stream.runForEach(devices.revoked, ({ deviceId }) =>
        Effect.andThen(connections.revoke(deviceId, DEVICE_REVOKED_CLOSE, 'device-revoked'), lanes.revoked(deviceId)),
      ),
    ),
    access.serve(listener),
  );
