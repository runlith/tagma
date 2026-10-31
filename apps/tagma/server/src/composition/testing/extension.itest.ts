import { expect } from 'bun:test';
import { basename, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Context, Effect, Exit, FileSystem, Layer, Schema, Scope } from 'effect';
import { HttpPlatform, HttpRouter, HttpServer } from 'effect/http';
import { endHosts } from '../../executions/testing/doubles.js';
import { routedContext } from '../../graph/testing/doubles.js';
import { frozenBuildsLayer } from '../../installation/testing/doubles.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { manifest } from '../../platform/contract/service/manifest.js';
import { ASKS_NEVER } from '../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../platform/contract/wire/operation.js';
import { testGrantSigner } from '../../platform/testing/grants.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { serverParts } from '../build.js';
import { DEVELOPER } from '../developer/build.js';
import { PARTS } from '../developer/parts.js';
import { doorLayer } from '../http/door.js';
import { assemble } from '../manifest.js';
import { makeRuntime } from '../runtime.js';
import { TESTING_ADAPTERS } from './adapters.js';
import { ASSEMBLY } from './composed.js';
import { doorServing } from './doorServices.js';
import { hostBundleRoot } from './hostBundle.js';
import { requestEffect } from './httpRequest.js';

const ORIGIN = 'http://tagma';

class Greeting extends Context.Service<Greeting, { readonly of: (name: string) => string }>()('testing/Greeting') {}

class Salutation extends Context.Service<Salutation, { readonly word: string }>()('testing/Salutation') {}

const GREETING_OPERATIONS = {
  greet: operation('greet', {
    approval: ASKS_NEVER,
    doors: { http: true },
    callers: 'operator',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    meaning: 'Greet through the service this module stands in the serving lifetime.',
    grammar: 'Answers the greeting the serving service shapes from the channel the server runs on.',
    input: Schema.Struct({ name: Schema.String }),
    answer: arms({ greeted: { text: Schema.String } }),
    refusals: [],
    confirmation: (input: { readonly name: string }) => ({ summary: `Greet ${input.name}?` }),
    confirmLabel: 'Greet',
    presentation: { running: 'Greeting', done: 'Greeted' },
    subjects: () => [],
  }),
};

const greeting = manifest({
  id: 'greeting',
  title: 'Greeting',
  operations: async () => ({ declarations: GREETING_OPERATIONS }),
  bodies: async () => [
    pair(
      GREETING_OPERATIONS.greet,
      body(GREETING_OPERATIONS.greet, {
        execute: Effect.fnUntraced(function* (input) {
          return { status: 'greeted' as const, text: (yield* Greeting).of(input.name) };
        }),
      }),
    ),
  ],
  lifetimes: {
    installation: Layer.succeed(Salutation, { word: 'Hello' }),
    serving: Layer.effect(
      Greeting,
      Effect.map(Effect.all([Salutation, MachineStore]), ([salutation, store]) => ({
        of: (name: string) => `${salutation.word} ${name} at ${basename(store.path)}`,
      })),
    ),
  },
});

const extended = serverParts({ ...PARTS, modules: [...PARTS.modules, greeting] });

it.live('a root composing the core with a module of its own serves its operation through the serving lifetime it declares', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'extension-root-' });
    yield* Effect.addFinalizer(() => Effect.orDie(endHosts(home)));
    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const runtime = yield* makeRuntime(
      {
        assembly: yield* Effect.promise(() => assemble(extended)),
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
    ).pipe(Scope.provide(scope), Effect.orDie);
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
    ).pipe(Scope.provide(scope));
    const answered = yield* Effect.provide(
      requestEffect(
        Effect.provideService(handler, FileSystem.FileSystem, files),
        new Request(`${ORIGIN}/api/op/greet`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Ada' }),
        }),
      ),
      routed,
    );
    expect(answered.body).toEqual({ status: 'greeted', text: 'Hello Ada at tagma.sqlite' });
    expect(ASSEMBLY.registry.named('greet')).toBeNull();
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
