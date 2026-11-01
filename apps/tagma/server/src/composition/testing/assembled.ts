import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Effect, FileSystem, Layer } from 'effect';
import { HttpPlatform, HttpRouter, HttpServer } from 'effect/http';
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
import { requestEffect } from './httpRequest.js';

const ORIGIN = 'http://tagma';

export const servedAssembly = Effect.fnUntraced(function* (home: string, assembly: Assembly) {
  const files = yield* FileSystem.FileSystem;
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
      localOrigin: ORIGIN,
    },
    Layer.empty,
    yield* sharedPool,
  ).pipe(Effect.orDie);
  const routed = routedContext(runtime.graph, runtime.pool);
  const handler = yield* HttpRouter.toHttpEffect(
    doorServing(doorLayer({ status: runtime.status }), runtime, home).pipe(
      Layer.provide(frozenBuildsLayer({ dataPath: home })),
      Layer.provide(Layer.succeedContext(routed)),
      Layer.provide(Layer.succeedContext(runtime.bindings)),
      Layer.provide(HttpServer.layerServices),
      Layer.provideMerge(HttpPlatform.layer),
      Layer.provideMerge(BunFileSystem.layer),
    ),
  );
  const request = (path: string, sent?: unknown) =>
    Effect.provide(
      requestEffect(
        Effect.provideService(handler, FileSystem.FileSystem, files),
        new Request(
          `${ORIGIN}${path}`,
          sent === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sent) },
        ),
      ),
      routed,
    );
  return { runtime, request };
});
