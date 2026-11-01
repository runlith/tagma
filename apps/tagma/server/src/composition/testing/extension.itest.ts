import { expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it, layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { sql } from 'drizzle-orm';
import { Context, Effect, Exit, FileSystem, Layer, Schema, Scope } from 'effect';
import { HttpPlatform, HttpRouter, HttpServer } from 'effect/http';
import { endHosts } from '../../executions/testing/doubles.js';
import { type CreationStep, PROJECT_CREATION } from '../../graph/contract/service/creation.js';
import { ServedGraphs } from '../../graph/contract/service/serving.js';
import { routedContext } from '../../graph/testing/doubles.js';
import { frozenBuildsLayer } from '../../installation/testing/doubles.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { manifest } from '../../platform/contract/service/manifest.js';
import { ownStorePath } from '../../platform/contract/service/ownStore.js';
import { ASKS_NEVER } from '../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../platform/contract/wire/operation.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Right } from '../../platform/contract/wire/right.js';
import { Access } from '../../platform/contract/service/access.js';
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

type Mark = { readonly mark: string; readonly opened: boolean };

class Marks extends Context.Service<Marks, Map<number, Mark>>()('testing/Marks') {}

class Grants extends Context.Service<Grants, { level: Right['access'] }>()('testing/Grants') {}

const grantsLayer = Layer.sync(Grants, (): Grants['Service'] => ({ level: 'none' }));

const accessLayer = Layer.effect(
  Access,
  Effect.gen(function* () {
    const grants = yield* Grants;
    return Access.of({
      right: (key) =>
        Effect.sync(() => ({
          key,
          state: grants.level === 'none' ? 'lapsed' : 'granted',
          access: grants.level,
          unblock: ['renew warmth'],
        })),
    });
  }),
);

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
  greet_warmly: operation('greet_warmly', {
    approval: ASKS_NEVER,
    doors: { http: true },
    callers: 'operator',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    right: 'warmth',
    meaning: 'Greet warmly, which only an access granting warmth admits.',
    input: Schema.Struct({ name: Schema.String }),
    answer: arms({ greeted: { text: Schema.String } }),
    refusals: [],
    confirmation: (input: { readonly name: string }) => ({ summary: `Greet ${input.name} warmly?` }),
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
    pair(
      GREETING_OPERATIONS.greet_warmly,
      body(GREETING_OPERATIONS.greet_warmly, {
        execute: (input) => Effect.succeed({ status: 'greeted' as const, text: `Warmly, ${input.name}` }),
      }),
    ),
  ],
  stores: [{ id: 'greeting', key: GreetingStore, migrations: fileURLToPath(new URL('./greetingStore', import.meta.url)) }],
  contributions: PROJECT_CREATION.of(
    {
      id: 'greeting-mark',
      value: Schema.String,
      step: Effect.fnUntraced(function* (projectId: number, mark: string) {
        if (mark === 'refused') return yield* new GateRefusal('field-invalid', 'this mark is refused', ['choose another mark']);
        const opened = (yield* ServedGraphs).held().some((copy) => copy.projectId === projectId);
        const marks = yield* Marks;
        marks.set(projectId, { mark, opened });
        yield* Effect.addFinalizer((exit) => (Exit.isFailure(exit) ? Effect.sync(() => marks.delete(projectId)) : Effect.void));
      }),
    } satisfies CreationStep<string>,
    {
      id: 'greeting-gate',
      value: Schema.Literals(['open', 'shut']),
      step: (_projectId: number, gate: 'open' | 'shut') =>
        gate === 'shut' ? Effect.fail(new GateRefusal('field-invalid', 'the gate is shut', ['open the gate'])) : Effect.void,
    } satisfies CreationStep<'open' | 'shut'>,
    {
      id: 'greeting-seal',
      value: Schema.String,
      right: 'warmth',
      step: () => Effect.void,
    } satisfies CreationStep<string>,
  ),
  lifetimes: {
    installation: Layer.mergeAll(
      Layer.succeed(Salutation, { word: 'Hello' }),
      Layer.sync(Marks, () => new Map<number, Mark>()),
      accessLayer.pipe(Layer.provideMerge(grantsLayer)),
    ),
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

const served = Effect.fnUntraced(function* (home: string, assembly: Assembly) {
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

class Root extends Context.Service<
  Root,
  {
    readonly op: (id: string, input: unknown) => Effect.Effect<{ readonly status: number; readonly body: unknown }>;
    readonly folder: (label: string) => Effect.Effect<string>;
    readonly marks: Map<number, Mark>;
    readonly grants: Grants['Service'];
  }
>()('testing/Root') {}

const root = Layer.effect(
  Root,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'extension-root-' });
    yield* Effect.addFinalizer(() => Effect.orDie(endHosts(home)));
    const { runtime, request } = yield* served(home, yield* Effect.promise(() => assemble(extended)));
    return Root.of({
      op: (id, input) => request(`/api/op/${id}`, input),
      folder: (label) => Effect.orDie(files.makeTempDirectory({ directory: home, prefix: `${label}-` })),
      marks: Context.getUnsafe(runtime.owners, Marks),
      grants: Context.getUnsafe(runtime.owners, Grants),
    });
  }),
).pipe(Layer.provide(BunFileSystem.layer));

layer(root, { excludeTestServices: true })('a root composing the core with a module of its own', (it) => {
  it.effect('serves its operation through the serving lifetime it declares, from a store of its own', () =>
    Effect.gen(function* () {
      expect(yield* (yield* Root).op('greet', { name: 'Ada' })).toMatchObject({
        body: { status: 'greeted', text: 'Hello Ada, greeted 1 time in greeting.sqlite' },
      });
      expect(ASSEMBLY.registry.named('greet')).toBeNull();
    }),
  );

  it.effect("runs its creation step on a project it registers before the graph first opens, and a step's refusal names its entry", () =>
    Effect.gen(function* () {
      const world = yield* Root;
      const add = (name: string, contributed: Readonly<Record<string, unknown>>) =>
        Effect.flatMap(world.folder(name), (rootPath) => world.op('add_project', { name, rootPath, storage: 'stealth', contributed }));
      const projects = () =>
        Effect.map(world.op('list_projects', {}), (listed) =>
          (listed.body as { projects: { name: string }[] }).projects.map((one) => one.name),
        );

      const born = yield* add('marked', { 'greeting-mark': 'oak' });
      expect(born.status).toBe(200);
      expect(world.marks.get((born.body as { project: { id: number } }).project.id)).toEqual({ mark: 'oak', opened: false });
      expect(yield* projects()).toContain('marked');

      const refused = yield* add('refused', { 'greeting-mark': 'refused' });
      expect(refused).toMatchObject({
        status: 409,
        body: { code: 'field-invalid', reason: 'this mark is refused', field: 'greeting-mark' },
      });
      const malformed = yield* add('malformed', { 'greeting-mark': 7 });
      expect(malformed).toMatchObject({ status: 409, body: { code: 'field-invalid', field: 'greeting-mark' } });
      const stranger = yield* add('stranger', { 'nobody-takes': true });
      expect(stranger).toMatchObject({ status: 409, body: { code: 'field-invalid', field: 'nobody-takes' } });
      const gated = yield* add('gated', { 'greeting-mark': 'elm', 'greeting-gate': 'shut' });
      expect(gated).toMatchObject({ status: 409, body: { code: 'field-invalid', reason: 'the gate is shut', field: 'greeting-gate' } });
      expect([...world.marks.values()].map((one) => one.mark)).toEqual(['oak']);
      expect(yield* projects()).toContain('marked');
      expect(yield* projects()).not.toContain('refused');
      expect(yield* projects()).not.toContain('gated');

      const after = yield* add('after', {});
      const id = (answer: { readonly body: unknown }) => (answer.body as { project: { id: number } }).project.id;
      expect(id(after)).toBe(id(born) + 3);
    }),
  );

  it.effect('admits an operation and a creation step naming a right only as far as its access filler answers', () =>
    Effect.gen(function* () {
      const world = yield* Root;
      const sealed = (name: string) =>
        Effect.flatMap(world.folder(name), (rootPath) =>
          world.op('add_project', { name, rootPath, storage: 'stealth', contributed: { 'greeting-seal': 'wax' } }),
        );

      world.grants.level = 'none';
      expect(yield* world.op('greet_warmly', { name: 'Ada' })).toMatchObject({
        status: 409,
        body: {
          code: 'right-missing',
          unblock: ['renew warmth'],
          right: { key: 'warmth', state: 'lapsed', access: 'none', unblock: ['renew warmth'] },
        },
      });

      world.grants.level = 'read';
      expect(yield* world.op('greet_warmly', { name: 'Ada' })).toMatchObject({ status: 200, body: { text: 'Warmly, Ada' } });
      expect(yield* sealed('read-sealed')).toMatchObject({
        status: 409,
        body: { code: 'right-missing', field: 'greeting-seal', right: { access: 'read' } },
      });

      world.grants.level = 'full';
      expect(yield* sealed('full-sealed')).toMatchObject({ status: 200 });
      const listed = (yield* world.op('list_projects', {})).body as { projects: { name: string }[] };
      expect(listed.projects.map((one) => one.name)).toEqual(expect.arrayContaining(['full-sealed']));
      expect(listed.projects.map((one) => one.name)).not.toContain('read-sealed');
    }),
  );
});

it.live('the core alone opens a data directory holding the store of a module it lacks, and serves', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'extension-core-' });
    yield* Effect.addFinalizer(() => Effect.orDie(endHosts(home)));
    const first = yield* Scope.make();
    const { request } = yield* Scope.provide(served(home, yield* Effect.promise(() => assemble(extended))), first);
    expect((yield* request('/api/op/greet', { name: 'Ada' })).status).toBe(200);
    yield* Scope.close(first, Exit.void);
    expect(existsSync(ownStorePath(join(home, 'tagma.sqlite'), 'greeting'))).toBe(true);
    const second = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(second, Exit.void));
    const { request: core } = yield* Scope.provide(served(home, ASSEMBLY), second);
    expect((yield* core('/health')).status).toBe(200);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
