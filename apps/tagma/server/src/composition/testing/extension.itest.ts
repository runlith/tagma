import { expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it, layer } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { chunk } from '@runlith/audio/sound/chunk';
import { captureFormat } from '@runlith/audio/sound/format';
import { ended, type Track } from '@runlith/audio/sound/track';
import { Clock, Context, Effect, Exit, FileSystem, Layer, Schema, Scope, Stream } from 'effect';
import { CHECKOUT_FACTS } from '../../executions/contract/service/worlds.js';
import { CapabilityOffers } from '../../native-harness/contract/service/execution.js';
import { Settings } from '../../settings/contract/service/values.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { Captures } from '../../speech/contract/service/captures.js';
import { listened, named } from '../../speech/listening/track.js';
import { HttpRouter, HttpServer, HttpServerResponse } from 'effect/http';
import { RpcClient, RpcGroup } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { liveSerialization, rpcOf } from '../../platform/contract/wire/live.js';
import { TAGMA_SOCKET_PATH } from '../../socket/rpc.js';
import { liveDoorLayer } from './socketDoor.js';
import { endHosts } from '../../executions/testing/doubles.js';
import { type CreationStep, PROJECT_CREATION } from '../../graph/contract/service/creation.js';
import { ServedGraphs } from '../../graph/contract/service/serving.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { liveOf, manifest } from '../../platform/contract/service/manifest.js';
import { LIVE_WORK } from '../../platform/contract/service/live.js';
import { Handoff } from '../../platform/contract/service/handoff.js';
import { AudioDevices } from '@runlith/audio/port/devices';
import { Speech } from '@runlith/speech/engine/Speech';
import { ownStorePath } from '../../platform/contract/service/ownStore.js';
import { ASKS_NEVER } from '../../platform/contract/wire/conditions.js';
import { arms, feed, operation } from '../../platform/contract/wire/operation.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Right } from '../../platform/contract/wire/right.js';
import { Access } from '../../platform/contract/service/access.js';
import type { Store } from '../../platform/contract/service/store.js';
import { settingKey } from '../../platform/contract/wire/setting.js';
import { runGit } from '../../platform/git/ownGit.js';
import { Git } from '@runlith/git/Git';
import { serverParts } from '../build.js';
import { CORE_MODULES } from '../core.js';
import { MODULES } from '../developer/modules.js';
import { PARTS } from '../developer/parts.js';
import { assemble } from '../manifest.js';
import { servedAssembly as served } from './assembled.js';
import { ASSEMBLY } from './composed.js';
import { DoorAddress } from '../../platform/contract/service/door.js';
import { route } from '../../platform/contract/service/route.js';
import { remoteServing } from '../http/remote.js';
import { Connections } from '../../socket/connections.js';
import { websocketHttpTracing } from '../../socket/live.js';
import { frozenBuildsLayer } from '../../installation/testing/doubles.js';
import { routedContext } from '../../graph/testing/doubles.js';
import { doorServicesOf } from './doorServices.js';

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
  greet_aloud: operation('greet_aloud', {
    approval: ASKS_NEVER,
    doors: { http: true },
    callers: 'any',
    tool: { capability: 'speech' } as const,
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    effect: 'write',
    identity: { key: 'request' },
    meaning: 'Hear a greeting tone through the speech track chain and keep it as a capture until it is stopped.',
    input: Schema.Struct({ name: Schema.String }),
    answer: arms({ heard: { levels: Schema.Int } }),
    refusals: [],
    confirmation: (input: { readonly name: string }) => ({ summary: `Hear ${input.name}?` }),
    confirmLabel: 'Hear',
    presentation: { running: 'Hearing', done: 'Heard' },
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

const greetingWord = settingKey({
  id: 'greeting.word',
  order: 1,
  title: 'Greeting word',
  description: 'The word a greeting opens with.',
  schema: Schema.String,
  fallback: 'Hello',
  scopes: ['user'],
  merge: 'replace',
});

const greetingTone = settingKey({
  id: 'speech.greetingTone',
  order: 1,
  title: 'Greeting tone',
  description: 'How loud a greeting tone is heard.',
  schema: Schema.Int,
  fallback: 8_000,
  scopes: ['user'],
  merge: 'replace',
});

class Pieces extends Context.Service<Pieces, { readonly home: (thread: string) => Effect.Effect<number | undefined> }>()(
  'testing/Pieces',
) {}

const piecesLayer = Layer.effect(
  Pieces,
  Effect.map(ThreadRecords, (records) => Pieces.of({ home: (thread) => Effect.orDie(records.projectOf(thread)) })),
);

class Tones extends Context.Service<Tones, { readonly hear: (name: string) => Effect.Effect<number> }>()('testing/Tones') {}

const tonesLayer = Layer.effect(
  Tones,
  Effect.gen(function* () {
    const captures = yield* Captures;
    const settings = yield* Settings;
    const clock = yield* Clock.Clock;
    yield* Effect.all([Speech, AudioDevices, Handoff]);
    return Tones.of({
      hear: Effect.fnUntraced(function* (name) {
        const loudness = yield* Effect.orDie(settings.value(greetingTone));
        const [track] = named([{ source: 'mic' }], null);
        const sound: Track = {
          format: captureFormat,
          chunks: Stream.fromIterable([chunk(captureFormat, 0n, new Int16Array(3_200).fill(loudness)), ended('drained')]),
          end: Effect.void,
        };
        let levels = 0;
        const heard = listened({ track: track!, capture: sound }, 0n, {
          spoken: () => Effect.void,
          heard: (one) => Effect.sync(() => (one.kind === 'level' ? (levels += 1) : levels)),
        });
        yield* Stream.runDrain(heard.capture.chunks);
        yield* captures.open(
          {
            kind: 'tone',
            noun: { one: 'tone', many: 'tones' },
            id: name,
            projectId: null,
            sources: ['mic'],
            at: 'server',
            startedAt: new Date(clock.currentTimeMillisUnsafe()).toISOString(),
          },
          captures.end('tone', name),
        );
        return levels;
      }),
    });
  }),
);

const GREETING_FEED = feed('greeting.said', {
  input: Schema.Struct({ name: Schema.String }),
  event: Schema.Struct({ text: Schema.String }),
  refusals: [],
  callers: 'any',
});

const greeting = manifest({
  id: 'greeting',
  title: 'Greeting',
  settings: [greetingWord, greetingTone],
  feeds: [GREETING_FEED],
  live: liveOf([GREETING_FEED], (door: Context.Context<Greeting>) => ({
    'greeting.said': ({ name }: { readonly name: string }) =>
      Stream.fromEffect(Effect.map(Context.get(door, Greeting).of(name), (text) => ({ text }))),
  })),
  settingSections: [{ id: 'greeting', order: 1, title: 'Greeting', description: 'How greetings read.' }],
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
      GREETING_OPERATIONS.greet_aloud,
      body(GREETING_OPERATIONS.greet_aloud, {
        execute: Effect.fnUntraced(function* (input) {
          return { status: 'heard' as const, levels: yield* (yield* Tones).hear(input.name) };
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
  contributions: [
    ...LIVE_WORK.of({
      id: 'greeting/tones',
      ends: { one: 'tone being heard ends', many: 'tones being heard end' },
      count: Effect.flatMap(Captures, (captures) => captures.count('tone')),
    }),
    ...PROJECT_CREATION.of(
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
  ],
  lifetimes: {
    installation: Layer.mergeAll(
      tonesLayer,
      Layer.succeed(Salutation, { word: 'Hello' }),
      Layer.sync(Marks, () => new Map<number, Mark>()),
      accessLayer.pipe(Layer.provideMerge(grantsLayer)),
    ),
    serving: Layer.mergeAll(
      piecesLayer,
      Layer.effect(
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
    ),
  },
});

const answeringAddress = (door: Context.Context<DoorAddress>) => () =>
  Effect.succeed(HttpServerResponse.text(Context.get(door, DoorAddress).origin() ?? 'no address'));

const doorway = manifest({
  id: 'doorway',
  routes: [
    route({ path: '/doorway/address', handler: answeringAddress }),
    route({ path: '/doorway/returned', preAdmitted: true, handler: answeringAddress }),
  ],
});

const extended = serverParts({ ...PARTS, modules: [...MODULES, greeting, doorway] });

class Root extends Context.Service<
  Root,
  {
    readonly origin: string;
    readonly door: (path: string, at?: 'remote') => Effect.Effect<{ readonly status: number; readonly text: string }>;
    readonly op: (id: string, input: unknown, query?: string) => Effect.Effect<{ readonly status: number; readonly body: unknown }>;
    readonly said: (name: string) => Effect.Effect<string>;
    readonly folder: (label: string) => Effect.Effect<string>;
    readonly marks: Map<number, Mark>;
    readonly grants: Grants['Service'];
    readonly offered: (capability: string) => readonly string[];
    readonly pieces: Pieces['Service'];
  }
>()('testing/Root') {}

const root = Layer.effect(
  Root,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'extension-root-' });
    yield* Effect.addFinalizer(() => Effect.orDie(endHosts(home)));
    const assembly = yield* Effect.promise(() => assemble(extended));
    const { runtime, request, origin } = yield* served(home, assembly);
    const socket = Layer.unwrap(
      Effect.map(HttpServer.HttpServer, (server) =>
        Socket.layerWebSocket(`ws://127.0.0.1:${(server.address as { port: number }).port}${TAGMA_SOCKET_PATH}`),
      ),
    );
    const protocol = yield* Layer.build(
      RpcClient.layerProtocolSocket().pipe(
        Layer.provide(socket),
        Layer.provideMerge(HttpRouter.serve(liveDoorLayer(runtime, home, assembly), { disableListenLog: true, disableLogger: true })),
        Layer.provideMerge(BunHttpServer.layer({ port: 0, gracefulShutdownTimeout: '20 millis' })),
        Layer.provide(liveSerialization),
        Layer.provide(Socket.layerWebSocketConstructorGlobal),
      ),
    );
    const live = yield* Effect.provide(RpcClient.make(RpcGroup.make(rpcOf(GREETING_FEED))), protocol);
    const remote = yield* Layer.build(
      remoteServing({
        assembly,
        door: yield* doorServicesOf(runtime, home),
        status: runtime.status,
        artifacts: runtime.artifacts,
        connections: new Connections(),
      }).pipe(
        Layer.provide(websocketHttpTracing),
        Layer.provideMerge(BunHttpServer.layer({ hostname: '127.0.0.1', port: 0, gracefulShutdownTimeout: '20 millis' })),
        Layer.provide(frozenBuildsLayer({ dataPath: home })),
        Layer.provide(Layer.succeedContext(routedContext(runtime.graph, runtime.pool))),
        Layer.provide(Layer.succeedContext(runtime.bindings)),
      ),
    );
    const remoteOrigin = HttpServer.formatAddress(Context.get(remote, HttpServer.HttpServer).address);
    return Root.of({
      origin,
      door: (path, at) =>
        Effect.promise(async () => {
          const response = await fetch(`${at === 'remote' ? remoteOrigin : origin}${path}`);
          return { status: response.status, text: await response.text() };
        }),
      op: (id, input, query) => request(`/api/op/${id}${query === undefined ? '' : `?${query}`}`, input),
      said: (name) =>
        Effect.orDie(Effect.map(Stream.runHead(live['greeting.said']({ name })), (head) => (head._tag === 'Some' ? head.value.text : ''))),
      folder: (label) => Effect.orDie(files.makeTempDirectory({ directory: home, prefix: `${label}-` })),
      marks: Context.getUnsafe(runtime.owners, Marks),
      grants: Context.getUnsafe(runtime.owners, Grants),
      pieces: Context.getUnsafe(runtime.owners, Pieces),
      offered: (capability) =>
        Context.get(runtime.owners, CapabilityOffers)
          .offers(capability, { world: CHECKOUT_FACTS, comments: 'allowed', images: true })
          .map((offer) => offer.id),
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

  it.effect(
    "reaches speech's owners and a thread's: its key, tool and capture join speech, live work is listed, and its serving lifetime reads thread homes",
    () =>
      Effect.gen(function* () {
        const world = yield* Root;
        const rootPath = yield* world.folder('tones');
        const added = yield* world.op('add_project', { name: 'tones', rootPath, storage: 'stealth' });
        const project = (added.body as { project: { id: number } }).project.id;
        expect(JSON.stringify((yield* world.op('read_settings', { project, section: 'speech' })).body)).toContain(greetingTone.id);
        expect(world.offered('speech')).toContain('greet_aloud');
        const heard = yield* world.op('greet_aloud', { name: 'tone-1' });
        expect(heard.body).toMatchObject({ status: 'heard' });
        expect((heard.body as { levels: number }).levels).toBeGreaterThan(0);
        const working = (count: number) => ({
          machine: {
            server: {
              calls: count,
              work: expect.arrayContaining([
                expect.objectContaining({ id: 'speech/listenings', count: 0 }),
                expect.objectContaining({ id: 'greeting/tones', count }),
              ]),
            },
          },
        });
        expect((yield* world.op('read_machine_state', {})).body).toMatchObject(working(1));
        expect((yield* world.op('stop_capture', { kind: 'tone', id: 'tone-1' })).body).toMatchObject({ status: 'stopped', stopped: 1 });
        expect((yield* world.op('stop_capture', { kind: 'tone', id: 'tone-1' })).body).toMatchObject({ code: 'unknown-capture' });
        expect((yield* world.op('read_machine_state', {})).body).toMatchObject(working(0));
        expect(yield* world.pieces.home('no-such-thread')).toBeUndefined();
      }),
  );

  it.effect('serves its feed over the live socket from what its serving lifetime provides', () =>
    Effect.gen(function* () {
      expect(yield* (yield* Root).said('Feed')).toBe('Hello Feed, greeted 1 time in greeting.sqlite');
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

  it.effect(
    "serves its route on the port its door listens on, reading that door's address, and the remote door serves before device admission only a route declared pre-admitted",
    () =>
      Effect.gen(function* () {
        const world = yield* Root;
        expect(new URL(world.origin).port).not.toBe('0');
        expect(yield* world.door('/doorway/address')).toEqual({ status: 200, text: world.origin });
        expect(yield* world.door('/doorway/address', 'remote')).toEqual({ status: 404, text: '' });
        expect(yield* world.door('/doorway/returned', 'remote')).toEqual({ status: 200, text: 'no address' });
      }),
  );
});

it.live('the core alone opens a data directory written by modules it lacks, and serves its own operations over it', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'extension-core-' }));
    yield* Effect.addFinalizer(() => Effect.orDie(endHosts(home)));
    const bare = join(home, 'shared.git');
    const first = yield* Scope.make();
    const { runtime, request } = yield* Scope.provide(served(home, yield* Effect.promise(() => assemble(extended))), first);
    const git = Context.get(runtime.owners, Git);
    yield* Effect.orDie(runGit(git, 'test', ['init', '-q', '--bare', bare]));
    const rootPath = join(home, 'kept');
    yield* Effect.orDie(runGit(git, 'test', ['init', '-q', '-b', 'main', rootPath]));
    expect((yield* request('/api/op/greet', { name: 'Ada' })).status).toBe(200);
    const added = yield* request('/api/op/add_project', {
      name: 'kept',
      rootPath,
      storage: 'stealth',
      contributed: { 'graph-remote': bare },
    });
    expect(added.status).toBe(200);
    const project = (added.body as { project: { id: number } }).project.id;
    expect((yield* request('/api/op/write_setting', { project, key: greetingWord.id, value: 'Hi' })).status).toBe(200);
    yield* Scope.close(first, Exit.void);
    expect(existsSync(ownStorePath(join(home, 'tagma.sqlite'), 'greeting'))).toBe(true);
    expect(existsSync(ownStorePath(join(home, 'tagma.sqlite'), 'graph-remote'))).toBe(true);

    const second = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(second, Exit.void));
    const core = yield* Effect.promise(() => assemble(serverParts({ ...PARTS, modules: CORE_MODULES })));
    const { request: alone } = yield* Scope.provide(served(home, core), second);
    expect((yield* alone('/health')).status).toBe(200);
    expect((yield* alone('/api/op/greet', { name: 'Ada' })).body).toMatchObject({ code: 'unknown-operation' });
    expect((yield* alone('/doorway/address')).status).toBe(404);
    const settings = yield* alone('/api/op/read_settings', { project });
    expect(settings.status).toBe(200);
    expect(JSON.stringify(settings.body)).not.toContain(greetingWord.id);
    const parentId = ((yield* alone('/api/op/list_root_blocks', { project })).body as { blocks: { name: string }[] }).blocks[0]!.name;
    expect((yield* alone('/api/op/create_block', { project, parentId, title: 'Kept apart' })).status).toBe(200);
    expect(((yield* alone('/api/op/search_blocks', { project, query: 'Kept apart' })).body as { total: number }).total).toBe(1);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
