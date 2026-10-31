import { TESTING_ADAPTERS } from './adapters.js';
import type { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { kind, own, shared } from '@runlith/testbed/worlds';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { ProjectLifecycle } from '../../graph/contract/service/serving.js';
import { Settings } from '../../settings/contract/service/values.js';
import { keepAwake } from '../../power/keys.js';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { FixtureScope, type ReleaseReport } from '../../platform/testing/scope.js';
import { type Clock, Context, Effect, FileSystem, Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { doorLayer } from '../http/door.js';
import { doorServing } from './doorServices.js';
import { frozenBuildsLayer } from '../../installation/testing/doubles.js';
import { routedContext } from '../../graph/testing/doubles.js';
import { makeRuntime } from '../runtime.js';
import { COMPOSED } from './composed.js';
import { chosenModel } from './chosenModel.js';
import { liveDoorLayer } from './socketDoor.js';
import { capturedEffect, type Stdin } from './captured.js';
import type { Environment } from '../../platform/cli/verb.js';
import { testGrantSigner } from '../../platform/testing/grants.js';
import { SpawnRefused } from '../../platform/testing/spawn.js';
import { endHosts } from '../../executions/testing/doubles.js';
import { hostBundleRoot } from './hostBundle.js';
import type { HostPlacement } from '../../executions/contract/service/host.js';

export type Call = {
  readonly cwd?: string;
  readonly server?: string;
  readonly stdin?: Stdin;
  readonly env?: Record<string, string | undefined>;
  readonly clock?: Clock.Clock;
};

export type TerminalCheckout = { readonly id: number; readonly name: string; readonly root: string };

export type TerminalWorldOptions = { readonly hostSourcePath?: string };

type RuntimeHost = { readonly hostSourcePath?: string; readonly hostBundlePath?: string; readonly placedHost?: HostPlacement };

export type TerminalRuntime = Effect.Success<ReturnType<typeof makeRuntime>>;

export const terminalRuntime = (dataHome: string, host: RuntimeHost, processes: ProcessPool) =>
  makeRuntime(
    {
      ...COMPOSED,
      adapters: TESTING_ADAPTERS,
      grants: testGrantSigner,
      databasePath: join(dataHome, 'tagma.sqlite'),
      tokensPath: join(dataHome, 'tokens.json'),
      attachmentsPath: join(dataHome, 'attachments'),
      sourcePath: join(dataHome, 'tagma'),
      ...host,
      drivers: [],
    },
    Layer.empty,
    processes,
  );

export const servedRuntime = Effect.fnUntraced(function* (runtime: TerminalRuntime, dataHome: string) {
  const served = HttpRouter.serve(
    Layer.mergeAll(doorServing(doorLayer({ status: runtime.status }), runtime, dataHome), liveDoorLayer(runtime, dataHome)),
    { disableListenLog: true, disableLogger: true },
  ).pipe(
    Layer.provide(frozenBuildsLayer({ dataPath: dataHome })),
    Layer.provideMerge(BunHttpServer.layer({ port: 0, gracefulShutdownTimeout: '20 millis' })),
    Layer.provide(Layer.succeedContext(routedContext(runtime.graph, runtime.pool))),
    Layer.provide(Layer.succeedContext(runtime.bindings)),
  );
  const built = yield* Layer.build(served);
  return `http://127.0.0.1:${(Context.get(built, HttpServer.HttpServer).address as { port: number }).port}`;
});

const makeWorld = Effect.fnUntraced(
  function* (
    released: (report: ReleaseReport) => Effect.Effect<void>,
    options: TerminalWorldOptions,
    root: string,
    processes: ProcessPool,
  ) {
    const files = yield* FileSystem.FileSystem;
    const fixture = yield* FixtureScope.acquire(root);
    yield* Effect.addFinalizer(() => Effect.flatMap(fixture.close(), released));
    yield* fixture.producer(
      'execution hosts',
      Effect.gen(function* () {
        const survivors = yield* endHosts(fixture.root);
        if (survivors.length > 0) return yield* Effect.fail(new Error(`hosts still stand under ${fixture.root}: ${survivors.join(', ')}`));
      }),
    );
    const directory = (name: string) => fixture.directory(name);
    const dataHome = yield* directory('home');
    const scratch = yield* directory('tmp');
    const hostBundlePath = options.hostSourcePath === undefined ? yield* Effect.orDie(hostBundleRoot) : undefined;
    const runtime = yield* terminalRuntime(dataHome, { hostSourcePath: options.hostSourcePath, hostBundlePath }, processes);
    yield* Effect.orDie(chosenModel(runtime));
    yield* Effect.orDie(Context.get(runtime.graph, Settings).write({ scope: 'user', key: keepAwake.id, value: 'off' }));
    const url = yield* servedRuntime(runtime, dataHome);
    let sequence = 0;
    const environment = (call: Call): Environment => {
      const env: Environment = {
        ...process.env,
        TAGMA_SERVER_URL: call.server ?? url,
        TMPDIR: scratch,
        TMP: scratch,
        TEMP: scratch,
        ...call.env,
      };
      for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];
      return env;
    };
    const checkout = Effect.fn('terminalFixture.checkout')(function* () {
      const name = `p${++sequence}`;
      const root = yield* files.realPath(yield* directory(join('checkouts', name)));
      const project = yield* Context.get(runtime.graph, ProjectLifecycle).create({ name, rootPath: root });
      const checkout: TerminalCheckout = { id: project.id, name, root };
      return checkout;
    });
    return {
      url,
      runtime,
      fixture,
      directory,
      checkout: () => Effect.provide(checkout(), runtime.owners),
      warm: (projectId: number) => Effect.flatMap(runtime.pool.resolve({ projectId }), (graph) => graph.fresh()),
      tagma: (argv: readonly string[], call: Call = {}) =>
        capturedEffect(argv, environment(call), call.cwd ?? process.cwd(), call.stdin, call.clock),
      spawned: (argv: readonly string[], call: Call = {}) =>
        Effect.acquireUseRelease(
          Effect.try({
            try: () =>
              Bun.spawn(['bun', join(import.meta.dir, '../developer/cli.ts'), ...argv], {
                cwd: call.cwd ?? process.cwd(),
                env: environment(call),
                stdin: call.stdin === undefined ? 'ignore' : (new Response(call.stdin).body ?? 'ignore'),
                stdout: 'pipe',
                stderr: 'pipe',
              }),
            catch: (cause) => new SpawnRefused({ command: argv, cause }),
          }),
          (child) =>
            Effect.promise(async () => {
              const [out, err, code] = await Promise.all([
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
                child.exited,
              ]);
              return { code, out, err };
            }),
          (child) =>
            Effect.promise(async () => {
              if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
              await child.exited;
            }),
        ),
    };
  },
  (effect) => Effect.provide(effect, BunFileSystem.layer),
);

const released = (report: ReleaseReport) =>
  report.state === 'released' ? Effect.void : Effect.die(new Error(`terminal world release: ${JSON.stringify(report)}`));

export class TerminalFixture extends Context.Service<TerminalFixture, Effect.Success<ReturnType<typeof makeWorld>>>()(
  'testing/TerminalFixture',
) {}

export const terminalWorld = kind(TerminalFixture, (params: TerminalWorldOptions, home: string) =>
  Effect.flatMap(heldPool, (pool) => makeWorld(released, params, home, pool)),
);

export const makeTerminalWorld = (options: TerminalWorldOptions & { readonly own?: string } = {}) => {
  const params = { hostSourcePath: options.hostSourcePath };
  if (options.own === undefined) return shared(terminalWorld, params);
  return own(
    kind(TerminalFixture, (given: TerminalWorldOptions, home: string) =>
      Effect.flatMap(heldPool, (pool) => makeWorld(released, given, home, pool)),
    ),
    params,
    options.own,
  );
};

export const terminalFixture = Layer.effect(TerminalFixture, makeTerminalWorld());
