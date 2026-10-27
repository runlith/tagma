import type { ThreadContextUse, ThreadView } from '@runlith/agent/thread/agents/ThreadAgent';
import type { HoldStalled, ReentrantCall } from '@runlith/held/failures';
import type { CommentPolicy } from '@runlith/source-comments';
import { posix, win32 } from 'node:path';
import { Context, Effect } from 'effect';
import type { ArtifactStore } from '../../artifacts/contract/service/shelf.js';
import { GraphStore, MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import type { GrantSigner } from '../../platform/contract/service/grantSigner.js';
import { type SessionIdentity, type SessionRef, NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import type { CommandTimes } from '@runlith/agent-tools/CommandWork';
import { commandTimes } from '../../executions/commands/times.js';
import { governingProject } from '../../workspace/governing.js';
import type { TargetPreparation } from '../../threads/contract/service/preparation.js';
import type { GraphServices } from '../../graph/contract/service/services.js';
import { CurrentGraph, RefusedGraph, type ServedGraph } from '../../graph/contract/service/serving.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Settings } from '../../settings/contract/service/values.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import { Projects } from '../../projects/contract/service/registry.js';
import type { McpServers } from '../../mcp/contract/service/servers.js';
import type { PluginTools, ProjectTools } from '../../plugins/contract/service/tools.js';
import type { ProjectRef } from '../../projects/contract/wire/project.js';
import type { CheckoutMode, CommandDescription } from '@runlith/agent-tools/workspace';
import type { CommandDescriptions } from './commandDescriptions.js';
import { commandDescription } from '../contract/wire/settings.js';
import { autoCommit, checkoutMode, commentPolicy } from '../../graph/settings.js';
import type { TagTable } from '../../graph/contract/wire/tags/table.js';
import type { WorkingOrigin } from '../../workspace/contract/wire/place.js';
import type { ScratchAreas } from '../../threads/contract/service/scratch.js';
import type { CapabilitySettings, CapabilityUnavailable } from '../capabilities/contract.js';
import type { NativeThreadRows } from '../rows/native.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { McpBoundTools } from '../tools/mcpRule.js';
import type { ServingGit } from '../../executions/contract/service/git.js';
import type { Worlds } from '../../executions/contract/service/worlds.js';
import type { ChangeRecord } from '../../change-record/contract/service/record.js';
import type { WebSearch } from '../contract/service/webSearch.js';
import type { WorkspaceInputs, WorkspaceInputSet } from '../contract/service/inputs.js';
import { atOf, originOf, type GraphOrigin, type TargetSnapshot } from '../../threads/contract/wire/target.js';
import { rootOfSourceKey } from '../../threads/contract/wire/target.js';
import type { SetupReadings, SetupRecord } from '../contract/service/setups.js';
import { WAITING_REASONS } from '../../threads/contract/wire/waiting.js';
import type { FailedSetup } from './worldState.js';
import type { ThreadWorld, WorldUnavailable } from '../../executions/contract/service/worlds.js';
import { CheckoutFlights } from '@runlith/agent-tools/CheckoutFlights';
import type { ChangeSource } from '@runlith/agent-tools/changeSource';
import type { CapabilityOffers, ThreadExecution } from '../contract/service/execution.js';
import type { TurnFacts } from './facts.js';
import type { ModelRequester } from '@runlith/agent/modelPort';
import { type RunWebs, type ThreadWeb, threadWeb } from './runWebs.js';
import type { WorkPlaces } from '../../threads/contract/service/working.js';
import type { ImageChoice } from '../../images/contract/service/choice.js';
import { informedPlaces } from './instructions.js';

export type ThreadContext = {
  readonly caller: Caller;
  readonly project: ProjectRef;
  readonly graph: Effect.Effect<Context.Context<GraphServices | GraphStore>, GateRefusal>;
  readonly graphRoot?: string;
  readonly graphRefused?: GateRefusal;
  readonly projectId: number;
  readonly machine: Context.Service.Shape<typeof MachineStore>;
  readonly units: MachineUnits['Service'];
  readonly session: SessionRef;
  readonly ownerId: string;
  readonly workingRoot: string;
  readonly origin: WorkingOrigin | null;
  readonly comments: () => CommentPolicy;
  readonly facts: Readonly<Record<string, boolean>>;
  readonly vocabulary: () => TagTable;
  readonly mcpServers: Context.Service.Shape<typeof McpServers>;
  readonly servingGit: ServingGit['Service'];
  readonly thread: ThreadView;
  readonly runId?: string | null;
  readonly world: ThreadWorld;
  readonly target: TargetSnapshot;
  readonly changeRecord: ChangeRecord['Service'];
  readonly settings: Context.Service.Shape<typeof Settings>;
  readonly projectRoot: string;
  readonly sources: WorkspaceInputSet;
  readonly artifacts: ArtifactStore['Service'];
  readonly checkout: CheckoutMode;
  readonly autoCommit: boolean;
  readonly commandTimes: CommandTimes;
  readonly commandDescription: CommandDescription;
  readonly mcp: () => ReturnType<McpServers['Service']['palette']>;
  readonly mcpBound: McpBoundTools;
  readonly plugins: ProjectTools;
  readonly webSearch: Context.Service.Shape<typeof WebSearch>;
  readonly web: ThreadWeb;
  readonly images: boolean;
  readonly checkoutFlights: CheckoutFlights;
  readonly unavailableCapabilities: readonly CapabilityUnavailable[];
  readonly capabilitySettings?: CapabilitySettings;
  readonly worktreeSetup?: FailedSetup | null;
  readonly identity: SessionIdentity['Service'];
  readonly grants: GrantSigner['Service'];
  readonly execution: ThreadExecution['Service'];
  readonly offers: CapabilityOffers['Service'];
  readonly places: WorkPlaces['Service'];
};

export type ThreadContextFailure = StoreFailure | GateRefusal | WorldUnavailable | HoldStalled | ReentrantCall;

const failedSetupOf = (record: SetupRecord | null): FailedSetup | null => {
  if (record === null || record.setup !== 'failed') return null;
  const detail = record.setupDetail;
  const execution = detail?.execution ?? null;
  return {
    worktree: record.name,
    step: detail?.step ?? 'setup',
    reason: detail?.reason ?? 'It left no reason.',
    execution: execution === null ? null : { execution: execution.execution, incarnation: execution.incarnation },
  };
};

export function threadContext(
  threads: NativeThreadRows,
  records: ThreadRecords['Service'],
  worlds: Worlds['Service'],
  targets: TargetPreparation['Service'],
  changeRecord: ChangeRecord['Service'],
  servingGit: ServingGit['Service'],
  settings: Context.Service.Shape<typeof Settings>,
  sourceCache: WorkspaceInputs['Service'],
  scratch: ScratchAreas['Service'],
  artifacts: ArtifactStore['Service'],
  mcp: Context.Service.Shape<typeof McpServers>,
  mcpBound: McpBoundTools,
  plugins: PluginTools['Service'],
  webSearch: Context.Service.Shape<typeof WebSearch>,
  models: ModelRequester,
  webs: RunWebs,
  images: ImageChoice['Service'],
  descriptions: CommandDescriptions,
  graph: Context.Context<GraphServices | GraphStore | MachineStore>,
  graphAt: (origin: GraphOrigin) => Effect.Effect<ServedGraph, GateRefusal>,
  units: MachineUnits['Service'],
  identity: SessionIdentity['Service'],
  execution: ThreadExecution['Service'],
  offers: CapabilityOffers['Service'],
  grants: GrantSigner['Service'],
  places: WorkPlaces['Service'],
  setups?: SetupReadings['Service'],
  turnFacts?: TurnFacts,
  changeSource: ChangeSource | null = null,
): (thread: ThreadView, use: ThreadContextUse) => Effect.Effect<ThreadContext, ThreadContextFailure> {
  const checkoutFlights = new CheckoutFlights(changeSource);
  return Effect.fn('native-harness.threadContext')(
    function* (thread, use) {
      const recorded = yield* records.projectOf(thread.id);
      if (recorded === undefined) {
        return yield* new GateRefusal('thread-project-missing', 'The agent requires a thread bound to a project.', [
          'Open the thread through the project thread door.',
        ]);
      }
      const projects = yield* Projects;
      const home = yield* projects.byId(recorded);
      yield* scratch.ensure(thread.id);
      const { target, world } = yield* targets.of({ id: thread.id, projectId: recorded, root: home.rootPath }, use, (request) =>
        worlds.of({ thread, ...request }),
      );
      const projectId = target.work.projectId;
      const project = projectId === recorded ? home : yield* projects.byId(projectId);
      const checkout = yield* settings.value(checkoutMode, projectId);
      const commitsOwnWork = yield* settings.value(autoCommit, projectId);
      const web = yield* webs.of(
        use,
        { provider: thread.provider, model: thread.model },
        threadWeb(threads, settings, models, webs.memory, thread, projectId, use.runId),
      );
      const description = yield* descriptions.of(use, settings.value(commandDescription, projectId));
      const drawing = yield* images.of(projectId);
      const comments = yield* settings.held(commentPolicy, projectId);
      const facts =
        turnFacts === undefined ? {} : yield* turnFacts({ projectId, root: world.facts.shared ? world.root : project.rootPath });
      const placedIn = rootOfSourceKey(target.sourceKey);
      const waitingOn = use.kind === 'tools' ? undefined : use.waitingOn;
      const seen =
        placedIn === null || setups === undefined || (use.kind !== 'tools' && waitingOn === undefined)
          ? null
          : yield* setups.reading(placedIn);
      const waited = <A, E, R>(reason: string, work: Effect.Effect<A, E, R>) =>
        waitingOn === undefined ? work : waitingOn({ reason, place: seen?.name ?? null }, work);
      const opened = yield* Effect.result(waited(WAITING_REASONS.graph, graphAt(target.graph)));
      const turnGraph: Context.Context<GraphServices | GraphStore> = opened._tag === 'Success' ? opened.success.context : graph;
      const vocabulary = yield* Context.get(turnGraph, Tags).reader(projectId);
      const worktreeSetup =
        placedIn === null || setups === undefined
          ? null
          : failedSetupOf(use.kind === 'tools' ? seen : yield* waited(WAITING_REASONS.setup, setups.ready(placedIn)));
      const origin = originOf(target);
      const sourceRoot = world.facts.shared ? target.workingRoot : project.rootPath;
      const sources = yield* sourceCache.resolve({ threadId: thread.id, projectId, root: sourceRoot }, use, atOf(target));
      const pluginTools = yield* plugins.of(projectId);
      const session: SessionRef = { harness: NATIVE_HARNESS, key: thread.id };
      const governing = governingProject(world.facts.shared ? (at) => places.resource(at) : null, projectId);
      return {
        thread,
        runId: use.runId,
        world,
        target,
        workingRoot: world.root,
        origin,
        caller: {
          actor: {
            kind: 'thread' as const,
            threadId: thread.id,
            projectId,
            principalId: thread.ownerId,
            session,
          },
          files: {
            path: world.scratch,
            resolve: (candidate) => (world.world.environment.platform === 'win32' ? win32 : posix).resolve(world.scratch, candidate),
          },
        } satisfies Caller,
        project: { id: project.id, name: project.name },
        settings,
        projectId,
        projectRoot: project.rootPath,
        sources,
        checkout,
        autoCommit: commitsOwnWork,
        commandTimes: commandTimes(Context.get(graph, MachineStore), projectId, governing),
        commandDescription: description,
        comments,
        facts,
        vocabulary,
        artifacts,
        mcpServers: mcp,
        changeRecord,
        servingGit,
        mcp: () => mcp.palette(projectId),
        mcpBound,
        plugins: pluginTools,
        unavailableCapabilities: [],
        worktreeSetup,
        webSearch,
        web,
        images: drawing._tag === 'Chosen',
        checkoutFlights,
        graph:
          opened._tag === 'Failure'
            ? Effect.succeed(Context.add(turnGraph, RefusedGraph, opened.failure))
            : Effect.map(graphAt(target.graph), (served) => Context.add(served.context, CurrentGraph, served)),
        ...(opened._tag === 'Success' ? { graphRoot: opened.success.checkout } : { graphRefused: opened.failure }),
        machine: Context.get(graph, MachineStore),
        units,
        session,
        ownerId: thread.ownerId,
        identity,
        grants,
        execution,
        offers,
        places: informedPlaces(places, threads),
      };
    },
    (effect, thread, use) => effect.pipe(Effect.provide(graph)),
  );
}
