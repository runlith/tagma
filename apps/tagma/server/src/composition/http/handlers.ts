import { Context, Effect, Layer } from 'effect';
import { ApprovalSeats } from '../../invocation/contract/service/approvalSeats.js';
import { ThreadHarness } from '../../threads/contract/service/engine.js';
import { approvalAsks } from './approvals.js';
import { HarnessPermissions } from '../../external-harnesses/contract/service/permissions.js';
import type { Api } from '../../http/contract/wire/Api.js';
import { AccountQuota } from '../../providers/contract/service/quota.js';
import { SignIns } from '../../providers/contract/service/signIns.js';
import { MachineStore, type GraphStore } from '../../platform/contract/service/store.js';
import type { GraphUnits, MachineUnits } from '../../platform/contract/service/units.js';
import type { GraphServices } from '../../graph/contract/service/services.js';
import type { TargetSnapshots } from '../../threads/contract/service/targetSnapshots.js';
import type { TargetPreparation } from '../../threads/contract/service/preparation.js';
import type { ThreadLookup } from '../../threads/contract/service/reads.js';
import type { Worlds } from '../../executions/contract/service/worlds.js';
import { SandboxFiles } from '../../sandbox/contract/service/files.js';
import { RunAdmission } from '@runlith/agent/thread/run/runAdmission';
import type { CacheWarmth } from '../../threads/contract/service/evidence.js';
import type { WorkspaceInputs } from '../../native-harness/contract/service/inputs.js';
import type { RuntimeStatus } from './status.js';
import type { NextInstallation } from '../../installation/contract/service/next.js';
import { type ServerProcess, Succession } from '../../installation/contract/service/succession.js';
import type { RestartRecords } from '../../installation/contract/service/restarts.js';
import type { InstalledChannel } from '../../installation/contract/service/channel.js';
import type { ConsoleKeyRollback, DowngradeSteps } from '../../installation/contract/service/steps.js';
import type { ArtifactStore } from '../../artifacts/contract/service/shelf.js';
import { ServedGraphs } from '../../graph/contract/service/serving.js';
import type { JudgingServices } from '../../enforcement/serving.js';
import type { OperationChecks } from '../../invocation/contract/service/operationChecks.js';
import { threadsHandler } from './threads.js';
import { speechHandler } from './speech.js';
import type { Listenings } from '../../speech/contract/service/listenings.js';
import type { Attachments } from '../../threads/contract/service/attachments.js';
import type { ScratchAreas } from '../../threads/contract/service/scratch.js';
import type { SessionResolution } from '../../external-harnesses/contract/service/sessionResolution.js';
import type { GrantSigner } from '../../platform/contract/service/grantSigner.js';
import { healthHandler } from './health.js';
import type { McpServers } from '../../mcp/contract/service/servers.js';
import type { McpSignInDoor } from '../../mcp/contract/service/door.js';
import { operationsHandler } from './operations.js';
import type { OwnerContext } from '../../invocation/contract/service/performer.js';
import type { SocketDoor, RuntimeSocketDoor } from '../socketBinding.js';
import type { ThreadStanding } from '../../invocation/contract/service/admission.js';
import { type HttpPerformById, httpPerformingById } from './binding.js';
import { checkoutsHandler } from './checkouts.js';
import type { ExecutionServices } from '../../executions/assembly.js';
import { HeldFeed } from '../../change-record/contract/service/held.js';
import type { WorkspaceServices } from '../../workspace/layer.js';
import { OtherGraphs } from '../../graph/serving/policy.js';
import { WorkingOrigins } from '../../workspace/contract/service/places.js';
import { ActingRun } from '../../executions/contract/service/grants.js';
import { WorldFiles } from '../../executions/contract/service/worlds.js';
import { CheckoutPlaces, type GraphDirectory } from '../../workspace/contract/service/checkouts.js';
import { callPorts } from '../callPorts.js';
import { FileRoots } from '../../workspace/contract/service/roots.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { ChangeRecord } from '../../change-record/contract/service/record.js';
import { Git } from '@runlith/git/Git';
import type { CarrierAdmission } from '../../change-record/contract/service/carriers.js';
import type { PreparedChanges } from '../../change-record/contract/service/prepared.js';
import { Settings } from '../../settings/contract/service/values.js';
import { OperationCatalog } from '../../invocation/contract/service/catalog.js';
import { routedContext, routedSeams } from '../../graph/serving/routing.js';
import { landing } from '../../landing/landing.js';
import { ServingGit } from '../../executions/contract/service/git.js';
import { invocationAssembly } from '../../invocation/assembly.js';
import { callOwnersOf } from '../callOwners.js';
import { OwedCalls } from '../../threads/contract/service/owedCalls.js';
import type { Access } from '../../remote/contract/service/access.js';
import type { PlacedSites, TerminalSite } from '../../remote/contract/service/sites.js';
import type { LaneEndpoint } from '../../executions/contract/service/views.js';
import type { Devices } from '../../remote/contract/service/devices.js';
import type { Subscriptions } from '../../push/contract/service/subscriptions.js';

type ApiGroupName = keyof typeof Api.groups;

export type HandlerOwners =
  | Attachments
  | CacheWarmth
  | ChangeRecord
  | CheckoutPlaces
  | HeldFeed
  | SandboxFiles
  | RunAdmission
  | TargetSnapshots
  | TargetPreparation
  | Worlds
  | ThreadLookup
  | OwedCalls
  | Listenings;

export type DoorLifetime = GraphDirectory | OperationCatalog;

export type RuntimeDoor =
  | HandlerOwners
  | DoorLifetime
  | InstalledChannel
  | GraphServices
  | GraphStore
  | GraphUnits
  | MachineStore
  | MachineUnits
  | Git
  | WorkspaceServices
  | ExecutionServices
  | JudgingServices
  | OperationChecks
  | ConsoleKeyRollback
  | DowngradeSteps
  | ServedGraphs
  | McpServers
  | McpSignInDoor
  | AccountQuota
  | SignIns
  | ArtifactStore
  | WorkspaceInputs
  | CarrierAdmission
  | PreparedChanges
  | ScratchAreas
  | SessionResolution
  | GrantSigner
  | HarnessPermissions
  | ThreadHarness
  | Access
  | PlacedSites
  | TerminalSite
  | LaneEndpoint
  | Devices
  | Subscriptions
  | RuntimeSocketDoor;

export type DoorServices = RuntimeDoor | SocketDoor | Succession | NextInstallation | ServerProcess | RestartRecords;

type GroupHandler = Layer.Layer<never, unknown, unknown>;

export type HandlerComposition = {
  readonly origins: WorkingOrigins['Service'];
  readonly operationOwnerContext: OwnerContext<DoorOwners, ThreadStanding | null>;
  readonly performById: HttpPerformById;
  readonly catalog: OperationCatalog['Service'];
};

export class DoorComposition extends Context.Service<DoorComposition, HandlerComposition>()('tagma/composition/DoorComposition') {}

export type DoorOwners = ReturnType<typeof ownerBase> extends Context.Context<infer Services> ? Services : never;

const ownerBase = (door: Context.Context<DoorServices>) => {
  const pool = Context.get(door, ServedGraphs);
  return Context.merge(routedContext(door, pool), door).pipe(
    Context.add(OtherGraphs, (projectId: number) =>
      Effect.gen(function* () {
        const served = yield* pool.resolve({ projectId });
        yield* served.fresh();
        return served.context;
      }),
    ),
    Context.add(ApprovalSeats, { ask: approvalAsks(Context.get(door, ThreadHarness).runs.questions()) }),
    Context.add(ActingRun, { runId: null }),
    Context.add(WorldFiles, { files: BunFileSystem.layer }),
    Context.merge(callPorts(door)),
    Context.merge(landing.lifetimes.call({ servingGit: Context.get(door, ServingGit).run })),
    Context.merge(routedSeams(door, pool)),
  );
};

const httpOperationComposition = (door: Context.Context<DoorServices>): HandlerComposition => {
  const base = ownerBase(door);
  const callOwners = callOwnersOf({
    machine: Context.get(door, MachineStore),
    changes: Context.get(door, ChangeRecord),
    files: Context.get(door, SandboxFiles),
    admission: Context.get(door, RunAdmission),
    git: Context.get(base, Git),
    settings: Context.get(base, Settings),
    paths: Context.get(door, CheckoutPaths),
    servingGit: Context.get(door, ServingGit),
  });
  const operationOwnerContext: OwnerContext<DoorOwners, ThreadStanding | null> = (caller, place, standing) =>
    Effect.map(callOwners(caller, place, standing), (call) => Context.merge(base, call));
  return {
    origins: Context.get(door, WorkingOrigins),
    operationOwnerContext,
    performById: httpPerformingById(invocationAssembly.performer, operationOwnerContext),
    catalog: Context.get(door, OperationCatalog),
  };
};

export const doorCompositionLayer = Layer.effect(DoorComposition, Effect.map(Effect.context<DoorServices>(), httpOperationComposition));

export const handlers = (status: RuntimeStatus) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const door = yield* Effect.context<DoorServices>();
      const { performById, catalog } = yield* DoorComposition;
      const groups = {
        health: healthHandler(status, Context.get(door, Succession), Context.get(door, MachineStore)),
        operations: operationsHandler(performById, catalog, invocationAssembly.detaching(Context.get(door, OwedCalls))),
        threads: threadsHandler(),
        speech: speechHandler(),
        checkouts: checkoutsHandler(Context.get(door, CheckoutPlaces), {
          roots: Context.get(door, FileRoots),
          git: Context.get(door, Git),
        }),
      } satisfies Record<ApiGroupName, GroupHandler>;
      return Layer.mergeAll(...(Object.values(groups) as [(typeof groups)[ApiGroupName], ...(typeof groups)[ApiGroupName][]]));
    }),
  );
