import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { ActivityStore } from '@runlith/activity/store';
import { ACTIVITY_FIELDS } from '@runlith/activity/store/query';
import { ActivityRecord } from '@runlith/activity/store/record';
import { subscriptionDescription } from '@runlith/builtin-catalog/subscription/description';
import { onFailure } from '@runlith/e2e/artifacts';
import { kind, shared, world as workerWorld } from '@runlith/testbed/worlds';
import { Clock, Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { FetchHttpClient, HttpPlatform, HttpRouter, HttpServer } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { join } from 'node:path';
import { REGISTRY_OPERATIONS } from '../../graph/contract/wire/operations/registry.js';
import { routedContext } from '../../graph/testing/doubles.js';
import { Api } from '../../http/contract/wire/Api.js';
import { ARTIFACT_PREFIX } from '../../http/contract/wire/served.js';
import { frozenBuildsLayer } from '../../installation/testing/doubles.js';
import { knownAnswer } from '../../platform/contract/wire/operation.js';
import type { ModelAccess } from '../../providers/contract/service/access.js';
import { websocketHttpTracing } from '../../socket/live.js';
import { threadCreateSchema } from '../../threads/contract/wire/creation.js';
import { ROUTE_OPERATIONS } from '../../threads/contract/wire/operations/routes.js';
import { artifactRoutes } from '../http/artifacts.js';
import { doorLayer, socketOperationsLayer } from '../http/door.js';
import { liveServing } from '../socketBinding.js';
import { makeDoorWorld, projectLeaving } from './doorFixture.js';
import { doorServing } from './doorServices.js';
import { scriptedModel } from './scriptedModel.js';
import { surfaceBundleRoot } from './surfaceBundle.js';

export type E2eOptions = {
  readonly models?: (standing: ModelAccess['Service']) => ModelAccess['Service'];
};

const built = Effect.fnUntraced(
  function* (home: string) {
    const files = yield* FileSystem.FileSystem;
    const appDist = yield* surfaceBundleRoot;
    const listener = yield* Layer.build(BunHttpServer.layer({ hostname: '127.0.0.1', port: 0, gracefulShutdownTimeout: '20 millis' }));
    const server = Context.get(listener, HttpServer.HttpServer);
    if (server.address._tag === 'UnixPathAddress') return yield* Effect.die(new Error('the e2e world requires a loopback TCP listener'));
    const origin = `http://127.0.0.1:${server.address.port}`;
    const world = yield* makeDoorWorld({ artifactOrigin: origin, sandboxPort: server.address.port });
    yield* world.lend({ models: scriptedModel() });
    const bootstrap = Effect.fn('testing.E2eWorld.bootstrap')(function* (id: string, input: unknown) {
      const answer = yield* world.op(id, input);
      if (answer.status !== 200) return yield* Effect.die(new Error(`${id} refused the e2e world: ${JSON.stringify(answer.body)}`));
    });
    yield* bootstrap('read_provider_token', {
      provider: subscriptionDescription.id,
      credential: {
        accessToken: 'e2e-scripted-bearer',
        refreshToken: 'e2e-scripted-refresh',
        expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
        scope: 'user:inference',
        account: { uuid: 'e2e-scripted', email: 'e2e@example.invalid' },
        organization: { uuid: 'e2e-scripted', name: 'E2e' },
      },
    });
    yield* bootstrap('set_model_defaults', {
      provider: subscriptionDescription.id,
      model: subscriptionDescription.defaultTextModel,
      reasoning: null,
      account: 'e2e-scripted',
    });
    yield* files.makeDirectory(home, { recursive: true });
    const routes = doorServing(
      Layer.mergeAll(
        doorLayer({ status: { ...world.runtime.status, sandboxOrigin: null }, appDist }),
        liveServing(null).pipe(Layer.provide(socketOperationsLayer)),
        artifactRoutes(world.runtime.artifacts, { index: ARTIFACT_PREFIX, sandboxed: true }),
      ),
      world.runtime,
      home,
    ).pipe(
      Layer.provide(frozenBuildsLayer({ dataPath: world.dataHome })),
      Layer.provide(Layer.succeedContext(routedContext(world.runtime.graph, world.runtime.pool))),
      Layer.provide(Layer.succeedContext(world.runtime.bindings)),
      Layer.provide(HttpServer.layerServices),
      Layer.provide(HttpPlatform.layer),
      Layer.provide(BunFileSystem.layer),
    );
    const serving = HttpRouter.serve(routes, { disableListenLog: true, disableLogger: true }).pipe(
      Layer.provide(websocketHttpTracing),
      Layer.provide(Layer.succeedContext(listener)),
      Layer.provide(Layer.succeedContext(routedContext(world.runtime.graph, world.runtime.pool))),
    );
    yield* Layer.build(serving);
    const door = yield* HttpApiClient.make(Api, { baseUrl: origin }).pipe(Effect.provide(FetchHttpClient.layer));
    const tenant = Effect.gen(function* () {
      const checkout = yield* world.directory('e2e');
      const projectId = yield* world.stealthProject(checkout);
      yield* projectLeaving(world, projectId);
      const perform = (id: string, payload: unknown) =>
        door.operations.perform({ params: { id }, query: { project: String(projectId) }, headers: {}, payload });
      const { project } = yield* Schema.decodeUnknownEffect(knownAnswer(REGISTRY_OPERATIONS.read_project.answer))(
        yield* perform('read_project', { ref: String(projectId) }),
      );
      if (project === null) return yield* Effect.die(new Error(`the e2e tenant lost project ${projectId} after its creation`));
      const projectName = project.name;
      const thread = Effect.fn('testing.E2eWorld.thread')(function* (input: typeof threadCreateSchema.Type = {}) {
        const answer = yield* Schema.decodeUnknownEffect(knownAnswer(ROUTE_OPERATIONS.create_thread.answer))(
          yield* perform('create_thread', { approvalMode: 'bypass', ...input }),
        );
        return answer.snapshot.thread;
      });
      return { projectId, projectName, checkout, perform, thread };
    });
    const context = yield* world.runtime.runtime.contextEffect;
    const store = Context.get(context, ActivityStore);
    const record = Context.get(world.runtime.owners, ActivityRecord);
    const activity = Effect.fn('testing.E2eWorld.activity')(function* (destination: string) {
      return yield* Effect.scoped(
        Effect.gen(function* () {
          yield* files.makeDirectory(destination, { recursive: true });
          const path = join(destination, 'activity.jsonl');
          const output = yield* files.open(path, { flag: 'w' });
          const encoder = new TextEncoder();
          const write = (value: unknown) => output.writeAll(encoder.encode(`${JSON.stringify(value)}\n`));
          const settled = yield* store.settled;
          yield* write({ type: 'store', settled, health: yield* store.health });
          const through = yield* Clock.currentTimeMillis;
          let reading: string | undefined;
          let offset = 0;
          for (;;) {
            const page = yield* record.rows({
              through,
              where: [],
              paths: ACTIVITY_FIELDS,
              reading,
              resumed: reading === undefined ? undefined : true,
              offset,
              limit: 200,
            });
            yield* write({ type: 'page', ...page });
            if (!page.more) return path;
            reading = page.reading;
            offset = page.next;
          }
        }),
      );
    });
    return { origin, world, tenant, activity };
  },
  (effect) => Effect.provide(effect, BunFileSystem.layer),
);

export class E2eWorld extends Context.Service<E2eWorld, Effect.Success<ReturnType<typeof built>>>()('testing/E2eWorld') {}

const e2eWorld = kind(E2eWorld, (_params: null, home: string) => built(home));

const prepare = Effect.fnUntraced(function* (served: E2eWorld['Service'], options: E2eOptions) {
  yield* served.world.lend(options);
  yield* Effect.acquireRelease(
    Effect.sync(() => onFailure((directory) => Effect.runPromise(served.activity(directory)).then(() => undefined))),
    (stop) => Effect.sync(stop),
  );
  return served;
});

export const makeE2eWorld = (options: E2eOptions = {}) => Effect.flatMap(shared(e2eWorld, null), (served) => prepare(served, options));

export const e2eFixture = (options: E2eOptions = {}) =>
  Layer.effect(
    E2eWorld,
    Effect.flatMap(E2eWorld, (served) => prepare(served, options)),
  ).pipe(Layer.provide(workerWorld(e2eWorld, null)));
