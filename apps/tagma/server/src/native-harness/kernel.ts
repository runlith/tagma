import { Context, Duration, Effect, Layer, Schedule, type Scope } from 'effect';
import { ApprovalModes } from '@runlith/agent/modes/ApprovalModes';
import { type AgentRunner, makeAgentRunner } from '@runlith/agent/AgentRunner';
import { makeThreadAsides, type ThreadAsides } from '@runlith/agent/thread/ThreadAsides';
import { makeAgentRegistry, type AgentRegistry } from '@runlith/agent/thread/agents/AgentRegistry';
import { CalibrationProfiles } from './contract/service/calibration.js';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { makeThreadCompaction, type ThreadCompaction } from '@runlith/agent/thread/compaction/ThreadCompaction';
import { makeThreadDigestStrategy } from '@runlith/agent/thread/compaction/digestStrategy';
import { makeThreadSummaryStrategy } from '@runlith/agent/thread/compaction/summaryStrategy';
import type { ContextCompaction } from '@runlith/agent/collaboration/compaction';
import { stored } from '../platform/store/crossing.js';
import { threadToolSources, ThreadToolRegistry, type ThreadToolSourceRegistry } from '@runlith/agent/thread/ThreadPorts';
import { ThreadTypes } from '@runlith/agent/collaboration/types';
import type { ModeRegistry } from '@runlith/agent/modes/ApprovalMode';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { capabilityDefinitions, type CapabilityDefinitions } from './capabilities/definitions.js';
import { DeclaredCapabilities } from './contract/service/capabilities.js';
import {
  BornFacets,
  HarnessAsides,
  HarnessCalls,
  McpForgetting,
  NativeAgents,
  NativeCompaction,
  NativeInputRecovery,
  NativeStorage,
  NativeSwitches,
  NativeWorkflow,
  SettledRelease,
} from '../threads/contract/service/engine.js';
import { kernelStorageWrites } from './rows/storageWrites.js';
import { writes } from '../platform/contract/service/writes.js';
import { ThreadHomes } from '../threads/contract/service/homes.js';
import { TargetPreparation } from '../threads/contract/service/preparation.js';
import { CallEpoch } from '../threads/contract/service/owedCalls.js';
import { randomUUID } from 'node:crypto';
import { makeSettledRelease } from './runs/settled.js';
import { WebCache } from '@runlith/llm/profiles/webCache';
import { type RunWebs, runWebs } from './turns/runWebs.js';
import { type CommandDescriptions, commandDescriptions } from './turns/commandDescriptions.js';
import { BirthFactWriting, ThreadHistoryReads } from '../threads/contract/service/birth.js';
import { TypeOffers } from '../threads/library/types.js';
import { InstalledHarnesses } from '../threads/contract/service/harness.js';
import { ScratchAreas } from '../threads/contract/service/scratch.js';
import { type ApprovalPreferences, makeApprovalPreferences } from '../threads/store/approvals.js';
import { AGENT_IDLE_MS } from '@runlith/agent/callProgress';
import { CacheWarmth } from '../threads/contract/service/evidence.js';
import { ThreadLookup } from '../threads/contract/service/reads.js';
import { BirthModelSelection } from '../threads/contract/service/birth.js';
import { AccountCredentials } from '../providers/contract/service/access.js';
import { AccountQuota } from '../providers/contract/service/quota.js';
import { ProviderAccounts } from '../providers/contract/service/accounts.js';
import { ProviderRegistry } from '../providers/contract/service/registry.js';
import { cacheWarmth } from './evidence/warmth.js';
import { type ChoiceReader, makeChoiceReader } from './compaction/choice.js';
import { makeBirthModels } from './models/preference.js';
import { DECLARATIONS } from './agents/declarations.js';
import { dataPathOf, MachineStore } from '../platform/contract/service/store.js';
import { drive } from '../platform/contract/service/drives.js';
import { MachineUnits, type Unit, type WriteUnit } from '../platform/contract/service/units.js';
import { Projects } from '../projects/contract/service/registry.js';
import { Settings } from '../settings/contract/service/values.js';
import { ModelAccess } from '../providers/contract/service/access.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { ModelChanges } from '../threads/contract/service/modelChanges.js';
import { ThreadRollouts } from '../threads/contract/service/rollouts.js';
import { RestedRollouts } from '../threads/contract/service/rested.js';
import { WorkSpells } from '../thread-record/contract/service/spells.js';
import { makeDeclaredAgents, type DeclaredAgents } from '../threads/library/declared.js';
import type { AgentDeclaration } from './agents/declaration.js';
import { agentFilesOf } from './agents/declared/agentFiles.js';
import type { AgentFiles } from '../threads/contract/service/library.js';
import { SCOPED_RUN } from './row.js';
import { COMPACTION_PROMPT, COMPACTION_TEXT, compactionPolicy } from './compaction/policy.js';
import { makeCompactionPlanning, makeContextLimits } from './compaction/limits.js';
import { CompactionPlanning } from '../threads/contract/service/compaction.js';
import { ContextLimits } from '../threads/contract/service/limits.js';
import { makeCompactionStore } from './compaction/store.js';
import { contextCompaction } from './compaction/context.js';
import { HarnessBirthRows, type RowBirths } from '../threads/contract/service/birth.js';
import { makeCacheObservationStore, type ThreadCacheObservationStore } from './models/cacheObservations.js';
import { makeModelPreferenceRows, type ModelPreferenceRows } from './models/preferences.js';
import { rowBirths } from './rows/births.js';
import { makeNativeThreadRows, type NativeThreadRows } from './rows/native.js';
import { makeThreadStore, type ThreadStore } from './rows/threadRow.js';
import { makeRunStores, type ThreadRunStore } from './runs/ledger.js';
import { makeTransitions } from './runs/transitionStore.js';
import { McpBoundTools } from './tools/mcpRule.js';
import { makeRestedFolds, type RestedFolds } from './transcript/restedFolds.js';
import { makeInputRecovery, type InputRecoveryInput } from './turns/inputRecovery.js';
import { makeWorkflowRuns, type WorkflowRuns } from './workflows/runStorage.js';
import { readWorkflowLibrary } from './workflows/sources.js';
import type { AgentRecovery } from '@runlith/agent/AgentRecovery';
import type { ThreadTransitionStorage } from '@runlith/agent/thread/transition/port';
import { HarnessRegistry } from '../threads/contract/service/harness.js';
import { TagmaAppPoints } from '../tagma-apps/contract/service/points.js';
import { makeTagmaAppAgents } from './agents/declared/tagmaApps.js';
export type NativeKernelRequirements =
  | ApprovalModes
  | MachineStore
  | MachineUnits
  | ThreadRecords
  | ModelChanges
  | Settings
  | ModelAccess
  | ThreadRollouts
  | RestedRollouts
  | WorkSpells
  | Projects
  | ScratchAreas
  | InstalledHarnesses
  | ThreadLookup
  | AccountCredentials
  | AccountQuota
  | ProviderAccounts
  | ProviderRegistry
  | HarnessRegistry
  | DeclaredCapabilities
  | ThreadEntryKinds
  | TagmaAppPoints
  | ThreadHomes
  | TargetPreparation
  | Scope.Scope;
const WEB_MEMORY_CHARACTERS = 16 * 1024 * 1024;
const WORKFLOW_LEASE_MS = 300_000;
const WORKFLOW_STEP_DEADLINE_MS = 1_800_000;
export class NativeKernel extends Context.Service<
  NativeKernel,
  {
    readonly asides: ThreadAsides;
    readonly webs: RunWebs;
    readonly descriptions: CommandDescriptions;
    readonly types: DeclaredAgents;
    readonly runner: AgentRunner;
    readonly restedFolds: RestedFolds;
    readonly store: ThreadStore;
    readonly rows: NativeThreadRows;
    readonly modelRows: ModelPreferenceRows;
    readonly ownerSettings: ApprovalPreferences;
    readonly births: RowBirths;
    readonly mcpBound: McpBoundTools;
    readonly declarations: readonly AgentDeclaration[];
    readonly agents: AgentRegistry<WriteUnit<'machine'>>;
    readonly toolSources: ThreadToolSourceRegistry;
    readonly modes: ModeRegistry;
    readonly capabilities: CapabilityDefinitions;
    readonly agentFiles: AgentFiles;
    readonly compaction: ThreadCompaction;
    readonly choices: ChoiceReader;
    readonly warmth: CacheWarmth['Service'];
    readonly birthModels: BirthModelSelection['Service'];
    readonly transitions: ThreadTransitionStorage<Unit<'machine'>, WriteUnit<'machine'>>;
    readonly runs: WorkflowRuns;
    readonly cacheObservations: ThreadCacheObservationStore;
    readonly fillers: {
      readonly compaction: (native: ContextCompaction['Service']) => ContextCompaction['Service'];
    };
    readonly standingSwitches: (input: {
      readonly ownerId: string;
      readonly provider: string;
      readonly model: string;
    }) => ReturnType<ModelPreferenceRows['defaultSwitches']>;
    readonly inputRecovery: (input: InputRecoveryInput) => AgentRecovery;
    readonly createRuns: (ownerId: string) => ThreadRunStore;
    readonly workflow: {
      readonly library: (run: {
        readonly thread: string;
        readonly id: string;
      }) => Effect.Effect<Effect.Success<ReturnType<typeof readWorkflowLibrary>>, ThreadCallBroke>;
      readonly leaseMs: number;
      readonly stepDeadlineMs: number;
    };
  }
>()('tagma/native-harness/NativeKernel') {}
export const assembleNativeKernel: Effect.Effect<NativeKernel['Service'], never, NativeKernelRequirements> = Effect.gen(function* () {
  const machine = yield* MachineStore;
  const db = machine.db;
  const dataPath = dataPathOf(machine.path);
  const units = yield* MachineUnits;
  const records = yield* ThreadRecords;
  const harnesses = yield* HarnessRegistry;
  const transitionWrites = writes(
    kernelStorageWrites.operation,
    [],
    kernelStorageWrites,
    (yield* ThreadHomes).writes,
    (yield* TargetPreparation).writes,
  );
  const settings = yield* Settings;
  const models = yield* ModelAccess;
  const rollouts = yield* ThreadRollouts;
  const spells = yield* WorkSpells;
  const projects = yield* Projects;
  const installed = yield* InstalledHarnesses;
  const calibrationOption = yield* Effect.serviceOption(CalibrationProfiles);
  const calibration = calibrationOption._tag === 'Some' ? calibrationOption.value : undefined;
  const asides = yield* makeThreadAsides;
  const webs = runWebs(new WebCache(WEB_MEMORY_CHARACTERS));
  const descriptions = commandDescriptions();
  const agents = yield* makeAgentRegistry<WriteUnit<'machine'>>();
  const runner = yield* makeAgentRunner({ models: models, idleMs: AGENT_IDLE_MS });
  const restedFolds = yield* makeRestedFolds;
  const store = yield* makeThreadStore({ reads: restedFolds });
  const rows = yield* makeNativeThreadRows({ threads: store });
  const modelRows = yield* makeModelPreferenceRows;
  const mcpBound = new McpBoundTools();
  const cacheObservations = yield* makeCacheObservationStore;
  const warmth = yield* cacheWarmth(cacheObservations);
  const choices = yield* makeChoiceReader({ rows }).pipe(Effect.provideService(CacheWarmth, warmth));
  const runStores = yield* makeRunStores;
  const compaction = makeThreadCompaction({
    models: models,
    checkpoints: yield* makeCompactionStore({
      reads: restedFolds,
      onRecords: (threadId, record) => rollouts.appendRecord(threadId, record),
    }),
    calibration: calibration ? { store: calibration } : undefined,
    policy: ({ threadId }) => compactionPolicy(records, settings, threadId),
    transcriptLocation: Effect.fnUntraced(function* (threadId) {
      const path = yield* rollouts.locate(threadId).pipe(stored('locate'));
      if (path === undefined) return yield* new ThreadCallBroke({ cause: new Error('The compaction transcript location is unavailable.') });
      return path;
    }),
    strategy: makeThreadSummaryStrategy({
      models: models,
      prompt: COMPACTION_PROMPT,
    }),
    recovery: makeThreadDigestStrategy(),
    text: COMPACTION_TEXT,
    stallMs: AGENT_IDLE_MS,
    summarizers: (ask) => choices.summarizers(ask),
  });
  const persistCalibration = compaction
    .persistCalibration()
    .pipe(Effect.tapError((failure) => Effect.logWarning('[compaction] the calibration profile was not saved', failure)));
  yield* drive(
    'compaction-calibration',
    persistCalibration.pipe(
      Effect.retry(Schedule.spaced(CALIBRATION_SAVE_INTERVAL)),
      Effect.repeat(Schedule.spaced(CALIBRATION_SAVE_INTERVAL)),
    ),
  );
  yield* Effect.addFinalizer(() => Effect.asVoid(Effect.exit(persistCalibration)));
  const capabilities = yield* capabilityDefinitions(yield* DeclaredCapabilities);
  const agentFiles = agentFilesOf(capabilities);
  const toolSources = threadToolSources();
  const packaged = yield* makeTagmaAppAgents({ capabilities, sources: toolSources });
  yield* Effect.acquireRelease((yield* TagmaAppPoints).declare(packaged.point), (withdraw) => Effect.sync(withdraw));
  const types = yield* makeDeclaredAgents({
    harnesses: installed.read,
    storePath: machine.path,
    files: agentFiles,
    packages: packaged.packages,
  }).pipe(Effect.provideService(NativeAgents, agents));
  return {
    asides,
    webs,
    descriptions,
    types,
    runner,
    restedFolds,
    store,
    rows,
    modelRows,
    ownerSettings: yield* makeApprovalPreferences,
    births: rowBirths(store, rows),
    mcpBound,
    declarations: DECLARATIONS,
    agents,
    toolSources,
    modes: yield* ApprovalModes,
    capabilities,
    agentFiles,
    compaction,
    choices,
    warmth,
    birthModels: yield* makeBirthModels({ rows: modelRows }),
    transitions: yield* makeTransitions({ threads: store, writes: () => harnesses.writes(transitionWrites) }),
    runs: yield* makeWorkflowRuns,
    cacheObservations,
    fillers: {
      compaction: (native) => contextCompaction(native, store),
    },
    standingSwitches: ({ ownerId, provider, model }) => modelRows.defaultSwitches(ownerId, provider, model),
    inputRecovery: yield* makeInputRecovery,
    createRuns: (ownerId) =>
      runStores({
        ownerId,
        scope: SCOPED_RUN,
        lifecycle: {
          started: (threadId, at, tx) => spells.begin(threadId, at, tx),
          settled: (threadId, tx) => spells.end(threadId, tx),
        },
      }),
    workflow: {
      library: Effect.fnUntraced(
        function* (run) {
          const projectId = yield* records.projectOf(run.thread);
          if (projectId === undefined) {
            return yield* Effect.fail(new Error(`Workflow run ${run.id} has no project to read floors from.`));
          }
          const project = yield* projects.byId(projectId);
          return yield* readWorkflowLibrary({ projectRoot: project.rootPath, dataPath });
        },
        (effect, run) => effect.pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause }))),
      ),
      leaseMs: WORKFLOW_LEASE_MS,
      stepDeadlineMs: WORKFLOW_STEP_DEADLINE_MS,
    },
  };
});
const CALIBRATION_SAVE_INTERVAL = Duration.seconds(30);
const nativeEngine = (kernel: NativeKernel['Service']) =>
  Context.make(NativeStorage, {
    threads: kernel.store,
    transitions: kernel.transitions,
    runs: kernel.createRuns,
    cacheObservations: kernel.cacheObservations,
    ownerSettings: kernel.ownerSettings,
    writes: kernelStorageWrites,
  }).pipe(
    Context.add(NativeCompaction, { compaction: kernel.compaction, fill: kernel.fillers.compaction }),
    Context.add(NativeInputRecovery, kernel.inputRecovery),
    Context.add(NativeSwitches, { of: kernel.standingSwitches }),
    Context.add(NativeWorkflow, {
      runs: kernel.runs,
      library: kernel.workflow.library,
      seams: {},
      conditions: {},
      leaseMs: kernel.workflow.leaseMs,
      stepDeadlineMs: kernel.workflow.stepDeadlineMs,
    }),
    Context.add(BornFacets, { inherit: (input, tx) => kernel.rows.inheritFacet(input, tx) }),
    Context.add(NativeAgents, kernel.agents),
    Context.add(ThreadToolRegistry, kernel.toolSources),
    Context.add(ThreadTypes, kernel.types),
  );
export const nativeEngineLayer = Layer.effectContext(Effect.map(NativeKernel, nativeEngine));
export const nativeKernelLayer = Layer.effect(NativeKernel, assembleNativeKernel);
export const nativeKernelServices = Layer.effectContext(
  Effect.gen(function* () {
    const kernel = yield* NativeKernel;
    return Context.make(HarnessBirthRows, kernel.births).pipe(
      Context.add(SettledRelease, yield* makeSettledRelease({ webs: kernel.webs, descriptions: kernel.descriptions })),
      Context.add(McpForgetting, kernel.mcpBound),
      Context.add(HarnessAsides, kernel.asides),
      Context.add(HarnessCalls, kernel.runner.calls),
      Context.add(CallEpoch, { id: randomUUID() }),
      Context.add(CacheWarmth, kernel.warmth),
      Context.add(BirthModelSelection, kernel.birthModels),
      Context.add(ThreadHistoryReads, { of: (threadId) => kernel.rows.historyOf(threadId) }),
      Context.add(BirthFactWriting, { attach: (input, tx) => kernel.rows.attachFacet(input, tx) }),
      Context.add(TypeOffers, kernel.types),
      Context.add(CompactionPlanning, yield* makeCompactionPlanning),
      Context.add(ContextLimits, yield* makeContextLimits({ agents: kernel.agents })),
    );
  }),
);
