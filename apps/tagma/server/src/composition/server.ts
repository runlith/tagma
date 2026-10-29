import { mkdirSync, realpathSync, rmSync } from 'node:fs';
import { totalmem } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { liveAttempt } from '../installation/closure/attempt.js';
import { fileURLToPath } from 'node:url';
import { Cause, Context, Effect, Exit, FileSystem, Layer, Result, Scope, Stream } from 'effect';
import { InstalledHarnesses } from '../threads/contract/service/harness.js';
import type * as ProcessVitals from '@runlith/performance/ProcessVitals';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { childHosting } from '@runlith/sqlite-process/children';
import { readOnly } from '@runlith/sqlite-process/SqliteProcess';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { Settings } from '../settings/contract/service/values.js';
import { HarnessRegistry } from '../threads/contract/service/harness.js';
import { FetchHttpClient, HttpRouter, HttpServer } from 'effect/http';
import { startingHandler } from '../http/starting.js';
import { grantSignerAt } from '../platform/credentials/grants.js';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import type { HostLifetime } from '@runlith/executions/protocol/boot';
import { HostManagement, type OfferSource } from '../executions/contract/service/host.js';
import { hostBootNext, hostBundleNext, hostBundleOwn, hostCandidateRestart, placeCandidate } from '../executions/host/offer.js';
import { DowngradeSteps, SuccessionSteps } from '../installation/contract/service/steps.js';
import { websocketHttpTracing } from '../socket/live.js';
import { liveServing } from './socketBinding.js';
import { bootServer, recoverRuns } from './boot.js';
import { closing, opening, phase as measuredPhase } from './phase.js';
import { PhaseEvents } from '../platform/contract/service/phases.js';
import { StoreOpening } from '../platform/contract/service/opening.js';
import { makeProcessRestart } from '../installation/process/record.js';
import { makeUserEnvironment } from '../installation/process/userEnvironment.js';
import { macUserShell } from '../mac-user-environment/shell.js';
import { RestartRecords } from '../installation/contract/service/restarts.js';
import { RESTART_ID, RESTART_RECORD } from '../installation/contract/wire/restart.js';
import { SentFrames } from '../socket/frames.js';
import { doorLayer, socketOperationsLayer } from './http/door.js';
import { doorCompositionLayer } from './http/handlers.js';
import { requestLine } from '../http/door.js';
import { routedContext } from '../graph/serving/routing.js';
import { makeRuntime, type ServerRuntime } from './runtime.js';
import { RECORDINGS } from '../speech/contract/service/recording.js';
import { PREPARATION } from './manifest.js';
import { RolloutReads } from '../threads/contract/service/rolloutReads.js';
import {
  type DataDirectoryConflict,
  type DataDirectoryLock,
  type DataDirectoryLockFailed,
  lockDataDirectory,
} from '../platform/lock/dataDirectory.js';
import { stopServer } from './stop.js';
import { frozenBuildsLayer, surfaceRoot } from '../installation/builds/frozen.js';
import { FrozenBuilds } from '../installation/contract/service/builds.js';
import { NextInstallation } from '../installation/contract/service/next.js';
import { FileRoots } from '../workspace/contract/service/roots.js';
import { CheckoutWatch } from '../workspace/contract/service/watch.js';
import { BINDINGS } from '@tagma/server/composition/bindings';
import { storeRefusal } from './storeReads.js';
import {
  type ProcessBirth,
  ServerProcess,
  Succession,
  SuccessionRefused,
  type SuccessorFailed,
} from '../installation/contract/service/succession.js';
import { HOST_REPLACE, HOST_STATE } from '../installation/contract/wire/launch.js';
import { MachineStore, storeDirectory } from '../platform/contract/service/store.js';
import { StoreSnapshots } from '../platform/contract/service/snapshots.js';
import { chain, pendingMigrations } from '../platform/store/chain.js';
import { CURRENT, SERVE_LOG, WORLD_COMMAND, serveLogPath } from '../installation/contract/wire/layout.js';
import { portsOf } from '../installation/contract/wire/ports.js';
import { CHANNEL } from '@tagma/server/composition/channel';
import { unfinishedTransfer } from '../installation/move/transfer.js';
import { holdJunction, homesIntegrated, installationsRefreshed } from './junction.js';
import { localGate } from './http/local.js';
import { makeLocalSites, loopbackSix, sandboxServing } from './http/sites.js';
import { PlacedSites } from '../remote/contract/service/sites.js';
import { Connections } from '../socket/connections.js';
import { RESTARTING_CLOSE } from '../platform/contract/wire/live.js';
import { remoteDriving, remoteListener, remoteServing } from './http/remote.js';
import { Devices } from '../remote/contract/service/devices.js';
import { ViewLanes } from '../executions/contract/service/views.js';
import { Access } from '../remote/contract/service/access.js';
import { serveLogBounding } from './serveLogBound.js';
import { recordConsole } from './serveRecord.js';
import { databasePath, databasePathIn, installationRoot, installationRootIn } from '../installation/paths.js';
import { expectsRelease, replaced, serving, standBy, type StoodBy, successionLayer } from '../installation/process/succession.js';
import { attemptOf, startFailure } from './attempt.js';
import { connectLaunch } from '../installation/process/launch.js';
import { migrationsFolder, refusalDetail } from '../installation/closure/read.js';
import { EXECUTIONS, MIGRATIONS, type Installation } from '../installation/contract/wire/manifest.js';
import { runningWorld } from '../installation/setup/launcher.js';
import { readCurrent } from '../installation/closure/current.js';
import { serverPartsStand } from '../installation/closure/present.js';
import { measureProvenance } from '../platform/git/provenance.js';
import { installedCli } from '../enforcement/commits/hooks.js';
import { artifactRoutes } from './http/artifacts.js';

recordConsole(console, process.pid);

const { server: port, artifact: artifactPort, remote: remotePort, sandbox: sandboxPort } = portsOf(CHANNEL, process.env);
const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_SIX = '::1';

const startedAt = new Date().toISOString();

const SHUTDOWN_GRACE = '1 second';

const SHUTDOWN_DEADLINE_MS = 60_000;

const MEMORY_CEILING_SHARE = 0.5;

const MEMORY_WINDOW_MS = 60_000;

const MEMORY_WINDOWS = 5;

const gigabytes = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

const READ_DEADLINE = 240;

const homeless = [databasePathIn(CHANNEL, process.env), installationRootIn(CHANNEL, process.env)].flatMap((found) =>
  Result.isFailure(found) ? [found.failure] : [],
)[0];
if (homeless !== undefined) {
  console.error(`[tagma] ${homeless.message}`);
  process.exit(1);
}
const unsettled = unfinishedTransfer(CHANNEL, process.env);
if (unsettled !== null) {
  console.error(`[tagma] ${unsettled}`);
  process.exit(1);
}
const storePath = databasePath(CHANNEL);
const installations = installationRoot(CHANNEL);
const dataPath = storeDirectory(storePath);
mkdirSync(dataPath, { recursive: true });
process.chdir(dataPath);
const launch = connectLaunch(process.env);
const hostLifetime: HostLifetime | undefined = launch === undefined ? undefined : 'with-parent';
const predecessor = replaced(process.env);
const notified = expectsRelease(process.env);
const hostState = process.env[HOST_STATE];
delete process.env[HOST_STATE];
const replacingHost = process.env[HOST_REPLACE] === '1';
delete process.env[HOST_REPLACE];
const incoming = process.env[RESTART_ID];
delete process.env[RESTART_ID];
const restartRecord = await Effect.runPromise(makeProcessRestart({ path: join(dataPath, RESTART_RECORD), pid: process.pid, incoming }));
if (predecessor !== undefined) restartRecord.receive(predecessor);
const observations = Layer.mergeAll(
  Layer.succeed(PhaseEvents, restartRecord.phase),
  Layer.succeed(RolloutReads, (read) => {
    if (process.env.TAGMA_OBSERVE_ROLLOUT === '1') console.log(JSON.stringify({ _tag: 'RolloutRead', pid: process.pid, read }));
  }),
  Layer.succeed(StoreOpening, (step) =>
    Effect.sync(() => {
      if (step.path !== storePath) return;
      restartRecord.opening(step);
      if (step.phase === 'opened') restartRecord.point('stores-opened', { migrations: step.applied, at: step.at });
    }),
  ),
);
const ended = startFailure((detail) => restartRecord.fail(detail));
const phase = <A, E, R>(name: string, work: Effect.Effect<A, E, R>) =>
  measuredPhase(name, work).pipe(Effect.provideService(PhaseEvents, restartRecord.phase), Effect.tapCause(ended));
const serverPath = fileURLToPath(new URL('../../', import.meta.url));
const read = await Effect.runPromise(
  Effect.result(phase('installation read', Effect.provide(readCurrent(serverPath, join(installations, CURRENT)), BunFileSystem.layer))),
);
if (read._tag === 'Failure') {
  console.error(`[tagma] this installation could not be read: ${refusalDetail(read.failure)}`);
  process.exit(1);
}
if (read.success.unreadable !== undefined) {
  console.error(`[tagma] ${refusalDetail(read.success.unreadable)}`);
}
const installation: Installation | undefined = read.success.runsFrom;
if (installation !== undefined) {
  const stands = await Effect.runPromise(
    Effect.result(phase('server parts present', Effect.provide(serverPartsStand(installation), BunFileSystem.layer))),
  );
  if (stands._tag === 'Failure') {
    console.error(`[tagma] this installation cannot start: ${refusalDetail(stands.failure)}`);
    process.exit(1);
  }
}
const userEnvironment = makeUserEnvironment({
  shell: process.platform === 'darwin' ? macUserShell : null,
  env: process.env,
  world: runningWorld(installation?.root, installations),
  home: process.env.HOME?.trim() || null,
  told: (line) => console.log(`[tagma] ${line}`),
});
const standing: Installation | undefined = read.success.handsOut;
const executionHostPath = installation === undefined ? resolve(serverPath, '..', '..', '..', 'packages', 'execution-host') : undefined;
const source =
  installation === undefined
    ? await Effect.runPromise(
        phase(
          'source measured',
          Effect.promise(() => measureProvenance(serverPath)),
        ),
      )
    : undefined;
const serveLog = serveLogPath(CHANNEL, process.env) ?? join(dataPath, SERVE_LOG);
restartRecord.identify({
  cut: source ?? null,
  installation:
    installation === undefined ? null : { build: installation.manifest.identity.build, digest: installation.manifest.identity.digest },
});
const hostSource: OfferSource =
  installation === undefined
    ? {
        _tag: 'Checkout',
        path: resolve(serverPath, '..', '..', '..', 'packages', 'execution-host'),
        build:
          source?.revision === null || source?.revision === undefined
            ? (source?.startedAt ?? startedAt)
            : `${source.revision.head}${source.revision.dirty ? '-dirty' : ''}`,
      }
    : { _tag: 'Closure', path: join(installation.root, EXECUTIONS) };
const attempting = installation !== undefined && liveAttempt(installations)?.to === basename(installation.root);
const placedHost =
  predecessor === undefined || hostState === undefined || attempting
    ? undefined
    : await Effect.runPromise(
        phase(
          'execution host candidate placed',
          Effect.gen(function* () {
            return yield* placeCandidate({
              files: yield* FileSystem.FileSystem,
              registrations: yield* HostRegistration,
              source: hostSource,
              own: hostBundleOwn(hostState),
              restart: incoming ?? null,
              state: hostState,
              lifetime: hostLifetime,
            });
          }).pipe(
            Effect.provide(HostRegistration.layer.pipe(Layer.provideMerge(Layer.merge(BunFileSystem.layer, BunPath.layer)))),
            Effect.catchTag('HostPreparationRefused', (refused) =>
              Effect.sync((): never => {
                console.error(`[tagma] the execution host candidate could not be placed: ${refused.detail}`);
                return process.exit(1);
              }),
            ),
          ),
        ),
      );
const withdrawn = (): void => {
  if (placedHost?._tag !== 'Placed' || hostState === undefined) return;
  rmSync(hostBundleNext(hostState), { recursive: true, force: true });
  rmSync(hostBootNext(hostState), { force: true });
  rmSync(hostCandidateRestart(hostState), { force: true });
};
if (placedHost !== undefined) process.once('exit', withdrawn);
const readerWord = process.env.TAGMA_SQLITE_READERS;
const readerCeiling = readerWord === undefined ? undefined : Number(readerWord);
if (readerCeiling !== undefined && (!Number.isSafeInteger(readerCeiling) || readerCeiling < 0)) {
  throw new Error('TAGMA_SQLITE_READERS must name a non-negative integer.');
}
const processes = new ProcessPool(readerCeiling, 'stop', undefined, childHosting);
if (predecessor !== undefined) {
  await Effect.runPromise(
    phase(
      'SQL children prepared',
      Effect.tryPromise(() => processes.prepare(2)),
    ),
  );
}
const preparationScope = await Effect.runPromise(Scope.make());
const prepared =
  predecessor === undefined
    ? Context.empty()
    : await Effect.runPromise(phase('runtime children prepared', Scope.provide(Layer.build(PREPARATION), preparationScope)));
const locking: Effect.Effect<StoodBy, DataDirectoryConflict | DataDirectoryLockFailed | SuccessorFailed> =
  predecessor === undefined
    ? Effect.map(lockDataDirectory(dataPath), (lock): StoodBy => ({ lock, unreleased: null }))
    : phase(
        `pid ${predecessor} left ${dataPath}`,
        Effect.andThen(
          Effect.sync(() => process.off('exit', withdrawn)),
          standBy(dataPath, predecessor, notified),
        ),
      );
const stood: StoodBy = await Effect.runPromise(
  locking.pipe(
    Effect.mapError((refused): never => {
      console.error(
        `[tagma] ${refused._tag === 'SuccessorFailed' ? refused.detail : refused._tag === 'DataDirectoryConflict' ? refused.message : `the data directory ${refused.path} could not be locked: ${refused.reason}`}`,
      );
      return process.exit(1);
    }),
  ),
);
const recordRead = restartRecord.load();
if (Result.isFailure(recordRead)) console.warn(`[tagma] restart record unavailable: ${recordRead.failure.detail}`);
restartRecord.start(Date.parse(startedAt));
restartRecord.point('data-taken');
if (stood.unreleased !== null) {
  console.error(`[tagma] the data directory was taken without a clean release: ${stood.unreleased}`);
  restartRecord.unreleased(stood.unreleased);
}
const attempt = await Effect.runPromise(attemptOf({ installRoot: installations, release: installation?.root, storePath }));
const dataLock: DataDirectoryLock = stood.lock;
const releaseActive = holdJunction(
  process.env,
  join(runningWorld(installation?.root, installations), WORLD_COMMAND),
  `http://${LOOPBACK_HOST}:${port}`,
);
const localScope = await Effect.runPromise(Scope.make());
const startingScope = await Effect.runPromise(Scope.fork(localScope));
const localContext = await Effect.runPromise(
  phase(
    'local door opened',
    Scope.provide(
      Layer.build(
        Layer.merge(
          BunHttpServer.layer({ hostname: LOOPBACK_HOST, port, idleTimeout: READ_DEADLINE, gracefulShutdownTimeout: SHUTDOWN_GRACE }),
          frozenBuildsLayer({ dataPath, standing }),
        ),
      ),
      localScope,
    ),
  ),
);
const gate = localGate([sandboxPort, artifactPort]);
await Effect.runPromise(
  phase(
    'startup handler installed',
    Scope.provide(
      Effect.flatMap(startingHandler(restartRecord, surfaceRoot(dataPath, standing)), (handler) =>
        HttpServer.serveEffect(handler, (handled) => requestLine(gate(handled))),
      ),
      startingScope,
    ).pipe(Effect.provide(localContext)),
  ),
);
const grants = await Effect.runPromise(
  phase('session grants opened', grantSignerAt(join(dataPath, 'session.key')).pipe(Effect.provide(BunFileSystem.layer))),
);
const born: ProcessBirth = { startedAt, replacedPid: predecessor ?? null };
const successionScope = await Effect.runPromise(Scope.make());
const succession: Succession['Service'] = Context.get(
  await Effect.runPromise(
    Scope.provide(
      Layer.build(
        successionLayer(
          installation,
          installations,
          serveLog,
          undefined,
          launch,
          restartRecord,
          (next) =>
            Effect.tryPromise({
              try: () =>
                tagma.runtime.runPromise(
                  readOnly(
                    Effect.gen(function* () {
                      const folder = next === null ? migrationsFolder : join(next.root, MIGRATIONS);
                      const store = yield* MachineStore;
                      const pending = yield* pendingMigrations(store.db, chain({ folder }), folder);
                      const heavy = yield* Context.get(tagma.bindings, StoreSnapshots).estimate(store, pending, folder);
                      return {
                        migrations: pending.length,
                        ...(heavy === null ? {} : { heavy }),
                        hostState: (yield* HostManagement).connection.address.state,
                      };
                    }),
                  ),
                ),
              catch: (cause) => new SuccessionRefused({ detail: `the successor's migration chain could not be read: ${String(cause)}` }),
            }),
          Effect.sync(() => Context.get(tagma.executions, SuccessionSteps)),
          undefined,
          userEnvironment.handoff,
        ),
      ),
      successionScope,
    ),
  ),
  Succession,
);
const memoryCeiling: ProcessVitals.MemoryCeiling = {
  bytes: totalmem() * MEMORY_CEILING_SHARE,
  windowMs: MEMORY_WINDOW_MS,
  windows: MEMORY_WINDOWS,
  crossed: ({ retainedBytes, pressure, sustained }) =>
    Effect.sync(() =>
      console.error(
        `[tagma] retained memory ${gigabytes(retainedBytes)} after a full collection stands past ${gigabytes(totalmem() * MEMORY_CEILING_SHARE)}, ${MEMORY_CEILING_SHARE} of this machine's ${gigabytes(totalmem())}, ${sustained ? `across ${MEMORY_WINDOWS} windows of ${MEMORY_WINDOW_MS / 1000}s` : 'under critical host memory pressure'} (host pressure: ${pressure}); restarting onto the installation that stands`,
      ),
    ).pipe(
      Effect.andThen(succession.restart()),
      Effect.catchTag(['SuccessionRefused', 'SuccessorFailed', 'HostUnprepared'], (refused) =>
        Effect.sync(() => {
          console.error(`[tagma] the restart past the memory ceiling was refused: ${refused.detail}; leaving`);
          process.kill(process.pid, 'SIGTERM');
        }),
      ),
      Effect.asVoid,
    ),
};
const localSites = await Effect.runPromise(phase('local sites placed', Scope.provide(makeLocalSites(sandboxPort), localScope)));
const runtimeScope = await Effect.runPromise(Scope.make());
const tagma: ServerRuntime = await Effect.runPromise(
  phase(
    'runtime composed',
    Scope.provide(
      makeRuntime(
        {
          grants,
          databasePath: storePath,
          tokensPath: join(dataPath, 'tokens.json'),
          attachmentsPath: join(dataPath, 'attachments'),
          artifactsPath: join(dataPath, 'artifacts'),
          recordingsPath: join(dataPath, RECORDINGS),
          artifactOrigin: `http://localhost:${artifactPort}`,
          sandboxPort,
          sites: localSites,
          sourcePath: serverPath,
          source,
          userEnvironment,
          placedHost,
          hostLifetime,
          watchLifetime: launch === undefined ? 'detached' : 'with-parent',
          replacingHost,
          hostEnded: (executions, detail) => Effect.sync(() => restartRecord.hostEnded(executions, detail)),
          hostSourcePath: executionHostPath,
          installation,
          memoryCeiling,
          leaving: succession.leaving,
          opened: attempt.opened,
          hostTakenAfter: attempt.trial === null ? undefined : attempt.opened,
          tagmaAppServer: `http://${LOOPBACK_HOST}:${port}`,
          localOrigin: `http://${LOOPBACK_HOST}:${port}`,
          commitGate:
            installation === undefined
              ? {
                  runtime: process.execPath,
                  entry: join(serverPath, 'src', 'composition', 'entries', 'cli.ts'),
                  server: `http://${LOOPBACK_HOST}:${port}`,
                  owner: realpathSync(dataPath),
                }
              : installedCli(installations, `http://${LOOPBACK_HOST}:${port}`, realpathSync(dataPath)),
        },
        observations,
        processes,
        prepared,
      ),
      runtimeScope,
    ).pipe(Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : Scope.close(runtimeScope, exit)))),
  ),
);

restartRecord.point('host-checked');
const closed = Effect.runSync(
  Effect.cached(
    Effect.gen(function* () {
      const runOwnersDisposed = yield* phase('thread stack closed', stopServer(tagma.closeStack));
      const exits = [
        yield* Effect.exit(phase('served graphs closed', tagma.pool.dispose())),
        yield* Effect.exit(phase('machine runtime closed', Scope.close(runtimeScope, Exit.void))),
        yield* Effect.exit(
          phase(
            'prepared children closed',
            Effect.tryPromise(() => processes.closePrepared()).pipe(Effect.ensuring(Scope.close(preparationScope, Exit.void))),
          ),
        ),
      ];
      return { runOwnersDisposed, failures: exits.flatMap((exit) => (Exit.isFailure(exit) ? [Cause.squash(exit.cause)] : [])) };
    }),
  ),
);
attempt.trial?.closing(Effect.asVoid(closed));
await tagma.runtime.runPromise(bootServer().pipe(Effect.provide(observations), Effect.tapCause(ended)));

const pool = tagma.pool;

const nextInstallation = Context.get(
  await Effect.runPromise(
    phase(
      'next installation bound',
      Scope.provide(
        Layer.build(
          BINDINGS.nextInstallation({
            serverPath,
            dataPath,
            installations,
            installation,
            source,
            restart: () =>
              Effect.runPromise(
                succession.restart().pipe(
                  Effect.as(null),
                  Effect.catchTag(['SuccessionRefused', 'SuccessorFailed', 'HostUnprepared'], (refused) => Effect.succeed(refused.detail)),
                ),
              ),
            landed: () =>
              Effect.runPromise(succession.current).then(
                (standing) => standing?.manifest.identity.build ?? null,
                () => null,
              ),
            refuses: storeRefusal(tagma.runtime),
            downgrade: Context.get(tagma.door, DowngradeSteps),
            roots: Context.get(tagma.workspace, FileRoots),
            watch: Context.get(tagma.workspace, CheckoutWatch),
          }).pipe(Layer.provide(Layer.mergeAll(Layer.succeed(Settings, Context.get(tagma.graph, Settings)), FetchHttpClient.layer))),
        ),
        localScope,
      ),
    ),
  ),
  NextInstallation,
);

const doorBound = await Effect.runPromise(
  phase(
    'door bindings bound',
    Scope.provide(
      Layer.build(
        BINDINGS.door({ serverPath, installation, port }).pipe(
          Layer.provide(Layer.mergeAll(Layer.succeedContext(tagma.door), FetchHttpClient.layer)),
        ),
      ),
      localScope,
    ),
  ),
);

const doorServices = Context.mergeAll(
  tagma.door,
  doorBound,
  Context.make(Succession, succession),
  Context.make(NextInstallation, nextInstallation),
  Context.make(ServerProcess, { born, source: tagma.status.source }),
  Context.make(RestartRecords, restartRecord),
  Context.make(SentFrames, (place, remote, at) =>
    Effect.sync(() => restartRecord.frame(remote ? 'remote' : 'local', place.projectId, place.threadId, at)),
  ),
);

const localConnections = new Connections(false);
const app = Layer.mergeAll(
  doorLayer({ status: tagma.status, appDist: surfaceRoot(dataPath, standing) }),
  liveServing(localConnections).pipe(Layer.provide(socketOperationsLayer)),
).pipe(Layer.provide(doorCompositionLayer), Layer.provide(Layer.succeedContext(doorServices)));

const connections = new Connections();
const remoteServed = (listening: number) =>
  remoteServing({
    door: doorServices,
    status: tagma.status,
    appDist: surfaceRoot(dataPath, standing),
    artifacts: tagma.artifacts,
    connections,
  }).pipe(
    Layer.provide(websocketHttpTracing),
    Layer.provideMerge(
      BunHttpServer.layer({
        hostname: LOOPBACK_HOST,
        port: listening,
        idleTimeout: READ_DEADLINE,
        gracefulShutdownTimeout: SHUTDOWN_GRACE,
      }),
    ),
    Layer.provide(Layer.succeedContext(routedContext(tagma.graph, pool))),
    Layer.provide(Layer.succeedContext(tagma.bindings)),
  );

const pages = opening(
  'artifact door opened',
  HttpRouter.serve(artifactRoutes(tagma.artifacts, { index: '/', sandboxed: false }), {
    disableLogger: true,
    middleware: requestLine,
  }).pipe(
    Layer.provide(
      BunHttpServer.layer({
        hostname: LOOPBACK_HOST,
        port: artifactPort,
        idleTimeout: READ_DEADLINE,
        gracefulShutdownTimeout: SHUTDOWN_GRACE,
      }),
    ),
  ),
).pipe(Layer.provide(observations));

const sandboxAt = (hostname: string) =>
  sandboxServing(tagma.views, Context.get(tagma.door, Access), Context.get(tagma.door, PlacedSites)).pipe(
    Layer.provide(
      BunHttpServer.layer({
        hostname,
        port: sandboxPort,
        idleTimeout: READ_DEADLINE,
        gracefulShutdownTimeout: SHUTDOWN_GRACE,
      }),
    ),
  );
const sandbox = opening(
  'sandbox door opened',
  Layer.merge(sandboxAt(LOOPBACK_HOST), loopbackSix(sandboxAt(LOOPBACK_SIX), localSites, `[::1]:${sandboxPort}`)),
).pipe(Layer.provide(observations));

process.on('SIGHUP', () => process.kill(process.pid, 'SIGTERM'));

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    restartRecord.close();
    setTimeout(() => {
      console.error(
        `[tagma] pid ${process.pid} did not close within ${SHUTDOWN_DEADLINE_MS / 1000}s of ${signal}; it leaves without finishing, and SQLite keeps only what committed`,
      );
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS).unref();
  });

const frozen = Layer.succeed(FrozenBuilds, Context.get(localContext, FrozenBuilds));
const door = closing(
  'local door',
  Layer.effectContext(
    Effect.as(
      Effect.addFinalizer(() => Scope.close(localScope, Exit.void)),
      localContext,
    ),
  ),
  Effect.flatMap(succession.leaving, (leaving) =>
    leaving
      ? Effect.andThen(
          localConnections.closeAll(RESTARTING_CLOSE, 'the server is restarting'),
          Effect.sync(() => restartRecord.point('door-closed', { door: 'local' })),
        )
      : Effect.void,
  ),
).pipe(Layer.provide(observations));
const served = HttpRouter.serve(app, {
  disableLogger: true,
  middleware: (handled) => requestLine(gate(handled)),
}).pipe(
  Layer.provide(Layer.merge(pages, sandbox)),
  Layer.provide(frozen),
  Layer.provide(websocketHttpTracing),
  Layer.provide(door),
  Layer.provide(Layer.succeedContext(routedContext(tagma.graph, pool))),
  Layer.provide(Layer.succeedContext(tagma.bindings)),
);

const remote = Layer.effectDiscard(
  Effect.gen(function* () {
    const builds = Layer.succeed(FrozenBuilds, yield* FrozenBuilds);
    const held = remoteListener(
      (listening) => remoteServed(listening).pipe(Layer.provide(builds)),
      connections,
      remotePort,
      succession.leaving,
    );
    const listener = {
      ...held,
      open: held.open.pipe(Effect.tap(() => Effect.sync(() => restartRecord.point('door-ready', { door: 'remote' })))),
      close: held.close.pipe(
        Effect.tap(() =>
          Effect.flatMap(succession.leaving, (leaving) =>
            Effect.sync(() => {
              if (leaving) restartRecord.point('door-closed', { door: 'remote' });
            }),
          ),
        ),
      ),
    };
    yield* Effect.forkScoped(
      remoteDriving(
        Context.get(tagma.door, Devices),
        Context.get(tagma.door, Access),
        Context.get(tagma.door, ViewLanes),
        listener,
        connections,
      ).pipe(Effect.tapCause((cause) => Effect.logError('access from another network stopped', Cause.pretty(cause)))),
    );
  }),
).pipe(Layer.provide(frozen));

const logBound = serveLogBounding(serveLog).pipe(Layer.provide(BunFileSystem.layer));

const announced = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Scope.close(startingScope, Exit.void);
    restartRecord.point('door-ready', { door: 'local' });
    yield* attempt.open;
    yield* serving(notified);
    const { surface } = yield* (yield* FrozenBuilds).state;
    const handing =
      surface.served === null ? 'placeholder page, nothing installed on this machine' : `installation ${surface.served.build}`;
    console.log(`[tagma] surface http://${LOOPBACK_HOST}:${port} — ${handing}`);
    console.log(`[tagma] artifacts http://${LOOPBACK_HOST}:${artifactPort}`);
    tagma.runtime.runFork(
      Effect.andThen(userEnvironment.ready, recoverRuns(Context.get(tagma.owners, HarnessRegistry))).pipe(
        Effect.provide(observations),
        Effect.tap(() => Effect.sync(() => restartRecord.point('runs-restored'))),
        Effect.andThen(tagma.openMaintenance),
        Effect.onExit((exit) => (Exit.isFailure(exit) && !Cause.hasInterrupts(exit.cause) ? tagma.openMaintenance : Effect.void)),
        Effect.tapCause((cause) =>
          Effect.logError('run recovery failed; maintenance opened and the recovery lane retries', Cause.pretty(cause)),
        ),
      ),
    );
    tagma.runtime.runFork(
      Effect.gen(function* () {
        const installs = yield* InstalledHarnesses;
        yield* Stream.runForEach(installs.changes, () => homesIntegrated(process.env));
      }),
    );
    tagma.runtime.runFork(
      Effect.andThen(
        userEnvironment.ready,
        installationsRefreshed(installation?.manifest.identity.digest ?? source?.revision?.head ?? null, tagma.pool, process.env),
      ),
    );
    tagma.runtime.runFork(
      Effect.andThen(userEnvironment.ready, tagma.tagmaApps.start()).pipe(
        Effect.tapCause((cause) => Effect.sync(() => console.error('[tagma] the installed apps did not start', Cause.squash(cause)))),
      ),
    );
  }),
).pipe(Layer.provide(served), Layer.provide(frozen), Layer.provide(door));

BunRuntime.runMain(
  Layer.launch(Layer.mergeAll(served, announced, logBound, remote)).pipe(
    Effect.onExit((exit) =>
      Effect.gen(function* () {
        const { runOwnersDisposed, failures } = yield* closed;
        if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) yield* ended(exit.cause);
        const unclosed =
          failures.length > 0
            ? `pid ${process.pid} failed to close ${failures.length} writer owner(s): ${failures.map(String).join('; ')}`
            : runOwnersDisposed
              ? null
              : `pid ${process.pid} did not finish closing its thread owners`;
        if (unclosed === null) restartRecord.point('owners-closed');
        if (unclosed === null || (yield* succession.leaving)) {
          releaseActive();
          yield* dataLock.release;
          yield* succession.release(unclosed).pipe(Effect.orDie);
          yield* succession.settle;
        }
        if (failures.length > 0) {
          return yield* Effect.sync(() => {
            throw new AggregateError(failures, `Tagma failed to dispose ${failures.length} writer owner(s).`);
          });
        }
      }).pipe(Effect.ensuring(Scope.close(successionScope, exit))),
    ),
  ),
);
