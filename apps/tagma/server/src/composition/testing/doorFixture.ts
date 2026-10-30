import { TESTING_ADAPTERS } from './adapters.js';
import { inArray } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { threadRecord } from '../../thread-record/testing/doubles.js';
import { turnsOf } from '../../threads/testing/doubles.js';
import { basename, join } from 'node:path';
import { kind, own, shared, world } from '@runlith/testbed/worlds';
import type { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { FixtureScope } from '../../platform/testing/scope.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Context, Effect, FileSystem, Layer, type Scope, Stream } from 'effect';
import { AccountCli } from '../../providers/contract/service/cli.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { FetchHttpClient, HttpEffect, HttpMiddleware, HttpPlatform, HttpRouter, HttpServer } from 'effect/http';
import type { AccountQuotaProvider } from '../../providers/quota/ledger.js';
import type { ModelAccess } from '../../providers/contract/service/access.js';
import type { DecisionModels } from '../../providers/contract/service/decisions.js';
import type { ProcessProvenance } from '../../platform/contract/wire/provenance.js';
import { storageHomes } from '../../graph/testing/doubles.js';
import { doorLayer } from '../http/door.js';
import type { VendorWire } from '../../providers/accounts/signIns.js';
import { frozenBuildsLayer } from '../../installation/testing/doubles.js';
import { EXECUTIONS, type InstallationManifest } from '../../installation/contract/wire/manifest.js';
import { routedContext } from '../../graph/testing/doubles.js';
import { makeRuntime } from '../runtime.js';
import { chosenModel } from './chosenModel.js';
import { checkoutBuildsLayer } from '../../checkout-builds/testing/doubles.js';
import { devSurfaceLayer } from '../../checkout-builds/surface.js';
import { ServerProcess } from '../../installation/contract/service/succession.js';
import { doorCompositionLayer } from '../http/handlers.js';
import { successionLayer } from '../../installation/testing/doubles.js';
import { testGrantSigner } from '../../platform/testing/grants.js';
import { endHosts } from '../../executions/testing/doubles.js';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { requestEffect } from './httpRequest.js';
import { hostBundleRoot } from './hostBundle.js';
import type { DriverId } from '../manifest.js';
import { Settings } from '../../settings/contract/service/values.js';
import { keepAwake } from '../../power/keys.js';
import { vendorWire } from '@runlith/llm/oauth/vendorCall';
import { Exposure } from '../../remote/contract/service/exposure.js';
import { tenant } from './tenant.js';

type CallOptions = {
  readonly method?: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
};

export const DOOR_ORIGIN = 'http://tagma';

export const WORLD_SOURCE = {
  startedAt: '2026-01-01T00:00:00.000Z',
  revision: { head: 'wor1dcut', dirty: false },
} as const satisfies ProcessProvenance;

type DoorParams = {
  readonly installation?: InstallationManifest;
  readonly hostSourcePath?: string;
  readonly everySpan?: boolean;
  readonly drivers?: readonly DriverId[];
  readonly artifactOrigin?: string;
  readonly sandboxPort?: number;
};

type Seams = {
  readonly quotaProviders?: readonly AccountQuotaProvider[];
  readonly vendorWire?: VendorWire;
  readonly models?: (standing: ModelAccess['Service']) => ModelAccess['Service'];
  readonly decisions?: (standing: DecisionModels['Service']) => DecisionModels['Service'];
  readonly exposure?: Layer.Layer<Exposure>;
};

type WorldOptions = DoorParams &
  Seams & {
    readonly own?: string;
  };

type Lent = {
  readonly quotaProviders?: readonly AccountQuotaProvider[];
  readonly vendorWire?: VendorWire;
  readonly models?: ModelAccess['Service'];
  readonly decisions?: DecisionModels['Service'];
  readonly exposure?: Exposure['Service'];
};

const SEAMS = ['quotaProviders', 'vendorWire', 'models', 'decisions', 'exposure'] as const;

const lending = () => {
  const lent: Lent[] = [];
  const quota: AccountQuotaProvider[] = [];
  const standing: { models?: ModelAccess['Service']; decisions?: DecisionModels['Service'] } = {};
  const latest = <K extends keyof Lent>(key: K): Lent[K] => lent.findLast((entry) => entry[key] !== undefined)?.[key];
  const settle = () => quota.splice(0, quota.length, ...(latest('quotaProviders') ?? []));
  const over = <A>(asked: ((held: A) => A) | undefined, held: A | undefined, name: string) =>
    asked === undefined
      ? Effect.succeed(undefined)
      : held === undefined
        ? Effect.die(new Error(`the door world lends ${name} before its runtime stands`))
        : Effect.sync(() => asked(held));
  return {
    seams: {
      quotaProviders: quota,
      vendorWire: Layer.unwrap(Effect.sync(() => latest('vendorWire') ?? vendorWire)),
      models: (held: ModelAccess['Service']): ModelAccess['Service'] => {
        standing.models = held;
        const now = () => latest('models') ?? held;
        return {
          request: (input) => now().request(input),
          served: (provider, model, runId) => now().served(provider, model, runId),
          defaultModel: (provider, runId) => now().defaultModel(provider, runId),
        };
      },
      decisions: (held: DecisionModels['Service']): DecisionModels['Service'] => {
        standing.decisions = held;
        return { decide: (call, request) => (latest('decisions') ?? held).decide(call, request) };
      },
      exposure: (held: Exposure['Service']): Exposure['Service'] => {
        const now = () => latest('exposure') ?? held;
        return {
          expose: (port, settled) => now().expose(port, settled),
          place: (asked, reserved, keep) => now().place(asked, reserved, keep),
          point: (asked, keep) => now().point(asked, keep),
          withdraw: (port, pointed) => now().withdraw(port, pointed),
        };
      },
    },
    lend: (asked: Seams): Effect.Effect<void, never, Scope.Scope> =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const entry: Lent = {
            quotaProviders: asked.quotaProviders,
            vendorWire: asked.vendorWire,
            models: yield* over(asked.models, standing.models, 'models'),
            decisions: yield* over(asked.decisions, standing.decisions, 'decisions'),
            exposure: asked.exposure === undefined ? undefined : Context.get(yield* Layer.build(asked.exposure), Exposure),
          };
          lent.push(entry);
          settle();
          return entry;
        }),
        (entry) =>
          Effect.sync(() => {
            lent.splice(lent.indexOf(entry), 1);
            settle();
          }),
      ).pipe(Effect.asVoid),
  };
};

const noCli = () =>
  Effect.fail(
    new GateRefusal('account-cli-failed', 'The door world supplies no account CLI process.', [
      'test a CLI through its owner with a controlled program',
    ]),
  );
const accountCli = AccountCli.of({
  installed: () => Effect.succeed({ _tag: 'Found' }),
  changes: Stream.empty,
  run: noCli,
  login: noCli,
  ended: () => Effect.die('the door world opens no account login terminal'),
  stop: noCli,
});

const built = Effect.fnUntraced(
  function* (options: DoorParams, root: string, processes: ProcessPool) {
    const { seams, lend } = lending();
    const fixture = yield* FixtureScope.acquire(root);
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const report = yield* fixture.close();
        if (report.state === 'released') return;
        const failures = report.failures.map((failure) => `${failure.name}: ${failure.reason}`);
        return yield* Effect.die(
          new Error(
            `the door world let go ${report.state}: ${[...failures, ...report.remaining.map((path) => `${path} still stands`)].join('; ')}`,
          ),
        );
      }),
    );
    yield* fixture.producer(
      'execution hosts',
      Effect.gen(function* () {
        const survivors = yield* endHosts(fixture.root);
        if (survivors.length > 0) return yield* Effect.fail(new Error(`hosts still stand under ${fixture.root}: ${survivors.join(', ')}`));
      }),
    );
    const data = yield* fixture.directory('home');
    const sourceCheckout = yield* fixture.directory('source');
    const serverPath = yield* fixture.directory('source/server');
    const hostBundlePath = options.hostSourcePath === undefined ? yield* Effect.orDie(hostBundleRoot) : undefined;
    const installed =
      options.installation === undefined
        ? undefined
        : {
            root: yield* fixture.directory('installation'),
            manifest: options.installation,
          };
    if (installed !== undefined && hostBundlePath !== undefined) {
      yield* Effect.orDie((yield* FileSystem.FileSystem).symlink(hostBundlePath, join(installed.root, EXECUTIONS)));
    }
    const runtime = yield* makeRuntime(
      {
        adapters: TESTING_ADAPTERS,
        accountCli,
        grants: testGrantSigner,
        profileWindowMs: () => 0,
        spanFloorMicros: options.everySpan === true ? () => 0 : undefined,
        databasePath: join(data, 'tagma.sqlite'),
        tokensPath: join(data, 'tokens.json'),
        attachmentsPath: join(data, 'attachments'),
        artifactOrigin: options.artifactOrigin,
        sandboxPort: options.sandboxPort,
        localOrigin: DOOR_ORIGIN,
        sourcePath: serverPath,
        hostSourcePath: options.hostSourcePath,
        hostBundlePath,
        ...seams,
        source: options.installation === undefined ? WORLD_SOURCE : undefined,
        installation: installed,
        drivers: options.drivers ?? [],
      },
      Layer.empty,
      processes,
    );
    const registry = Context.get(runtime.owners as Context.Context<ProviderRegistry>, ProviderRegistry);
    const { sections, wires } = registry.current();
    const ownModes = sections.flatMap((section) =>
      section.options.filter((option) => wires.registered(option.provider)).map((option) => [section.id, option.id] as const),
    );
    yield* Effect.forEach(ownModes, ([section, mode]) => Effect.orDie(registry.selectMode(section, mode)));
    yield* Effect.orDie(chosenModel(runtime));
    yield* Effect.orDie(Context.get(runtime.graph, Settings).write({ scope: 'user', key: keepAwake.id, value: 'off' }));

    const routed = routedContext(runtime.graph, runtime.pool);
    const installation = yield* Layer.build(
      Layer.mergeAll(
        successionLayer(undefined, join(data, 'install'), join(data, 'serve.log')),
        checkoutBuildsLayer({ checkout: undefined, log: join(data, 'build.log'), worktrees: join(data, 'build') }),
        devSurfaceLayer({ checkout: undefined, port: 5642 }).pipe(
          Layer.provide(Layer.mergeAll(Layer.succeedContext(runtime.door), FetchHttpClient.layer)),
        ),
      ),
    );
    const born = { startedAt: new Date(yield* Clock.currentTimeMillis).toISOString(), replacedPid: null };
    const routes = yield* HttpRouter.toHttpEffect(
      doorLayer({ status: runtime.status }).pipe(
        Layer.provide(doorCompositionLayer),
        Layer.provide(
          Layer.succeedContext(
            Context.mergeAll(
              runtime.door,
              installation,
              Context.make(ServerProcess, {
                born,
                source: runtime.status.source,
              }),
            ),
          ),
        ),
        Layer.provide(frozenBuildsLayer({ dataPath: data })),
        Layer.provide(Layer.succeedContext(routed)),
        Layer.provide(Layer.succeedContext(runtime.bindings)),
        Layer.provide(HttpServer.layerServices),
        Layer.provideMerge(HttpPlatform.layer),
        Layer.provideMerge(BunFileSystem.layer),
      ),
    );
    const handler = Effect.provideService(routes, FileSystem.FileSystem, yield* FileSystem.FileSystem);
    const app = HttpEffect.toWebHandlerWith<never, Effect.Services<typeof handler>>(Context.empty())(handler, HttpMiddleware.logger);

    const call = (path: string, init: CallOptions = {}) =>
      Effect.provide(
        requestEffect(
          handler,
          new Request(`${DOOR_ORIGIN}${path}`, {
            method: init.method ?? 'GET',
            headers: { 'content-type': 'application/json', ...init.headers },
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
          }),
        ),
        routed,
      );

    let sequence = 0;
    const uniqueName = () => `${basename(fixture.root).replaceAll('.', '-')}-p${++sequence}`;
    let given = 0;
    const directory = (label: string) => Effect.suspend(() => fixture.directory(`roots/${label}-${++given}`));
    const unversioned = Effect.fnUntraced(function* (catalogs: readonly string[] | undefined) {
      const created = yield* call('/api/op/add_project', {
        method: 'POST',
        body: { name: uniqueName(), rootPath: yield* directory('book'), storage: 'stealth', catalogs },
      });
      if (created.status !== 200) return yield* Effect.die(new Error(`add_project refused: ${JSON.stringify(created.body)}`));
      return (created.body as { project: { id: number } }).project.id;
    });
    const stealth = Effect.fnUntraced(function* (rootPath?: string) {
      const root = rootPath ?? (yield* directory('project'));
      yield* spawnedEffect(['git', 'init', '-q', '-b', 'main'], { cwd: root });
      const created = yield* call('/api/op/add_project', {
        method: 'POST',
        body: { name: uniqueName(), rootPath: root, storage: 'stealth' },
      });
      return (created.body as { project: { id: number } }).project.id;
    });

    return {
      runtime,
      routed,
      app,
      call,
      op: (id: string, input: unknown, query = '', headers?: Readonly<Record<string, string>>) =>
        call(`/api/op/${id}${query === '' ? '' : `?${query}`}`, { method: 'POST', body: input, headers }),
      uniqueName,
      directory,
      stealthProject: (rootPath?: string) => tenant(stealth(rootPath)),
      plainProject: () => tenant(unversioned(undefined)),
      knowledgeProject: (catalogs: readonly string[] = ['knowledge']) => tenant(unversioned(catalogs)),
      sourceCheckout,
      root: fixture.root,
      dataHome: storageHomes(join(data, 'tagma.sqlite')).appHome,
      lend,
    };
  },
  (effect) => Effect.provide(effect, BunFileSystem.layer),
);

export class DoorFixture extends Context.Service<DoorFixture, Effect.Success<ReturnType<typeof built>>>()('testing/DoorFixture') {}

export const doorWorld = kind(DoorFixture, (params: DoorParams, home: string) =>
  Effect.flatMap(heldPool, (pool) => built(params, home, pool)),
);

const paramsOf = (options: WorldOptions): DoorParams => ({
  installation: options.installation,
  hostSourcePath: options.hostSourcePath,
  everySpan: options.everySpan,
  drivers: options.drivers,
  artifactOrigin: options.artifactOrigin,
  sandboxPort: options.sandboxPort,
});

const lends = (options: WorldOptions) => SEAMS.some((name) => options[name] !== undefined);

const taken = (options: WorldOptions) =>
  options.own === undefined ? shared(doorWorld, paramsOf(options)) : own(doorWorld, paramsOf(options), options.own);

export const makeDoorWorld = (options: WorldOptions = {}) =>
  lends(options) ? Effect.tap(taken(options), (door) => door.lend(options)) : taken(options);

export const doorFixture = (options: WorldOptions = {}) => {
  const standing =
    options.own === undefined ? world(doorWorld, paramsOf(options)) : world(doorWorld, paramsOf(options), { own: options.own });
  if (!lends(options)) return standing;
  return Layer.effect(
    DoorFixture,
    Effect.gen(function* () {
      const door = yield* DoorFixture;
      yield* door.lend(options);
      return door;
    }),
  ).pipe(Layer.provide(standing));
};

export const projectLeaving = (world: DoorFixture['Service'], ...projectIds: readonly number[]) =>
  Effect.addFinalizer(() =>
    tenant(
      Effect.gen(function* () {
        const db = Context.get(world.runtime.graph, MachineStore).db;
        const rows = yield* db.select({ id: threadRecord().id }).from(threadRecord()).where(inArray(threadRecord().projectId, projectIds));
        const records = Context.get(world.runtime.owners, ThreadRecords);
        for (const row of rows) {
          const projectId = yield* records.projectOf(row.id);
          if (projectId !== undefined) yield* Effect.provide(turnsOf(world.runtime.owners).delete(row.id, projectId), world.runtime.owners);
        }
        for (const projectId of projectIds) {
          const removed = yield* world.op('remove_project', { ref: String(projectId) });
          if (removed.status !== 200)
            return yield* Effect.die(new Error(`project ${projectId} was not removed: ${JSON.stringify(removed.body)}`));
        }
      }).pipe(Effect.orDie),
    ),
  );
