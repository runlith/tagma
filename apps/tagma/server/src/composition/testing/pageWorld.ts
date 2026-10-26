import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { Api } from '../../http/contract/wire/Api.js';
import { makeDoorWorld, type DoorFixture } from './doorFixture.js';
import { liveDoorLayer } from './socketDoor.js';
import { websocketHttpTracing } from '../../socket/live.js';

export type PageDoor = Effect.Success<ReturnType<typeof clientOver>>;

const clientOver = (host: DoorFixture['Service']) =>
  HttpApiClient.make(Api, { baseUrl: 'http://tagma' }).pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request, _url, signal) =>
        HttpClientRequest.toWeb(request, { signal }).pipe(
          Effect.flatMap((input) => Effect.tryPromise(() => host.app(input, host.routed))),
          Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
          Effect.mapError(
            (cause) => new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, cause }) }),
          ),
        ),
      ),
    ),
  );

const pageOver = Effect.fnUntraced(function* (host: DoorFixture['Service'], projectId: number) {
  const files = yield* FileSystem.FileSystem;
  const door = yield* clientOver(host);
  const live = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-page-' });
  const serving = Layer.provideMerge(
    HttpRouter.serve(liveDoorLayer(host.runtime, live), {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(Layer.provide(websocketHttpTracing)),
    BunHttpServer.layer({ port: 0, gracefulShutdownTimeout: '20 millis' }),
  );
  const built = yield* Layer.build(serving);
  const port = (Context.get(built, HttpServer.HttpServer).address as { readonly port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const httpServer = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: (request) => host.app(request, host.routed),
      }),
    ),
    (listening) => Effect.promise(() => listening.stop(true)),
  );
  const http = `http://127.0.0.1:${httpServer.port}`;
  const pageWindow = (): (() => void) => {
    const held = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { origin },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });
    return () => {
      if (held === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.defineProperty(globalThis, 'window', held);
    };
  };
  return {
    door,
    projectId,
    perform: <A>(id: string, payload: unknown) =>
      Effect.map(
        door.operations.perform({ params: { id }, query: { project: String(projectId) }, headers: {}, payload }),
        (answer) => answer as A,
      ),
    origin,
    http,
    pageWindow,
  };
});

export const makePageTenant = Effect.fnUntraced(function* (world: DoorFixture['Service']) {
  const checkout = yield* world.directory('page');
  const projectId = yield* world.stealthProject(checkout);
  const page = yield* pageOver(world, projectId);
  return { world, checkout, ...page };
});

export const makePageWorld = Effect.fnUntraced(function* (own?: string) {
  const world = yield* makeDoorWorld({ own });
  return yield* makePageTenant(world);
});
