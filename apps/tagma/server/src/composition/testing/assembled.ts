import { join } from 'node:path';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Context, Effect, Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { routedContext } from '../../graph/testing/doubles.js';
import { frozenBuildsLayer } from '../../installation/testing/doubles.js';
import { testGrantSigner } from '../../platform/testing/grants.js';
import { DEVELOPER } from '../developer/build.js';
import { doorLayer } from '../http/door.js';
import type { Assembly } from '../manifest.js';
import { makeRuntime } from '../runtime.js';
import { TESTING_ADAPTERS } from './adapters.js';
import { doorServing } from './doorServices.js';
import { hostBundleRoot } from './hostBundle.js';
import type { HttpAnswer } from './httpRequest.js';

export const servedAssembly = Effect.fnUntraced(function* (home: string, assembly: Assembly) {
  const listening = yield* Layer.build(BunHttpServer.layer({ hostname: '127.0.0.1', port: 0, gracefulShutdownTimeout: '20 millis' }));
  const origin = HttpServer.formatAddress(Context.get(listening, HttpServer.HttpServer).address);
  const runtime = yield* makeRuntime(
    {
      assembly,
      channel: DEVELOPER.channel,
      adapters: TESTING_ADAPTERS,
      grants: testGrantSigner,
      databasePath: join(home, 'tagma.sqlite'),
      tokensPath: join(home, 'tokens.json'),
      attachmentsPath: join(home, 'attachments'),
      sourcePath: join(home, 'source'),
      hostBundlePath: yield* Effect.orDie(hostBundleRoot),
      drivers: [],
      localOrigin: origin,
    },
    Layer.empty,
    yield* sharedPool,
  ).pipe(Effect.orDie);
  yield* Layer.build(
    HttpRouter.serve(doorServing(doorLayer({ status: runtime.status, routes: runtime.routes }), runtime, home), {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(
      Layer.provide(frozenBuildsLayer({ dataPath: home })),
      Layer.provide(Layer.succeedContext(routedContext(runtime.graph, runtime.pool))),
      Layer.provide(Layer.succeedContext(runtime.bindings)),
      Layer.provide(Layer.succeedContext(listening)),
    ),
  );
  const request = (path: string, sent?: unknown) =>
    Effect.promise(async (): Promise<HttpAnswer> => {
      const response = await fetch(
        `${origin}${path}`,
        sent === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sent) },
      );
      return { status: response.status, body: await response.json().catch(() => null) };
    });
  return { runtime, origin, request };
});
