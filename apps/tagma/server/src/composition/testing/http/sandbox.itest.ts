import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, Layer } from 'effect';
import { HttpEffect, HttpPlatform, HttpRouter, HttpServer, HttpServerRequest, type HttpServerResponse } from 'effect/http';
import { portBlock } from '../../../installation/contract/wire/ports.js';
import { CHANNEL } from '../../developer/channel.js';
import { Access } from '../../../remote/contract/service/access.js';
import { sandboxRoutes } from '../../http/sandbox.js';
import { makeDoorWorld } from '../doorFixture.js';

const SANDBOX_PORT = portBlock(CHANNEL.port).sandbox;
const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld({ own: 'the sandbox listener serves only the MCP proxy' });
  const routes = yield* HttpRouter.toHttpEffect(
    sandboxRoutes(Context.get(world.runtime.door, Access)).pipe(
      Layer.provide(HttpServer.layerServices),
      Layer.provideMerge(HttpPlatform.layer),
      Layer.provideMerge(BunFileSystem.layer),
    ),
  );
  return { routes };
});
class Sandbox extends Context.Service<Sandbox, Effect.Success<typeof setup>>()('testing/Sandbox') {}
const asked = Effect.fnUntraced(function* (url: string) {
  const { routes } = yield* Sandbox;
  let answer!: HttpServerResponse.HttpServerResponse;
  yield* HttpEffect.toHandled(routes, (_request, response) =>
    Effect.sync(() => {
      answer = response;
    }),
  ).pipe(
    Effect.provideService(
      HttpServerRequest.HttpServerRequest,
      HttpServerRequest.fromWeb(new Request(url, { headers: { host: new URL(url).host } })),
    ),
  );
  return answer;
});

layer(Layer.merge(Layer.effect(Sandbox, setup), HttpPlatform.layer).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('the sandbox listener', (it) => {
  it.effect('answers the MCP App proxy on the loopback and nothing on any other host, a plugin’s own name included', () =>
    Effect.gen(function* () {
      const proxy = yield* asked(`http://127.0.0.1:${SANDBOX_PORT}/`);
      expect([proxy.status, proxy.headers['content-type']]).toEqual([200, 'text/html; charset=utf-8']);
      expect((yield* asked(`http://board.localhost:${SANDBOX_PORT}/`)).status).toBe(404);
      expect((yield* asked(`http://board.localhost:${SANDBOX_PORT}/ui/Board.svelte`)).status).toBe(404);
      expect((yield* asked(`http://rebound.example:${SANDBOX_PORT}/`)).status).toBe(404);
    }),
  );
});
