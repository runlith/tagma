import { expect } from 'bun:test';
import { it, layer } from '@runlith/effect-test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { Context, Effect, FileSystem, Layer, Result, Stream } from 'effect';
import { HttpEffect, HttpPlatform, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { portBlock } from '../../../installation/contract/wire/ports.js';
import { MANIFEST } from '../../../plugin-formats/tagma/contract/wire/manifest.js';
import { manifestText } from '../../../plugin-formats/tagma/testing/folder.js';
import { CHANNEL } from '../../developer/channel.js';
import { Access } from '../../../remote/contract/service/access.js';
import { PlacedSites } from '../../../remote/contract/service/sites.js';
import { ViewSites } from '../../../views/contract/service/views.js';
import { makeLocalSites, loopbackSix, sandboxRoutes } from '../../http/sites.js';
import { makeDoorWorld } from '../doorFixture.js';

const SANDBOX_PORT = portBlock(CHANNEL.port).sandbox;
const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld({ own: 'it installs a plugin for the machine' });
  const files = yield* FileSystem.FileSystem;
  const root = yield* world.directory('project');
  const project = yield* world.stealthProject(root);
  for (const id of ['board', 'other']) {
    const plugin = yield* world.directory(`plugin-${id}`);
    yield* files.makeDirectory(join(plugin, 'ui'), { recursive: true });
    yield* files.writeFileString(
      join(plugin, MANIFEST),
      manifestText({ id, contributes: { views: [{ id: 'page', entry: `ui/${id}.html` }] } }),
    );
    yield* files.writeFileString(join(plugin, 'ui', `${id}.html`), `<!doctype html><p>${id}</p>`);
    expect(yield* world.op('install_plugin', { source: plugin }, `project=${project}`)).toMatchObject({ status: 200 });
  }
  const routes = yield* HttpRouter.toHttpEffect(
    sandboxRoutes(world.runtime.views, Context.get(world.runtime.door, Access), Context.get(world.runtime.door, PlacedSites)).pipe(
      Layer.provide(HttpServer.layerServices),
      Layer.provideMerge(HttpPlatform.layer),
      Layer.provideMerge(BunFileSystem.layer),
    ),
  );
  return { world, project, routes };
});
class Sites extends Context.Service<Sites, Effect.Success<typeof setup>>()('testing/Sites') {}
const asked = Effect.fnUntraced(function* (url: string) {
  const { routes } = yield* Sites;
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

layer(Layer.merge(Layer.effect(Sites, setup), HttpPlatform.layer).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('local plugin origins', (it) => {
  it.effect('the local door names each plugin an origin of its own, and only that origin serves the plugin’s views', () =>
    Effect.gen(function* () {
      const { world, project } = yield* Sites;
      const [state] = yield* Stream.runCollect(
        Stream.take(
          Stream.filter(
            world.runtime.views.sets(project, Context.get(world.runtime.door, ViewSites)),
            (found) => found.plugins.length === 2,
          ),
          1,
        ),
      );
      expect(new Map(state?.plugins.map((set) => [set.plugin, set.site]))).toEqual(
        new Map([
          ['board', { _tag: 'served', origin: `http://board.localhost:${SANDBOX_PORT}` }],
          ['other', { _tag: 'served', origin: `http://other.localhost:${SANDBOX_PORT}` }],
        ]),
      );
      expect((yield* asked(`http://board.localhost:${SANDBOX_PORT}/ui/board.html`)).status).toBe(200);
      expect((yield* asked(`http://other.localhost:${SANDBOX_PORT}/ui/other.html`)).status).toBe(200);
      expect((yield* asked(`http://board.localhost:${SANDBOX_PORT}/ui/other.html`)).status).toBe(404);
      expect((yield* asked(`http://127.0.0.1:${SANDBOX_PORT}/ui/board.html`)).status).toBe(404);
      expect((yield* asked(`http://localhost:${SANDBOX_PORT}/ui/board.html`)).status).toBe(404);
    }),
  );
  it.effect(
    'a plugin’s page may be framed only by the doors of this server and keeps its own origin; the MCP App proxy stands nowhere else',
    () =>
      Effect.gen(function* () {
        const page = yield* asked(`http://board.localhost:${SANDBOX_PORT}/ui/board.html`);
        const policy = (page.headers['content-security-policy'] ?? '').split('; ');
        expect(policy).toContain('frame-ancestors http://127.0.0.1:* http://localhost:* http://[::1]:*');
        expect(policy.some((directive) => directive.startsWith('sandbox'))).toBe(false);
        expect((yield* asked(`http://board.localhost:${SANDBOX_PORT}/`)).status).toBe(404);
        expect((yield* asked(`http://rebound.example:${SANDBOX_PORT}/`)).status).toBe(404);
        const proxy = yield* asked(`http://127.0.0.1:${SANDBOX_PORT}/`);
        expect([proxy.status, proxy.headers['content-type']]).toEqual([200, 'text/html; charset=utf-8']);
      }),
  );
});

it.live('a program holding the IPv6 loopback of the sandbox port turns local plugin views away instead of answering as them', () =>
  Effect.gen(function* () {
    const sites = yield* makeLocalSites(SANDBOX_PORT);
    const holder = yield* Effect.acquireRelease(
      Effect.result(
        Effect.try({ try: () => Bun.serve({ hostname: '::1', port: 0, fetch: () => new Response('') }), catch: (cause) => cause }),
      ),
      (held) => (Result.isSuccess(held) ? Effect.promise(() => held.success.stop(true)) : Effect.void),
    );
    if (Result.isFailure(holder)) expect(holder.failure).toMatchObject({ code: expect.stringMatching(/^(EADDRNOTAVAIL|EAFNOSUPPORT)$/u) });
    const port = Result.isSuccess(holder) ? holder.success.port! : 1;
    const listener = Result.isFailure(holder)
      ? Layer.effectDiscard(Effect.fail(holder.failure))
      : HttpRouter.serve(HttpRouter.add('GET', '/', Effect.succeed(HttpServerResponse.empty())), { disableLogger: true }).pipe(
          Layer.provide(BunHttpServer.layer({ hostname: '::1', port })),
        );
    yield* Layer.build(loopbackSix(listener, sites, `[::1]:${port}`));
    expect(sites.site('board')._tag).toBe(Result.isSuccess(holder) ? 'unserved' : 'served');
  }),
);
