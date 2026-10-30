import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Cause, Context, Effect, FileSystem, Layer, type Scope, Stream } from 'effect';
import { CalibrationProfiles } from './contract/service/calibration.js';
import { NativeResourceKinds, NativeRolloutPart, ThreadMetadataSource } from '../threads/contract/service/parts.js';
import { calibrationProfiles } from './compaction/calibration.js';
import { evidenceReads } from './evidence/retained.js';
import { evidenceReadsKind } from './resources/evidenceReads.js';
import { toolOutputsKind } from './resources/toolOutputs.js';
import { nativeRolloutPart } from './rollout.js';
import { makeThreadMetadata } from './rows/threadUnits.js';
import { toolOutputStore } from './tools/outputStore.js';
import { makeBaseReach } from '../threads/journal/base.js';
import type { AgentCalls } from '@runlith/agent/AgentCalls';
import type { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import type { ThreadCompaction } from '@runlith/agent/thread/compaction/ThreadCompaction';
import type { ThreadLiveFeed } from '@runlith/agent/thread/run/ThreadLiveFeed';
import { ActivityRecord } from '@runlith/activity/store/record';
import { dataPathOf, GraphStore, MachineStore, type StoreDb } from '../platform/contract/service/store.js';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import { NATIVE_HARNESS, type HarnessId, SessionIdentity } from '../platform/contract/wire/session.js';
import { type Unit, MachineUnits } from '../platform/contract/service/units.js';
import { WorkPlaces } from '../threads/contract/service/working.js';
import { ArtifactStore } from '../artifacts/contract/service/shelf.js';
import type { GraphServices } from '../graph/contract/service/services.js';
import { Projects } from '../projects/contract/service/registry.js';
import { Settings } from '../settings/contract/service/values.js';
import { AccountCredentials, ModelAccess } from '../providers/contract/service/access.js';
import { AccountQuota } from '../providers/contract/service/quota.js';
import { DefaultAccounts, ProviderAccounts } from '../providers/contract/service/accounts.js';
import { ProviderRegistry } from '../providers/contract/service/registry.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import type { HarnessFailure } from '../threads/contract/service/failure.js';
import { CacheWarmth, EvidenceFeed, EvidenceQueries, ThreadEvidence, EvidenceReads } from '../threads/contract/service/evidence.js';
import { OwnWork } from '../threads/contract/service/ownWork.js';
import { EndingRedelivery } from '../threads/contract/service/redelivery.js';
import { gatedByProject } from '../threads/birth/projectGate.js';
import { AgentLibrary } from '../threads/contract/service/library.js';
import { TargetPreparation } from '../threads/contract/service/preparation.js';
import { TargetSnapshots } from '../threads/contract/service/targetSnapshots.js';
import { threadCopies } from './evidence/copies.js';
import type { DeclaredAgents } from '../threads/library/declared.js';
import { ThreadLookup, ThreadRunning, ThreadWindows } from '../threads/contract/service/reads.js';
import { ThreadList } from '../threads/contract/service/list.js';
import { OwedCalls } from '../threads/contract/service/owedCalls.js';
import { ThreadRollouts } from '../threads/contract/service/rollouts.js';
import { RestedRollouts } from '../threads/contract/service/rested.js';
import type { NativeThreadState } from '../threads/contract/service/state.js';
import { STALL_SWEEP_INTERVAL_MS } from '../threads/contract/wire/rhythm.js';
import { drive } from '../platform/contract/service/drives.js';
import { agentLibrary } from './agents/library.js';
import type { AgentDeclaration } from './agents/declaration.js';
import { SCOPED_RUN } from './row.js';
import { callActivity } from './calls/activity.js';
import { compactionChoices } from './compaction/choice.js';
import { CallActivity } from './contract/service/calls.js';
import { CompactionChoices } from './contract/service/compaction.js';
import { AgentSkills, NativeAgentDefinitions } from './contract/service/agents.js';
import { Compaction, ThreadInstructions } from './contract/service/context.js';
import { WorkspaceInputs } from './contract/service/inputs.js';
import { ModelPreferences } from './contract/service/models.js';
import { nativeCompaction, nativeInstructions } from './context/actions.js';
import { threadEvidence } from './evidence/threadEvidence.js';
import { makeKeepWarm, keepWarmSettingChanges, keepWarmSettings, keepWarmSpending, keepWarmWarmth } from './keepWarm/driver.js';
import { makeEntryBounding } from './maintenance/bounding.js';
import { makeEventStripping } from './maintenance/stripping.js';
import { makeFootprintFolding } from './maintenance/footprintFolding.js';
import { makeTransitionRetirement } from './maintenance/transitions.js';
import { makeModelPreferences, publishDefaultMoves } from './models/preference.js';
import { carryDefaultMoves } from './models/defaultMoves.js';
import { publishLimitMoves } from './compaction/limits.js';
import type { ContextLimits } from '../threads/contract/service/limits.js';
import { SettingChanges } from '../settings/contract/service/changes.js';
import { observeStepQuota } from './models/quota.js';
import { makeCallDelivery } from './calls/delivery.js';
import { clearExternalLeftovers } from './externalLeftovers.js';
import { nativeHarness } from './threadsPort.js';
import { makeTargetSnapshots } from './rows/targetSnapshots.js';
import { workflows } from './workflows/library.js';
import { Workflows } from './contract/service/workflows.js';
import type { Harness } from '../threads/contract/service/harness.js';
import { makeRunStores } from './runs/ledger.js';
import { NativeKernel } from './kernel.js';
import { ThreadEntryKinds, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { ThreadTitles } from '../threads/contract/service/titles.js';
import { HarnessToolOutputs, ThreadHarness, ThreadLive } from '../threads/contract/service/engine.js';
import { HarnessMoves, HarnessRegistry, SessionRead } from '../threads/contract/service/harness.js';
import { Maintenance, scheduleSweeps } from '../platform/contract/service/maintenance.js';
import { StoreSnapshots } from '../platform/contract/service/snapshots.js';
import { ToolOutputs, ToolOutputsPlace } from './contract/service/toolOutputs.js';
import { stallSighting } from './runs/stalls.js';
import { ThreadGraphs } from './contract/service/graphs.js';
import { CapabilityOffers, ThreadExecution } from './contract/service/execution.js';
import { MachineWorld, Worlds } from '../executions/contract/service/worlds.js';
import { ServingGit } from '../executions/contract/service/git.js';
import { DoctrineFacts } from '../platform/contract/service/facts.js';
import { ImageChoice } from '../images/contract/service/choice.js';
import { Doctrine } from '../platform/contract/service/sections.js';
import { GrantSigner } from '../platform/contract/service/grantSigner.js';
import { ChangeRecord } from '../change-record/contract/service/record.js';
import { McpServers } from '../mcp/contract/service/servers.js';
import { TagmaAppTools } from '../tagma-apps/contract/service/tools.js';
import { ScratchAreas } from '../threads/contract/service/scratch.js';
import { ThreadMandate } from '../threads/contract/service/mandate.js';
import { ThreadTeams } from '../threads/contract/service/team.js';
import { AgentRules } from '../threads/contract/service/rules.js';
import { makePluginHooks } from './turns/pluginHooks.js';
import { atOf } from '../threads/contract/wire/target.js';
import { WebSearch } from './contract/service/webSearch.js';
import { SetupReadings } from './contract/service/setups.js';
import { composeAgent } from './agents/composeAgent.js';
import { AgentRuleRegistry } from '@runlith/agent/AgentRuntimePolicy';
import { DeclaredNativeRules, type RuleSetup } from './contract/service/rules.js';
import { startCards } from './agents/startCard.js';
import { StartCosts } from '../platform/contract/service/start.js';
import { capabilitySources } from './agents/capabilitySources.js';
import { threadContext, type ThreadContext } from './turns/context.js';
import { watchedChanges } from '../platform/watch/changeSource.js';
import { FileWatcher } from '../platform/contract/service/watch.js';
import { turnFacts } from './turns/facts.js';

export type StandingSweep = (moment: string) => Effect.Effect<void>;

export const nativeSweeps = Effect.gen(function* () {
  const sweep =
    (pass: () => Effect.Effect<unknown, unknown>, what: string): StandingSweep =>
    (moment) =>
      pass().pipe(
        Effect.asVoid,
        Effect.catchCause((cause) => Effect.logWarning(`${what} (${moment})`, { reason: Cause.squash(cause) })),
      );
  const bounding = yield* makeEntryBounding;
  const stripping = yield* makeEventStripping;
  const folding = yield* makeFootprintFolding;
  const retirement = yield* makeTransitionRetirement;
  return [
    sweep(() => bounding.pass(), 'standing entry rows could not be bounded'),
    sweep(() => stripping.pass(), 'standing tool facts could not be folded'),
    sweep(() => folding.pass(), 'standing measurement footprints could not be folded'),
    sweep(() => retirement.pass(), 'run transition retirement could not finish'),
  ];
});

export type NativeServices =
  | AgentLibrary
  | StartCosts
  | AgentSkills
  | NativeAgentDefinitions
  | Compaction
  | ThreadInstructions
  | CallActivity
  | ThreadEvidence
  | EndingRedelivery
  | EvidenceQueries
  | EvidenceFeed
  | CompactionChoices
  | ModelPreferences;

export class NativeHarnessParts extends Context.Service<
  NativeHarnessParts,
  {
    readonly harness: Harness['Service'];
  }
>()('tagma/native-harness/NativeHarnessParts') {}

export type NativeAssembly = {
  readonly owners: Context.Context<NativeServices>;
  readonly parts: NativeHarnessParts['Service'];
  readonly workflows: Workflows['Service'];
};

export const nativeStoresLayer = Layer.effectContext(
  Effect.gen(function* () {
    const home = dataPathOf((yield* MachineStore).path) ?? undefined;
    const reach = yield* makeBaseReach;
    const toolOutputs = toolOutputStore((yield* ToolOutputsPlace).path ?? join(home ?? tmpdir(), 'tool-outputs'), reach.sources);
    const reads = yield* evidenceReads(join(home ?? tmpdir(), 'evidence-reads'));
    const stores = Context.make(ToolOutputs, { store: toolOutputs }).pipe(
      Context.add(HarnessToolOutputs, toolOutputs),
      Context.add(EvidenceReads, reads),
      Context.add(NativeResourceKinds, [toolOutputsKind(toolOutputs, reach), evidenceReadsKind(reads)]),
      Context.add(NativeRolloutPart, nativeRolloutPart),
      Context.add(ThreadMetadataSource, yield* makeThreadMetadata),
    );
    return home === undefined ? stores : Context.add(stores, CalibrationProfiles, calibrationProfiles(join(home, 'calibration.json')));
  }),
);

export const targetSnapshotsLayer = Layer.effect(TargetSnapshots, makeTargetSnapshots);

export type NativeHarnessRequirements =
  | Scope.Scope
  | ThreadEntryKinds
  | CapabilityOffers
  | MachineWorld
  | MachineStore
  | MachineUnits
  | ThreadRecords
  | Settings
  | SettingChanges
  | AccountCredentials
  | AccountQuota
  | ModelAccess
  | ProviderAccounts
  | ProviderRegistry
  | DefaultAccounts
  | SessionIdentity
  | ActivityRecord
  | ArtifactStore
  | WorkspaceInputs
  | EvidenceReads
  | ThreadGraphs
  | ThreadLookup
  | ThreadWindows
  | ThreadRunning
  | ThreadList
  | ThreadRollouts
  | RestedRollouts
  | Projects
  | NativeKernel
  | GraphServices
  | GraphStore
  | ThreadHarness
  | ThreadLive
  | SessionRead
  | Maintenance
  | StoreSnapshots
  | ToolOutputs
  | HarnessRegistry
  | HarnessMoves
  | CacheWarmth
  | ContextLimits
  | OwnWork
  | TargetPreparation
  | TargetSnapshots;

export const assembleNativeHarness: Effect.Effect<NativeAssembly, never, NativeHarnessRequirements> = Effect.gen(function* () {
  const harness = yield* ThreadHarness;
  const afterPort = (yield* Maintenance).opened;
  yield* scheduleSweeps('native-sweeps', yield* nativeSweeps);
  const records = yield* ThreadRecords;
  const settings = yield* Settings;
  const accountQuota = yield* AccountQuota;
  const sourceCache = yield* WorkspaceInputs;
  const list = yield* ThreadList;
  const projects = yield* Projects;
  const threads = { ...(yield* ThreadLookup), ...(yield* ThreadWindows), ...(yield* ThreadRunning) };
  const { rows, store, modelRows, types, declarations, compaction, choices: reader, runner, runs, capabilities } = yield* NativeKernel;
  yield* Effect.acquireRelease(
    Effect.sync(() => list.serveOpenCalls((threadId, runId) => store.entriesOfRun(threadId, runId))),
    (stopServing) => Effect.sync(stopServing),
  );
  const projectRoot = (projectId: number) => projects.byId(projectId).pipe(Effect.map((project) => project.rootPath));
  const library = yield* agentLibrary({ types, declarations, store, capabilities });
  const operatorRuns = (yield* makeRunStores)({ ownerId: OPERATOR_PRINCIPAL, scope: SCOPED_RUN });
  const evidence = yield* threadEvidence({ rows, runs: operatorRuns });
  const choices = compactionChoices(reader, evidence.thread, compaction);
  const defaults = yield* makeModelPreferences({ rows: modelRows });
  const keepWarm = yield* makeKeepWarm({
    settings: keepWarmSettings(settings),
    warmth: keepWarmWarmth(yield* CacheWarmth),
    spending: keepWarmSpending(accountQuota, yield* ProviderRegistry),
  });
  yield* Effect.forkScoped(
    afterPort.pipe(
      Effect.andThen(keepWarmSettingChanges(settings)),
      Effect.flatMap((changes) => keepWarm.drive(changes)),
    ),
  );
  const stalls = stallSighting(rows);
  const sightStalls = (): Effect.Effect<void> =>
    stalls.pass().pipe(
      Effect.tap((sighted) =>
        Effect.forEach(sighted, (run) =>
          Effect.logWarning('a run stalled: running, with no durable movement past the widest legitimate gap', {
            threadId: run.threadId,
            projectId: run.projectId,
            runId: run.runId,
            movedAt: run.movedAt.toISOString(),
          }),
        ),
      ),
      Effect.asVoid,
      Effect.catchCause((cause) => Effect.logWarning('the stalled-run sighting could not run', { reason: Cause.squash(cause) })),
    );
  yield* drive('stalled-runs', Effect.forever(sightStalls().pipe(Effect.andThen(Effect.sleep(STALL_SWEEP_INTERVAL_MS)))));
  const owners = Context.mergeAll(
    Context.make(
      AgentLibrary,
      AgentLibrary.of({
        list: library.list,
        preview: library.preview,
        offered: (projectId, caller) =>
          Effect.all({ types: types.offeredIn({ projectId, caller }), rejected: types.rejectedIn(projectId) }),
      }),
    ),
    Context.make(AgentSkills, AgentSkills.of({ list: library.skills })),
    Context.make(StartCosts, StartCosts.of({ priced: library.priced })),
    Context.make(
      NativeAgentDefinitions,
      NativeAgentDefinitions.of({
        thread: library.thread,
        instructions: library.instructions,
        destination: library.destination,
        save: library.save,
      }),
    ),
    Context.make(Compaction, nativeCompaction(harness, records, choices)),
    Context.make(
      ThreadInstructions,
      nativeInstructions(
        harness,
        store,
        records,
        sourceCache,
        yield* ArtifactStore,
        projectRoot,
        yield* TargetPreparation,
        library.instructions,
        types,
      ),
    ),
    Context.make(CallActivity, callActivity({ calls: runner.calls, projectOf: (threadId) => records.projectOf(threadId) })),
    Context.make(ThreadEvidence, evidence.thread),
    Context.make(
      EndingRedelivery,
      EndingRedelivery.of({
        redeliver: (threadId, projectId, runId) =>
          gatedByProject(threads, threadId, projectId, () => harness.runs.redeliver(threadId, runId)),
      }),
    ),
    Context.make(EvidenceQueries, evidence.queries),
    Context.make(EvidenceFeed, evidence.feed),
    Context.make(CompactionChoices, choices),
    Context.make(ModelPreferences, defaults),
  );
  yield* Effect.forkScoped(Stream.runForEach(harness.reads.steps(), (finished) => observeStepQuota(accountQuota, finished)));
  yield* Effect.forkScoped(
    Stream.runForEach(
      harness.reads.requests(),
      startCards({ records, store, settings, models: yield* ModelAccess, compaction, threads: harness.threads }),
    ),
  );
  yield* Effect.forkScoped(publishDefaultMoves);
  yield* Effect.forkScoped(carryDefaultMoves);
  yield* Effect.forkScoped(publishLimitMoves);
  yield* Effect.forkScoped(
    afterPort.pipe(
      Effect.andThen(clearExternalLeftovers),
      Effect.asVoid,
      Effect.catch((failure) => Effect.logWarning('external leftovers pass failed', { failure })),
    ),
  );
  const parts: NativeHarnessParts['Service'] = { harness: nativeHarness(harness, threads, operatorRuns) };
  yield* (yield* HarnessRegistry).register(NATIVE_HARNESS as HarnessId, parts.harness);
  return { owners, parts, workflows: yield* workflows({ runs, dataPath: dataPathOf((yield* MachineStore).path) }) };
});

export const nativeAgentsLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const kernel = yield* NativeKernel;
    const titles = yield* ThreadTitles;
    const delivery = yield* makeCallDelivery;
    const worlds = yield* Worlds;
    const graphs = yield* ThreadGraphs;
    const factsOption = yield* Effect.serviceOption(DoctrineFacts);
    const sections = (yield* Doctrine)?.contributed ?? null;
    const places = yield* WorkPlaces;
    const watcher = yield* Effect.serviceOption(FileWatcher);
    const changeSource = watcher._tag === 'Some' ? yield* watchedChanges(watcher.value) : null;
    const context = threadContext(
      kernel.rows,
      yield* ThreadRecords,
      worlds,
      yield* TargetPreparation,
      yield* ChangeRecord,
      yield* ServingGit,
      yield* Settings,
      yield* WorkspaceInputs,
      yield* ScratchAreas,
      yield* ArtifactStore,
      yield* McpServers,
      kernel.mcpBound,
      yield* TagmaAppTools,
      yield* WebSearch,
      yield* ModelAccess,
      kernel.webs,
      yield* ImageChoice,
      kernel.descriptions,
      graphs.graph,
      graphs.graphAt,
      yield* MachineUnits,
      yield* SessionIdentity,
      yield* ThreadExecution,
      yield* CapabilityOffers,
      yield* GrantSigner,
      places,
      yield* SetupReadings,
      turnFacts(factsOption._tag === 'Some' ? factsOption.value : null, sections),
      changeSource,
    );
    const mandate = yield* ThreadMandate;
    const teams = yield* ThreadTeams;
    const callHooks: Parameters<typeof composeAgent>[11] = (ctx) => ({
      retain: () => worlds.lease(atOf(ctx.target)),
      detaching: (call) => delivery.detaching(call),
      began: (call) => delivery.began(call),
      completed: (call, exit) => delivery.completed(call, exit),
    });
    yield* capabilitySources(kernel.toolSources, kernel.capabilities);
    const contributedRules = [...(yield* AgentRules).rules, yield* makePluginHooks];
    const rules = new AgentRuleRegistry<ThreadContext, RuleSetup>(yield* DeclaredNativeRules);
    for (const declaration of kernel.declarations) {
      const agent = composeAgent(
        rules,
        declaration,
        kernel.capabilities,
        kernel.runner,
        kernel.rows,
        mandate,
        teams,
        context,
        sections,
        kernel.asides,
        (projectId, threadId) => titles.opening(projectId, threadId),
        callHooks,
        contributedRules,
      );
      yield* Effect.orDie(kernel.agents.hold(agent, NATIVE_HARNESS));
    }
    const harness = yield* ThreadHarness;
    yield* Effect.addFinalizer(() => harness.dispose());
  }),
);

export const nativeHarnessLayer = Layer.effectContext(
  Effect.map(assembleNativeHarness, ({ owners, parts, workflows }) =>
    Context.add(owners, NativeHarnessParts, parts).pipe(Context.add(Workflows, workflows)),
  ),
);
