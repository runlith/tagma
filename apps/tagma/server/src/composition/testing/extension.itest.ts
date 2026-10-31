import { expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { sql } from 'drizzle-orm';
import { Context, Effect, Exit, FileSystem, Layer, Schema, Scope } from 'effect';
import { HttpPlatform, HttpRouter, HttpServer } from 'effect/http';
import { endHosts } from '../../executions/testing/doubles.js';
import { routedContext } from '../../graph/testing/doubles.js';
import { frozenBuildsLayer } from '../../installation/testing/doubles.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { manifest } from '../../platform/contract/service/manifest.js';
import { ownStorePath } from '../../platform/contract/service/ownStore.js';
import { ASKS_NEVER } from '../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../platform/contract/wire/operation.js';
import { testGrantSigner } from '../../platform/testing/grants.js';
import type { Store } from '../../platform/contract/service/store.js';
import { serverParts } from '../build.js';
import { DEVELOPER } from '../developer/build.js';
import { MODULES } from '../developer/modules.js';
import { PARTS } from '../developer/parts.js';
import { doorLayer } from '../http/door.js';
import { type Assembly, assemble } from '../manifest.js';
import { makeRuntime } from '../runtime.js';
import { TESTING_ADAPTERS } from './adapters.js';
import { ASSEMBLY } from './composed.js';
import { doorServing } from './doorServices.js';
import { hostBundleRoot } from './hostBundle.js';
import { requestEffect } from './httpRequest.js';

const ORIGIN = 'http://tagma';

class Greeting extends Context.Service<Greeting, { readonly of: (name: string) => Effect.Effect<string> }>()('testing/Greeting') {}

class Salutation extends Context.Service<Salutation, { readonly word: string }>()('testing/Salutation') {}

class GreetingStore extends Context.Service<GreetingStore, Store<'greeting'>>()('testing/GreetingStore') {}

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
    meaning: 'Greet through the service this module stands in the serving lifetime, counting greetings in its own store.',
    grammar: 'Answers the greeting the serving service shapes and how many times the name was greeted.',
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
          return { status: 'greeted' as const, text: yield* (yield* Greeting).of(input.name) };
        }),
      }),
    ),
  ],
  stores: [{ id: 'greeting', key: GreetingStore, migrations: fileURLToPath(new URL('./greetingStore', import.meta.url)) }],
  lifetimes: {
    installation: Layer.succeed(Salutation, { word: 'Hello' }),
    serving: Layer.effect(
      Greeting,
      Effect.map(Effect.all([Salutation, GreetingStore]), ([salutation, store]) => ({
        of: (name: string) =>
          store
            .transaction('greet', () =>
              Effect.gen(function* () {
                yield* store.db.run(
                  sql`insert into greeting (name, times) values (${name}, 1) on conflict (name) do update set times = times + 1`,
                );
                const [row] = yield* store.db.all<{ times: number }>(sql`select times from greeting where name = ${name}`);
                return row?.times ?? 0;
              }),
            )
            .pipe(
              Effect.map((times) => `${salutation.word} ${name}, greeted ${times} time in ${basename(store.path)}`),
              Effect.orDie,
            ),
      })),
    ),
  },
});

const extended = serverParts({ ...PARTS, modules: [...MODULES, greeting] });

const served = Effect.fnUntraced(function* (home: string, assembly: Assembly, scope: Scope.Scope) {
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
  return (path: string, sent?: unknown) =>
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
});

it.live('a root composing the core with a module of its own serves it from its own store, and the core alone still opens that data', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'extension-root-' });
    yield* Effect.addFinalizer(() => Effect.orDie(endHosts(home)));
    const first = yield* Scope.make();
    const request = yield* served(home, yield* Effect.promise(() => assemble(extended)), first);
    yield* request('/api/op/greet', { name: 'Ada' });
    expect((yield* request('/api/op/greet', { name: 'Ada' })).body).toEqual({
      status: 'greeted',
      text: 'Hello Ada, greeted 2 time in greeting.sqlite',
    });
    yield* Scope.close(first, Exit.void);
    expect(existsSync(ownStorePath(join(home, 'tagma.sqlite'), 'greeting'))).toBe(true);
    const second = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(second, Exit.void));
    const core = yield* served(home, ASSEMBLY, second);
    expect((yield* core('/health')).status).toBe(200);
    expect(ASSEMBLY.registry.named('greet')).toBeNull();
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
