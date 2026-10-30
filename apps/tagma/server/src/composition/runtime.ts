import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { childLedgerLayer, logicYieldLayer } from './children.js';
import { claimHoldersLayer } from './hostClaims.js';
import type { GrantSigner } from '../platform/contract/service/grantSigner.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import { RipgrepBinary } from '../platform/contract/service/ripgrep.js';
import { ripgrepBinary } from './ripgrepBinary.js';
import { Clock, Context, Deferred, Effect, Exit, Layer, ManagedRuntime, Scope, Tracer } from 'effect';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import type { HostLifetime } from '@runlith/executions/protocol/boot';
import { CpuProfiles } from '@runlith/performance/CpuProfiles';
import { HeapSnapshots } from '@runlith/performance/HeapSnapshots';
import { MemoryCaptures } from '@runlith/performance/MemoryCaptures';
import { PerformanceReports } from '@runlith/performance/PerformanceReports';
import type { PerformanceStore } from '@runlith/performance/PerformanceStore';
import type * as ProcessVitals from '@runlith/performance/ProcessVitals';
import { ActivityStore } from '@runlith/activity/store';
import { Handover } from '@runlith/sqlite-process/SqliteProcess';
import type { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { performance } from '../performance/performance.js';
import type { Measurement } from '../performance/contract/service/measurement.js';
import { LiveSettings, PerformancePlace } from '../performance/contract/service/place.js';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { WatchLifetime } from '@runlith/watch/client';
import { fileWatcherLayer } from './fileWatcher.js';
import { PROGRAM_RELEASE } from '../platform/contract/wire/program.js';
import { MachineAgents } from '../installation/contract/service/agents.js';
import { MachineCalls } from '../installation/contract/service/calls.js';
import { Listenings } from '../speech/contract/service/listenings.js';
import { ThreadRunning } from '../threads/contract/service/reads.js';
import type { TokenStore } from '@runlith/llm/oauth/FileTokenStore';
import { artifacts } from '../artifacts/artifacts.js';
import { ArtifactStore, ShelfPlace } from '../artifacts/contract/service/shelf.js';
import type { AccountQuotaProvider } from '../providers/quota/ledger.js';
import { AccountQuota } from '../providers/contract/service/quota.js';
import { AccountCredentials, ModelAccess } from '../providers/contract/service/access.js';
import { DefaultAccounts } from '../providers/contract/service/accounts.js';
import { CredentialFiles, KeyedProviders, ProviderCredentials, QuotaProviders } from '../providers/contract/service/credentials.js';
import { credentialsLayer } from '../speech/credentials.js';
import { speech } from '../speech/speech.js';
import { RECORDINGS, RecordingsPlace } from '../speech/contract/service/recording.js';
import { KEYED_SPEECH, speechBindings, speechPlace } from './speech.js';
import { callThreads } from './callThreads.js';
import { browserBindings, browserRuns, cookieSourcesLayer } from './browser.js';
import { browser } from '../browser/browser.js';
import { images } from '../images/images.js';
import { managedBrowser } from '../managed-browser/managed-browser.js';
import { pageRender } from '../page-render/page-render.js';
import { desktopBrowser } from '../desktop-browser/desktop-browser.js';
import { CallThreads } from '../speech/contract/service/callThreads.js';
import { Attachments } from '../threads/contract/service/attachments.js';
import { ThreadTurns } from '../threads/turns/acts.js';
import { providers } from '../providers/providers.js';
import type { VendorWire } from '../providers/accounts/signIns.js';
import { SignIns, VendorWires } from '../providers/contract/service/signIns.js';
import { AdapterPlaces, type AdapterSource, BuiltinAdapters } from '../providers/contract/service/registry.js';
import { adapterPlaces, BUILTIN_ADAPTERS } from './adapters.js';
import { dataPathOf, MachineStore, GraphStore, storeDirectory } from '../platform/contract/service/store.js';
import { type AssemblyInvalid, type Started, start } from './start.js';
import { MachineUnits, GraphUnits } from '../platform/contract/service/units.js';
import type { GraphSteps } from '../graph/contract/service/steps.js';
import { platform } from '../platform/platform.js';
import { lazyLayer, manifests } from '../platform/contract/service/manifest.js';
import { remote } from '../remote/remote.js';
import { Exposure } from '../remote/contract/service/exposure.js';
import { Sender } from '../push/contract/service/sender.js';
import { unitsLayer } from '../platform/store/units.js';
import type { ProcessProvenance } from '../platform/contract/wire/provenance.js';
import type { ConsoleKeyStore } from '../providers/credentials/consoleKeys.js';
import { consoleKeyRollback, snapshotAssembly } from './snapshots.js';
import { ConsoleKeyRollback, DowngradeSteps, SuccessionSteps } from '../installation/contract/service/steps.js';
import { StoreSnapshots } from '../platform/contract/service/snapshots.js';
import { serving } from './serving.js';
import type { HandlerOwners, RuntimeDoor } from './http/handlers.js';
import type { RuntimeSocketDoor } from './socketBinding.js';
import { ToolOutputsPlace } from '../native-harness/contract/service/toolOutputs.js';
import { HarnessOwner } from '../threads/contract/service/engine.js';
import { ThreadFilesPlace } from '../threads/contract/service/parts.js';
import { ScratchAreas } from '../threads/contract/service/scratch.js';
import { McpPlaces } from '../mcp/contract/service/places.js';
import { pluginServersLayer } from '../plugins/servers.js';
import { plugins } from '../plugins/plugins.js';
import { PluginPlaces } from '../plugins/contract/service/plugins.js';
import { PluginFormats } from '../plugins/contract/service/format.js';
import { claudeCodeFormat } from '../plugin-formats/claude-code/format.js';
import { agentPluginsFormat } from '../plugin-formats/agent-plugins/format.js';
import { codexFormat } from '../plugin-formats/codex/format.js';
import { claudeCodeList } from '../plugin-formats/claude-code/list.js';
import { codexList } from '../plugin-formats/codex/list.js';
import { marketplaces } from '../marketplaces/marketplaces.js';
import { ListFormats } from '../marketplaces/contract/service/lists.js';
import { MarketplacePlaces, MarketplacePresets } from '../marketplaces/contract/service/marketplaces.js';
import type { MarketplacePreset } from '../marketplaces/contract/wire/presets.js';
import { Coverage } from '../workspace/contract/service/roots.js';
import { mcpPlaces } from './mcpPlaces.js';
import { MachineWorld } from '../executions/contract/service/worlds.js';
import { Holdings } from '../change-record/contract/service/holdings.js';
import { holderAt } from '../workspace/contract/wire/checkout.js';
import { CarrierAdmission } from '../change-record/contract/service/carriers.js';
import { PreparedChanges } from '../change-record/contract/service/prepared.js';
import { WORKTREE_HOME, WorktreeHome } from '../worktrees/contract/service/home.js';
import { installationAnchor } from '../installation/paths.js';
import { sessionIdentity } from '../external-harnesses/sessionPrefix.js';
import { accountCliLayer } from '../external-harnesses/accounts/cli.js';
import { askProgramsLayer } from '../external-harnesses/programs/asks.js';
import { AccountCli } from '../providers/contract/service/cli.js';
import { installedHarnessesLayer } from '../external-harnesses/birth/installed.js';
import { harnessAdaptersLayer } from '../external-harnesses/adapters.js';
import type { HarnessAdapters } from '../external-harnesses/contract/service/adapters.js';
import { UserEnvironment } from '../installation/contract/service/userEnvironment.js';
import type { InstalledHarnesses } from '../threads/contract/service/harness.js';
import { makeUserEnvironment } from '../installation/process/userEnvironment.js';
import { enforcement } from '../enforcement/enforcement.js';
import { FactCache } from '../enforcement/contract/service/factCache.js';
import { InspectionCode } from '../enforcement/contract/service/inspectionCode.js';
import type { InspectionsInstalled, JudgingServices } from '../enforcement/serving.js';
import { CommitGateCli, type HookCli } from '../enforcement/commits/hooks.js';
import { CommitQueue } from '../enforcement/commits/queue.js';
import type { SharedPrepared } from '../change-record/contract/service/prepared.js';
import { changeRecord } from '../change-record/change-record.js';
import { doctrine } from './doctrine.js';
import { Doctrine } from '../platform/contract/service/sections.js';
import { OPERATION_IDS } from './catalog.js';
import { commandLedger, hostBackend, machineWorld } from '../executions/ports.js';
import { AwakePolicy } from '../power/contract/service/awake.js';
import { AgentPace } from '../power/contract/service/pace.js';
import { agentPaceLayer } from '../power/pace.js';
import { power } from '../power/power.js';
import { editors } from '../editors/editors.js';
import { editorBindings } from './editors.js';
import { CommandLedger } from '../executions/contract/service/worlds.js';
import { WorkspaceInputs } from '../native-harness/contract/service/inputs.js';
import { OwnSkillDirectories } from '../native-harness/contract/service/ownSkills.js';
import { nativeHarness } from '../native-harness/native-harness.js';
import { skillTarget, userSkillTarget } from '../external-harnesses/installs/targets.js';
import { databasePath, seedDirectory } from '../installation/paths.js';
import { InstalledChannel } from '../installation/contract/service/channel.js';
import { CHANNEL } from '@tagma/server/composition/channel';
import { AFTER_RECOVERY, BEHAVIOUR_REGISTRY, DRIVERS, type DriverId, ENTRY_KINDS, NATIVE_AGENT_RULES, POOLS } from './manifest.js';
import { makeDrives } from './drives.js';
import { Drives } from '../platform/contract/service/drives.js';
import { Capacity, serverCapacity, thisMachine } from '../platform/contract/service/capacity.js';
import { DeclaredNativeRules } from '../native-harness/contract/service/rules.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { approvalModesLayer } from '@runlith/agent/modes/ApprovalModes';
import { LiveRpc } from './rpc.js';
import { projects } from '../projects/projects.js';
import { workspace } from '../workspace/workspace.js';
import type { WorkspaceServices } from '../workspace/layer.js';
import { SandboxEnvironment } from '../sandbox/contract/service/environment.js';
import { sandbox } from '../sandbox/sandbox.js';
import { GuestInstallation } from '../sandbox/contract/service/installation.js';
import { SandboxHolds } from '../sandbox/contract/service/holds.js';
import { sandboxHolds } from '../threads/resources/sandbox.js';
import { makeThreadResourceStore } from '../threads/store/resources.js';
import { EnvironmentBackends } from '../workspace/contract/service/environments.js';
import { makeBackendRegistry } from '../workspace/environments/backends.js';
import { worktreeRecordsLayer } from '../worktrees/layer.js';
import type { WorktreeRecords } from '../worktrees/contract/service/worktrees.js';
import type { WorktreeIntents } from '../worktrees/contract/service/intents.js';
import type { World } from '@runlith/agent-tools/world';
import { CARRIED_RIPGREP, presentCarried } from '../installation/closure/carried.js';
import type { ExecutionServices } from '../executions/assembly.js';
import { executions } from '../executions/executions.js';
import { HostOffering, type HostPlacement, type OfferSource } from '../executions/contract/service/host.js';
import { Terminals } from '../executions/contract/service/terminals.js';
import { ThreadList } from '../threads/contract/service/list.js';
import { graph } from '../graph/graph.js';
import { Catalogs } from '../graph/contract/wire/catalogs.js';
import { Behaviours } from '../graph/contract/service/behaviours.js';
import { DeclaredSettings } from '../settings/contract/service/declarations.js';
import type { GraphServices } from '../graph/contract/service/services.js';
import { machineGraphOf } from '../graph/serving/machine.js';
import { ServingPool } from '../graph/serving/poolLayer.js';
import { GraphMigrations, GraphSource } from '../graph/contract/service/source.js';
import { ServedGraphs } from '../graph/contract/service/serving.js';
import { closing, phase } from './phase.js';
import type { RuntimeStatus } from './http/status.js';
import { ReservedNames } from '../projects/contract/service/names.js';
import { Api } from '../http/contract/wire/Api.js';
import { ARTIFACT_PREFIX } from '../http/contract/wire/served.js';
import { type LocalSites, makeLocalSites } from './http/sites.js';
import { localEndpoint } from './http/endpoint.js';
import { LaneEndpoint } from '../executions/contract/service/views.js';
import { localSignInDoor } from './http/signInDoor.js';
import { McpSignInDoor } from '../mcp/contract/service/door.js';
import { McpServers } from '../mcp/contract/service/servers.js';
import { mcp } from '../mcp/mcp.js';
import { tagmaApps } from '../tagma-apps/tagma-apps.js';
import { views } from '../views/views.js';
import { secrets } from '../secrets/secrets.js';
import { SecretsPlace } from '../secrets/contract/service/secrets.js';
import { TagmaAppViews, ViewSites } from '../views/contract/service/views.js';
import { WantedSites } from '../remote/contract/service/sites.js';
import { TagmaAppPlace, TagmaApps } from '../tagma-apps/contract/service/supervision.js';
import { machineStoreLayer } from '../installation/registry/restore.js';
import { installation } from '../installation/installation.js';
import { portBlock } from '../installation/contract/wire/ports.js';
import { admitAssembled } from './ports.js';
import { landing } from '../landing/landing.js';
import { externalHarnesses } from '../external-harnesses/external-harnesses.js';
import { activityMigrations, migrationsFolder } from '../installation/closure/read.js';
import { activity } from '../activity/activity.js';
import { ActivityPlace } from '../activity/contract/service/place.js';
import { AGENT_SPAN_NAMES } from '@runlith/agent/spans';
import { EXECUTIONS, type Installation } from '../installation/contract/wire/manifest.js';
import { labelRevision } from '../installation/contract/wire/layout.js';
import { Settings } from '../settings/contract/service/values.js';
import { declaredSettings, SETTING_DECLARATIONS, SHIPPED_CATALOGS } from './settings.js';
import { threadRecord } from '../thread-record/thread-record.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { sessionResolution } from '../external-harnesses/sessionResolution.js';
import { SessionResolution } from '../external-harnesses/contract/service/sessionResolution.js';
import { OperationChecks } from '../invocation/contract/service/operationChecks.js';
import { threadLineageLayer } from '../workspace/assignments/lineage.js';
import { ThreadLineage } from '../workspace/contract/service/assignments.js';

export type ServerRuntime = {
  liveGroup: typeof LiveRpc;
  runtime: ManagedRuntime.ManagedRuntime<
    | GraphServices
    | GraphSteps
    | MachineStore
    | GraphStore
    | GraphUnits
    | MachineUnits
    | ActivityStore
    | PerformanceStore
    | PerformanceReports
    | CpuProfiles
    | MemoryCaptures
    | HeapSnapshots
    | CommandLedger
    | ModelAccess
    | AccountCredentials
    | AccountQuota
    | DefaultAccounts
    | WorkspaceInputs
    | WorkspaceServices
    | WorktreeRecords
    | WorktreeIntents
    | ExecutionServices
    | AwakePolicy
    | InspectionsInstalled
    | InstalledHarnesses
    | HarnessAdapters,
    never
  >;
  graph: Context.Context<GraphServices | GraphStore | GraphUnits | MachineStore | MachineUnits>;
  enforcement: Context.Context<JudgingServices | OperationChecks>;
  pool: ServedGraphs['Service'];
  tokens: TokenStore;
  consoleKeys: ConsoleKeyStore;
  models: ModelAccess['Service'];
  credentials: AccountCredentials['Service'];
  accountQuota: AccountQuota['Service'];
  signIns: SignIns['Service'];
  owners: Context.Context<
    | Layer.Success<typeof serving>
    | Layer.Services<typeof serving>
    | Layer.Success<typeof providers.lifetimes.installation>
    | HandlerOwners
    | RuntimeSocketDoor
  >;
  scratch: ScratchAreas['Service'];
  resolution: SessionResolution['Service'];
  grants: GrantSigner['Service'];
  sourceCache: WorkspaceInputs['Service'];
  prepared: SharedPrepared;
  machineWorld: World;
  workspace: Context.Context<WorkspaceServices | WorktreeRecords | WorktreeIntents>;
  executions: Context.Context<ExecutionServices>;
  awake: Context.Service.Shape<typeof AwakePolicy>;
  pace: AgentPace['Service'];
  closeStack: Effect.Effect<void>;
  openMaintenance: Effect.Effect<void>;
  measurement: Measurement;
  mcp: Context.Service.Shape<typeof McpServers>;
  tagmaApps: TagmaApps['Service'];
  views: TagmaAppViews['Service'];
  artifacts: ArtifactStore['Service'];
  status: RuntimeStatus;
  door: Context.Context<RuntimeDoor>;
  bindings: Started['bindings'];
  steps: Context.Context<ConsoleKeyRollback | DowngradeSteps>;
};

export type RuntimeFailure = AssemblyInvalid | Layer.Error<typeof serving>;

const PROGRAM_SHELL = '/bin/sh';

const exposureOf = <E, R>(
  standing: Layer.Layer<Exposure, E, R>,
  given: ((standing: Exposure['Service']) => Exposure['Service']) | undefined,
): Layer.Layer<Exposure, E, R> =>
  given === undefined
    ? standing
    : Layer.effect(
        Exposure,
        Effect.gen(function* () {
          return given(yield* Exposure);
        }),
      ).pipe(Layer.provide(standing));

export const makeRuntime = Effect.fn('composition.runtime')(function* (
  options: {
    grants: GrantSigner['Service'];
    databasePath?: string;
    seedPath?: string;
    tokensPath: string;
    attachmentsPath: string;
    toolOutputsPath?: string;
    scratchPath?: string;
    artifactsPath?: string;
    recordingsPath?: string;
    artifactOrigin?: string;
    sandboxPort?: number;
    sites?: LocalSites;
    sourcePath: string;
    source?: ProcessProvenance;
    quotaProviders?: readonly AccountQuotaProvider[];
    profileWindowMs?: () => number;
    spanFloorMicros?: () => number;
    hostSourcePath?: string;
    hostBundlePath?: string;
    placedHost?: HostPlacement;
    replacingHost?: boolean;
    hostLifetime?: HostLifetime;
    watchLifetime?: WatchLifetime;
    hostEnded?: (executions: number | undefined, detail: string) => Effect.Effect<void>;
    installation?: Installation;
    models?: (standing: ModelAccess['Service']) => ModelAccess['Service'];
    memoryCeiling?: ProcessVitals.MemoryCeiling;
    commitGate?: HookCli;
    vendorWire?: VendorWire;
    leaving?: Effect.Effect<boolean>;
    opened?: Effect.Effect<void>;
    hostTakenAfter?: Effect.Effect<void>;
    exposure?: (standing: Exposure['Service']) => Exposure['Service'];
    marketplaces?: readonly MarketplacePreset[];
    sender?: Sender['Service'];
    tagmaAppServer?: string;
    localOrigin?: string;
    adapters?: readonly AdapterSource[];
    userEnvironment?: UserEnvironment['Service'];
    accountCli?: AccountCli['Service'];
    drivers?: readonly DriverId[];
  },
  observations: Layer.Layer<never> = Layer.empty,
  processes: ProcessPool,
  prepared: Context.Context<never> = Context.empty(),
): Effect.fn.Return<ServerRuntime, RuntimeFailure, Scope.Scope> {
  const baseScope = yield* Scope.fork(yield* Effect.scope);
  const poolScope = yield* Scope.fork(yield* Effect.scope);
  const originPath = options.installation?.manifest.origin?.checkout;
  const reader =
    options.source ??
    (options.installation === undefined || originPath === undefined
      ? undefined
      : {
          startedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
          revision: labelRevision(options.installation.manifest.identity.build),
        });
  const ports = portBlock(CHANNEL.port);
  const artifactOrigin = options.artifactOrigin ?? `http://localhost:${ports.artifact}`;
  const sandboxPort = options.sandboxPort ?? ports.sandbox;
  const sandboxOrigin = new URL(`http://127.0.0.1:${sandboxPort}`).origin;
  const reservedNames = new Set(
    [...Object.values(Api.groups).flatMap((group) => Object.values(group.endpoints).map((endpoint) => endpoint.path)), ARTIFACT_PREFIX]
      .map((path) => (path.split('/')[1] ?? '').toLowerCase())
      .filter((name) => name !== ''),
  );
  const graphLayerForRuntime = graph.lifetimes.installation.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Catalogs, SHIPPED_CATALOGS),
        Layer.succeed(Behaviours, BEHAVIOUR_REGISTRY),
        Layer.effect(DeclaredSettings, declaredSettings),
        Layer.succeed(GraphSource, {
          sourcePath: options.sourcePath,
          originPath,
          source: reader,
        }),
      ),
    ),
  );
  const [foundation] = manifests(platform);
  const storePath = options.databasePath ?? databasePath(CHANNEL);
  const dataPath = dataPathOf(storePath);
  const {
    migrations,
    graphMigrations,
    bindings,
    maintenance,
    scope: stackScope,
  } = yield* Effect.acquireRelease(
    start(
      migrationsFolder,
      options.seedPath ?? seedDirectory(),
      sessionIdentity,
      options.grants,
      SETTING_DECLARATIONS.keys,
      OPERATION_IDS,
      yield* snapshotAssembly(storePath, dirname(options.tokensPath), processes),
    ),
    (started) => Scope.close(started.scope, Exit.void),
  );
  const instanceId = randomUUID();
  const driving = makeDrives(DRIVERS, options.drivers === undefined ? undefined : new Set(options.drivers));
  const measured = performance.lifetimes.installation.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.effect(
          LiveSettings,
          Effect.map(Settings, (settings) => ({ live: settings.live })),
        ),
        Layer.succeed(PerformancePlace, {
          instanceId,
          databasePath: storePath,
          units: new Set<string>([...OPERATION_IDS, ...AGENT_SPAN_NAMES]),
          profileWindowMs: options.profileWindowMs,
          spanFloorMicros: options.spanFloorMicros,
          memoryCeiling: options.memoryCeiling,
        }),
      ),
    ),
  );
  const instrumentedTraces = commandLedger({ instanceId }).pipe(Layer.provideMerge(measured));
  const providerLayer = providers.lifetimes.installation.pipe(
    Layer.provide(Layer.succeed(CredentialFiles, { tokensPath: options.tokensPath })),
    Layer.provide(Layer.succeed(KeyedProviders, { ids: KEYED_SPEECH })),
    Layer.provide(Layer.succeed(BuiltinAdapters, { sources: options.adapters ?? BUILTIN_ADAPTERS })),
    Layer.provide(Layer.succeed(AdapterPlaces, adapterPlaces(dataPath))),
    Layer.provide(
      options.quotaProviders === undefined ? Layer.empty : Layer.succeed(QuotaProviders, { providers: options.quotaProviders }),
    ),
    Layer.provide(options.vendorWire === undefined ? Layer.empty : Layer.succeed(VendorWires, { wire: options.vendorWire })),
  );
  const machine = machineWorld(() => presentCarried(CARRIED_RIPGREP));
  const calls = callThreads();
  const browserThreads = browserRuns();
  const mcpPlacesPort = mcpPlaces();
  const sandboxInstallation = Layer.effect(
    EnvironmentBackends,
    Effect.gen(function* () {
      return makeBackendRegistry({ backends: [yield* hostBackend(machine), (yield* SandboxEnvironment).backend] });
    }),
  ).pipe(
    Layer.provide(BunFileSystem.layer),
    Layer.provideMerge(
      sandbox.lifetimes.installation.pipe(
        Layer.provide(
          Layer.effect(
            SandboxHolds,
            Effect.gen(function* () {
              return sandboxHolds(yield* makeThreadResourceStore);
            }),
          ),
        ),
        Layer.provide(Layer.succeed(GuestInstallation, { installation: options.installation })),
      ),
    ),
  );
  const workingLayerWithUnits = workspace.lifetimes.installation.pipe(
    Layer.provide(sandboxInstallation),
    Layer.provideMerge(worktreeRecordsLayer),
    Layer.provide(changeRecord.lifetimes.installation),
    Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
    Layer.provideMerge(unitsLayer(MachineUnits, MachineStore)),
  );
  const threadRecords = closing(
    'thread records',
    threadLineageLayer.pipe(
      Layer.provideMerge(threadRecord.lifetimes.installation),
      Layer.provideMerge(unitsLayer(MachineUnits, MachineStore)),
    ),
  );
  const carriedBundle = options.installation === undefined ? options.hostBundlePath : join(options.installation.root, EXECUTIONS);
  const hostSource: OfferSource | undefined =
    carriedBundle !== undefined
      ? { _tag: 'Closure', path: carriedBundle }
      : options.hostSourcePath === undefined
        ? undefined
        : {
            _tag: 'Checkout',
            path: options.hostSourcePath,
            build:
              options.source === undefined || options.source.revision === null
                ? (options.source?.startedAt ?? new Date(yield* Clock.currentTimeMillis).toISOString())
                : `${options.source.revision.head}${options.source.revision.dirty ? '-dirty' : ''}`,
          };
  const executionsLayerWithDeps = Layer.orDie(
    executions.lifetimes.installation.pipe(
      Layer.provide(
        Layer.succeed(HostOffering, {
          source: hostSource,
          placed: options.placedHost,
          replacing: options.replacingHost,
          hostEnded: options.hostEnded,
          migrations,
          programVersion: PROGRAM_RELEASE,
          lifetime: options.hostLifetime,
          takenAfter: options.hostTakenAfter,
        }),
      ),
      Layer.provide(measured),
      Layer.provide(logicYieldLayer(options.hostSourcePath, carriedBundle)),
      Layer.provide(claimHoldersLayer),
      Layer.provideMerge(HostRegistration.layer),
      Layer.provide(endpointConnection),
      Layer.provideMerge(workingLayerWithUnits),
      Layer.provide(threadRecords),
      Layer.provide(Layer.succeed(RipgrepBinary, ripgrepBinary)),
      Layer.provide(BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))),
      Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
    ),
  );
  const installedHarnesses = installedHarnessesLayer.pipe(
    Layer.provide(
      Layer.succeed(
        UserEnvironment,
        options.userEnvironment ?? makeUserEnvironment({ shell: null, env: process.env, world: null, home: null }),
      ),
    ),
    Layer.provide(BunFileSystem.layer),
    Layer.provideMerge(harnessAdaptersLayer),
  );
  const accountCli =
    options.accountCli === undefined
      ? accountCliLayer.pipe(Layer.provide(Layer.merge(executionsLayerWithDeps, installedHarnesses)))
      : Layer.succeed(AccountCli, options.accountCli);
  const readyProviders = providerLayer.pipe(Layer.provide(accountCli));
  const tagmaAppPlace = Layer.succeed(TagmaAppPlace, {
    home: dataPath,
    server: options.tagmaAppServer ?? null,
  });
  const pluginsHome = dataPath ?? join(tmpdir(), `tagma-plugins-${instanceId.slice(0, 8)}`);
  const pluginsInstallation = marketplaces.lifetimes.installation.pipe(
    Layer.provide(Layer.succeed(MarketplacePlaces, { home: pluginsHome })),
    Layer.provide(Layer.succeed(MarketplacePresets, options.marketplaces ?? [])),
    Layer.provide(Layer.succeed(ListFormats, [claudeCodeList, codexList])),
    Layer.provideMerge(
      plugins.lifetimes.installation.pipe(
        Layer.provide(Layer.succeed(PluginPlaces, { home: pluginsHome })),
        Layer.provide(Layer.succeed(PluginFormats, [claudeCodeFormat, codexFormat, agentPluginsFormat])),
      ),
    ),
    Layer.provide(BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))),
    Layer.provide(BunFileSystem.layer),
  );
  const browsers = closing(
    'browser',
    Layer.merge(cookieSourcesLayer, pageRender.lifetimes.installation).pipe(
      Layer.provideMerge(Layer.merge(managedBrowser.lifetimes.installation, desktopBrowser.lifetimes.installation)),
      Layer.provideMerge(browser.lifetimes.installation.pipe(Layer.provide(executionsLayerWithDeps))),
      Layer.provide(browserBindings({ data: storeDirectory(storePath), runs: browserThreads.port })),
    ),
  );
  const runtime = yield* Scope.provide(
    Effect.acquireRelease(
      Effect.sync(() =>
        ManagedRuntime.make(
          Layer.mergeAll(
            closing('traces and performance', instrumentedTraces),
            threadRecords,
            closing('providers', readyProviders),
            installedHarnesses,
            askProgramsLayer.pipe(Layer.provide(Layer.merge(installedHarnesses, BunFileSystem.layer))),
            closing('sandbox', sandboxInstallation),
            closing('working owners', workingLayerWithUnits),
            closing('terminals floor', agentPaceLayer.pipe(Layer.provideMerge(executionsLayerWithDeps))),
            closing(
              'mcp servers',
              mcp.lifetimes.installation.pipe(
                Layer.provide(Layer.succeed(McpPlaces, mcpPlacesPort.port)),
                Layer.provide(pluginServersLayer),
              ),
            ),
            closing(
              'artifacts',
              artifacts.lifetimes.installation.pipe(
                Layer.provide(
                  Layer.succeed(ShelfPlace, {
                    root: options.artifactsPath ?? join(storeDirectory(storePath), 'artifacts'),
                    origin: artifactOrigin,
                  }),
                ),
                Layer.provide(browsers),
                Layer.provide(BunFileSystem.layer),
              ),
            ),
            closing(
              'native harness',
              nativeHarness.lifetimes.installation.pipe(
                Layer.provide(Layer.succeed(OwnSkillDirectories, (root) => [skillTarget(root), userSkillTarget()])),
                Layer.provide(
                  Layer.succeed(ToolOutputsPlace, options.toolOutputsPath === undefined ? {} : { path: options.toolOutputsPath }),
                ),
                Layer.provide(BunFileSystem.layer),
              ),
            ),
            closing('awake policy', power.lifetimes.installation),
            closing('editors', editors.lifetimes.installation.pipe(Layer.provide(editorBindings))),
            closing(
              'remote access',
              remote.lifetimes.installation.pipe(
                Layer.provide(
                  exposureOf(
                    lazyLayer(
                      () => import('../remote/tailscale/serve.js'),
                      ({ tailscaleExposure }) => tailscaleExposure(sandboxPort),
                    ),
                    options.exposure,
                  ),
                ),
                Layer.provide(
                  Layer.effect(
                    WantedSites,
                    Effect.map(TagmaAppViews, (shown) => ({ names: shown.standing })),
                  ),
                ),
              ),
            ),
            options.sender === undefined
              ? lazyLayer(
                  () => import('../push/webpush/send.js'),
                  ({ webPushSender }) => Layer.succeed(Sender, webPushSender),
                )
              : Layer.succeed(Sender, options.sender),
            closing(
              'speech',
              speech.lifetimes.installation.pipe(
                Layer.provideMerge(
                  speechBindings(speechPlace(options.sourcePath, options.installation, storeDirectory(storePath)), {
                    leaving: options.leaving ?? Effect.succeed(false),
                    opened: options.opened ?? Effect.void,
                  }).pipe(Layer.provide(credentialsLayer)),
                ),
                Layer.provide(Layer.succeed(CallThreads, calls.port)),
                Layer.provide(Layer.succeed(RecordingsPlace, { root: options.recordingsPath ?? join(dirname(storePath), RECORDINGS) })),
                Layer.provide(readyProviders),
                Layer.provide(BunFileSystem.layer),
              ),
            ),
            browsers,
            images.lifetimes.installation.pipe(Layer.provide(readyProviders)),
            closing('registry export', installation.lifetimes.installation),
            closing(
              'enforcement',
              enforcement.lifetimes.installation.pipe(
                Layer.provide(
                  Layer.merge(
                    Layer.succeed(FactCache, {
                      root: dataPath === null ? undefined : join(dataPath, 'enforcement', 'facts'),
                    }),
                    Layer.succeed(InspectionCode, options.installation?.manifest.identity.digest ?? null),
                  ),
                ),
              ),
            ),
            closing('landing', landing.lifetimes.installation),
            closing('external harness sessions', externalHarnesses.lifetimes.installation.pipe(Layer.provide(BunFileSystem.layer))),
          ).pipe(
            Layer.provideMerge(
              closing(
                'activity',
                activity.lifetimes.installation.pipe(
                  Layer.provide(threadRecords),
                  Layer.provide(
                    Layer.succeed(ActivityPlace, {
                      dataPath,
                      migrations: activityMigrations,
                      opened: options.opened ?? Effect.void,
                    }),
                  ),
                ),
              ),
            ),
            Layer.provideMerge(Layer.merge(closing('app views', views.lifetimes.installation), closing('plugins', pluginsInstallation))),
            Layer.provideMerge(
              closing(
                'apps',
                tagmaApps.lifetimes.installation.pipe(
                  Layer.provide(tagmaAppPlace),
                  Layer.provide(BunFileSystem.layer),
                  Layer.provideMerge(
                    closing('secrets', secrets.lifetimes.installation.pipe(Layer.provide(Layer.succeed(SecretsPlace, { home: dataPath })))),
                  ),
                ),
              ),
            ),
            Layer.provideMerge(closing('graph', graphLayerForRuntime)),
            Layer.provideMerge(
              closing('projects', projects.lifetimes.installation.pipe(Layer.provide(Layer.succeed(ReservedNames, reservedNames)))),
            ),
            Layer.provideMerge(foundation.lifetimes.installation),
            Layer.provideMerge(Layer.sync(Capacity, () => serverCapacity(POOLS(thisMachine())))),
            Layer.provideMerge(
              closing(
                'file watcher',
                fileWatcherLayer(
                  {
                    dir: dataPath ?? join(tmpdir(), `tagma-watch-${instanceId.slice(0, 8)}`),
                    lifetime: options.watchLifetime ?? 'with-client',
                  },
                  options.leaving ?? Effect.succeed(false),
                ),
              ),
            ),
            Layer.provideMerge(closing('machine store', machineStoreLayer(storePath, migrations, processes))),
            Layer.provideMerge(Layer.succeedContext(bindings)),
            Layer.provideMerge(Layer.effect(Doctrine, doctrine)),
            Layer.provideMerge(Layer.succeed(InstalledChannel, CHANNEL)),
            Layer.provideMerge(Layer.succeed(ThreadEntryKinds, ENTRY_KINDS)),
            Layer.provideMerge(Layer.succeed(DeclaredNativeRules, NATIVE_AGENT_RULES)),

            Layer.provideMerge(approvalModesLayer),
            Layer.provideMerge(Layer.succeed(Handover, options.leaving ?? Effect.succeed(false))),
            Layer.provideMerge(Layer.succeed(Drives, driving.drives)),
            Layer.provide(childLedgerLayer(options.hostSourcePath, carriedBundle)),
            Layer.provide(Layer.succeedContext(prepared)),
            Layer.provideMerge(observations),
          ),
        ),
      ),
      (runtime) => runtime.disposeEffect,
    ),
    baseScope,
  );
  const built = yield* runtime.contextEffect;
  const store = Context.get(built, MachineStore);
  const sourceCache = Context.get(built, WorkspaceInputs);
  const machineGraph = machineGraphOf(built);
  const workingOwners: Context.Context<WorkspaceServices | WorktreeRecords | WorktreeIntents | ThreadLineage> = built;
  const status: RuntimeStatus = {
    artifactOrigin,
    sandboxOrigin,
    version: PROGRAM_RELEASE,
    database: store.path,
    schema: store.schema,
    source: {
      cut: options.source ?? null,
      installation:
        options.installation === undefined
          ? null
          : {
              build: options.installation.manifest.identity.build,
              digest: options.installation.manifest.identity.digest,
            },
    },
  };
  const standingModels = Context.get(built, ModelAccess);
  const credentials = Context.get(built, AccountCredentials);
  const models = options.models === undefined ? standingModels : options.models(standingModels);
  const accountQuota = Context.get(built, AccountQuota);
  const { tokens, keys: consoleKeys } = Context.get(built, ProviderCredentials);
  const awake = Context.get(built, AwakePolicy);
  const shelf = Context.get(built, ArtifactStore);
  const owner = crypto.randomUUID();
  const servingInputs = Context.mergeAll(
    built,
    machineGraph,
    Context.make(GraphSource, {
      sourcePath: options.sourcePath,
      originPath,
      source: reader,
    }),
    Context.make(GraphMigrations, graphMigrations),
    options.commitGate === undefined ? Context.empty() : Context.make(CommitGateCli, options.commitGate),
    Context.make(ThreadFilesPlace, {
      attachments: options.attachmentsPath,
      scratch: options.scratchPath,
    }),
    Context.make(ModelAccess, models),
    Context.make(MachineWorld, { world: machine }),
    Context.make(WorktreeHome, { path: join(installationAnchor(store.path), WORKTREE_HOME) }),
    Context.make(HarnessOwner, { id: owner, build: options.installation?.manifest.identity.digest ?? owner }),
    Context.make(ViewSites, options.sites ?? (yield* Scope.provide(makeLocalSites(sandboxPort), stackScope))),
    Context.make(LaneEndpoint, localEndpoint),
    Context.make(McpSignInDoor, localSignInDoor(options.localOrigin)),
  );
  const stack = yield* Scope.provide(
    Layer.build(serving.pipe(Layer.provide(Layer.merge(Layer.succeedContext(servingInputs), BunFileSystem.layer)))),
    stackScope,
  ).pipe(Effect.updateContext((context: Context.Context<never>) => Context.omit(Tracer.ParentSpan)(context)));
  const owners = Context.merge(servingInputs, stack);
  const scratch = Context.get(owners, ScratchAreas);
  const judging = owners;
  const pool = Context.get(owners, ServingPool);
  yield* Scope.addFinalizer(poolScope, pool.dispose());
  const preparedShared = { admission: Context.get(owners, CarrierAdmission), changes: Context.get(owners, PreparedChanges) };
  yield* admitAssembled(Context.mergeAll(built, owners));
  yield* driving.start;
  const markHeld = Context.get(owners, ThreadList).markHeld;
  const unheld = [
    Context.get(owners, Holdings).changed((change) =>
      Effect.forEach(
        change.holders,
        (key) => {
          const holder = holderAt(key);
          return holder.kind === 'thread' ? markHeld(holder.thread) : Effect.void;
        },
        { discard: true },
      ),
    ),
  ];
  yield* Scope.addFinalizer(
    stackScope,
    Effect.sync(() => unheld.forEach((leave) => leave())),
  );
  yield* Scope.provide(
    browserThreads.bind({ running: Context.get(owners, ThreadRunning), records: Context.get(built, ThreadRecords) }),
    stackScope,
  );
  yield* Scope.provide(
    mcpPlacesPort.bind({ coverage: Context.get(owners, Coverage), bases: [scratch.root, options.attachmentsPath] }),
    stackScope,
  );
  yield* Scope.provide(
    calls.bind({
      turns: Context.get(owners, ThreadTurns),
      attachments: Context.get(owners, Attachments),
      records: Context.get(built, ThreadRecords),
    }),
    stackScope,
  );
  const resolution = sessionResolution(store, Context.get(built, Terminals), Context.get(built, ThreadRecords));
  const steps = Context.make(ConsoleKeyRollback, consoleKeyRollback(dirname(options.tokensPath), processes)).pipe(
    Context.add(DowngradeSteps, Context.get(owners, CommitQueue)),
  );
  const door: Context.Context<RuntimeDoor> = Context.mergeAll(
    owners,
    judging,
    steps,
    Context.make(ServedGraphs, pool),
    Context.make(SessionResolution, resolution),
    Context.make(MachineAgents, { working: Context.get(owners, ThreadRunning).working }),
    Context.make(MachineCalls, { live: Context.get(owners, Listenings).live }),
  );
  return {
    runtime,
    door,
    graph: machineGraph,
    enforcement: judging,
    liveGroup: LiveRpc,
    pool,
    tokens,
    consoleKeys,
    models,
    credentials,
    accountQuota,
    signIns: Context.get(built, SignIns),
    owners,
    scratch,
    resolution,
    grants: options.grants,
    sourceCache,
    prepared: preparedShared,
    machineWorld: machine,
    workspace: workingOwners,
    executions: built,
    awake,
    pace: Context.get(built, AgentPace),
    closeStack: Scope.close(stackScope, Exit.void),
    openMaintenance: Effect.gen(function* () {
      yield* Context.get(bindings, StoreSnapshots).ready.pipe(Effect.orDie);
      yield* Deferred.succeed(maintenance, undefined);
      const recoveryOwners: Context.Context<any> = owners;
      yield* Scope.provide(Layer.build(AFTER_RECOVERY.pipe(Layer.provide(Layer.succeedContext(recoveryOwners)))), stackScope).pipe(
        Effect.orDie,
      );
    }),
    measurement: Context.make(PerformanceReports, Context.get(built, PerformanceReports)).pipe(
      Context.add(CpuProfiles, Context.get(built, CpuProfiles)),
      Context.add(MemoryCaptures, Context.get(built, MemoryCaptures)),
      Context.add(HeapSnapshots, Context.get(built, HeapSnapshots)),
    ),
    mcp: Context.get(built, McpServers),
    tagmaApps: Context.get(built, TagmaApps),
    views: Context.get(built, TagmaAppViews),
    artifacts: shelf,
    status,
    bindings,
    steps,
  };
});
