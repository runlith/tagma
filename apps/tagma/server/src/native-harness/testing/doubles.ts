import type { AgentSkillPool } from '@runlith/agent/AgentSkill';
import type { World } from '@runlith/agent-tools/world';
import { MachineWorld } from '../../executions/contract/service/worlds.js';
import { Effect, Layer } from 'effect';
import { resolveCatalog, type ToolGrant } from '@runlith/agent/catalog/resolveCatalog';
import { catalogProfileOf } from '@runlith/agent/thread/agents/AgentProfile';
import { ThreadEntryKinds, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { coreKinds } from './readers.js';
import { testRegistry } from '../../providers/testing/registry.js';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { OwedCalls } from '../../threads/contract/service/owedCalls.js';
import { RestedRollouts } from '../../threads/contract/service/rested.js';
import { makeThreadStore, type ThreadStore as ThreadStoreOver } from '../rows/threadRow.js';
import { makeHistoryStore } from '../transcript/history.js';
import { makeNativeThreadRows } from '../rows/native.js';
import { makeRunStores, type RunsInput } from '../runs/ledger.js';
import { type CheckpointsInput, makeCompactionStore } from '../compaction/store.js';
import { toolOutputStore } from '../tools/outputStore.js';
import { makeEntryBounding } from '../maintenance/bounding.js';
import { makeFootprintFolding } from '../maintenance/footprintFolding.js';
import { makeTargetSnapshots } from '../rows/targetSnapshots.js';
import { McpBoundTools } from '../tools/mcpRule.js';
import { callActivity as callActivityOver } from '../calls/activity.js';
import { makeCallDelivery } from '../calls/delivery.js';
import { makeRestedFolds, type RestedFolds } from '../transcript/restedFolds.js';
import { makeEventStripping } from '../maintenance/stripping.js';
import { CapabilityUnavailable as CapabilityUnavailableOver } from '../capabilities/contract.js';
import { worldTools as worldToolsOver } from '../capabilities/worldTools.js';
import { capabilityDefinitions as capabilityDefinitionsOver } from '../capabilities/definitions.js';
import { capabilitySections as capabilitySectionsOver } from '../capabilities/contract.js';
import type { DeclaredCapability } from '../contract/service/capabilities.js';
import { composeAgent as composeAgentOver } from '../agents/composeAgent.js';
import { threadContext as threadContextOver } from '../turns/context.js';
import { instructionRule as instructionRuleOver } from '../turns/instructionRule.js';
import { capabilitySources as capabilitySourcesOver } from '../agents/capabilitySources.js';
import { agentLibrary as agentLibraryOver, type AgentLibraryInput } from '../agents/library.js';
import { ThreadLookup } from '../../threads/contract/service/reads.js';
import { WorkspaceInputs, type WorkspaceInputSet } from '../contract/service/inputs.js';
import { ThreadGraphs } from '../contract/service/graphs.js';
import { CapabilityOffers } from '../contract/service/execution.js';
import { assemblePrompt as assemblePromptOver, promptDocument as promptDocumentOver } from '../agents/prompt.js';
import { tagma as tagmaOver } from '../agents/tagma/agent.js';
import { agentFilesOf as agentFilesOfOver } from '../agents/declared/agentFiles.js';
import { makePluginAgents as makePluginAgentsOver } from '../agents/declared/plugins.js';
import { makeBuiltinAgents as makeBuiltinAgentsOver } from '../agents/declared/builtin.js';
import { DECLARED_BASE_ID as DECLARED_BASE_ID_OVER } from '../agents/declared/base.js';
import { conversationSources as conversationSourcesOver } from '../agents/conversationSources.js';
import { DECLARATIONS as DECLARATIONS_OVER } from '../agents/declarations.js';
import { capabilityLossSection as capabilityLossSectionOver } from '../agents/capabilityLoss.js';
import { builtInSkills as builtInSkillsOver } from '../skills/pool.js';
import type { PublishingContext } from '../skills/artifacts.js';
import { mcpServerTools as mcpServerToolsOver } from '../tools/mcpServers.js';
import { RETRIEVAL_WORDS as RETRIEVAL_WORDS_OVER } from '../tools/outputWords.js';
import {
  instructionSnapshot as instructionSnapshotOver,
  instructionsTold as instructionsToldOver,
  touchedTagsTold as touchedTagsToldOver,
} from '../turns/instructions.js';
import { delegationRule as delegationRuleOver } from '../turns/delegationRule.js';
import { teamRule as teamRuleOver } from '../turns/teamRule.js';
import { availabilitySource, readCapabilitySettings } from '../capabilities/availability.js';
import type { RuleSetup } from '../contract/service/rules.js';
import { workspaceInputsLayer as workspaceInputsLayerOver } from '../inputs/cache.js';
import { evidenceReads as evidenceReadsOver } from '../evidence/retained.js';
import { evidenceReadsKind as evidenceReadsKindOver } from '../resources/evidenceReads.js';
import { toolOutputsKind as toolOutputsKindOver } from '../resources/toolOutputs.js';
import { makeNativeRolloutPart } from '../rollout.js';
import { makeRestedWork, RestedWork } from '../transcript/restedWork.js';
import { makeThreadMetadata } from '../rows/threadUnits.js';
import { rowBirths as rowBirthsOver } from '../rows/births.js';
import { makeTransitions } from '../runs/transitionStore.js';
import { kernelStorageWrites } from '../rows/storageWrites.js';
import { compactionPolicy as compactionPolicyOver, COMPACTION_POLICY as COMPACTION_POLICY_OVER } from '../compaction/policy.js';
import { COMPACTION_PROMPT as COMPACTION_PROMPT_OVER, COMPACTION_TEXT as COMPACTION_TEXT_OVER } from '../compaction/policy.js';
import {
  threadLog as threadLogTable,
  threadHistoryItem as threadHistoryItemTable,
  threadCompactionCheckpoint as threadCompactionCheckpointTable,
  threadPrunedToolCall as threadPrunedToolCallTable,
} from '../store/thread.js';
import { typeOf as typeOfOver } from '../store/thread.js';
import { modelPreference as modelPreferenceTable } from '../store/preferences.js';
import { SCOPED_RUN as SCOPED_RUN_OVER } from '../row.js';
import { ArtifactStore } from '../../artifacts/contract/service/shelf.js';
import type { ThreadContext } from '../turns/context.js';
import type { AgentDeclaration } from '../agents/declaration.js';
import type { McpToolsContext } from '../tools/mcpServers.js';
import { ModelChanges } from '../../threads/contract/service/modelChanges.js';
import { modelChanges } from '../../threads/testing/doubles.js';

const served = <A, E, R>(work: Effect.Effect<A, E, R>, records: ThreadRecords['Service'], kinds: ThreadEntryReader) =>
  work.pipe(
    Effect.provideService(ThreadRecords, records),
    Effect.provideService(ThreadEntryKinds, kinds),
    Effect.provideService(ProviderRegistry, testRegistry),
  );

export type ThreadStore = ThreadStoreOver;

export const threadStore = (records: ThreadRecords['Service'], kinds: ThreadEntryReader, reads?: RestedFolds) =>
  served(makeThreadStore({ reads }), records, kinds).pipe(Effect.provide(Layer.effect(ModelChanges, modelChanges())));

export const threadHistory = (kinds: ThreadEntryReader) =>
  makeHistoryStore({ reads: undefined }).pipe(Effect.provideService(ThreadEntryKinds, kinds));

export const nativeThreadRows = (threads: ThreadStore, records: ThreadRecords['Service']) =>
  makeNativeThreadRows({ threads }).pipe(Effect.provideService(ThreadRecords, records));

export const threadRunStores = (records: ThreadRecords['Service'], kinds: ThreadEntryReader) => served(makeRunStores, records, kinds);

export const threadRunStore = ({
  records,
  kinds,
  ...input
}: RunsInput & { readonly records: ThreadRecords['Service']; readonly kinds: ThreadEntryReader }) =>
  Effect.map(threadRunStores(records, kinds), (of) => of(input));

export const threadCompactionStore = (input: CheckpointsInput = {}) => makeCompactionStore(input);

export const threadToolOutputStore = (root: string) => toolOutputStore(root);

export const maintenancePasses = Effect.all({
  stripping: makeEventStripping,
  bounding: makeEntryBounding,
  footprints: makeFootprintFolding,
});

export const targetSnapshotStore = () => makeTargetSnapshots;

export const mcpBoundTools = () => new McpBoundTools();

export const callDelivery = (owed: OwedCalls['Service']) => makeCallDelivery.pipe(Effect.provideService(OwedCalls, owed));

export const restedFolds = (rested: RestedRollouts['Service'], kinds: ThreadEntryReader) =>
  Effect.flatMap(makeRestedWork, (work) =>
    makeRestedFolds.pipe(
      Effect.provideService(RestedWork, work),
      Effect.provideService(RestedRollouts, rested),
      Effect.provideService(ThreadEntryKinds, kinds),
    ),
  );

export const threadEventStripping = (kinds: ThreadEntryReader) => makeEventStripping.pipe(Effect.provideService(ThreadEntryKinds, kinds));

export const capabilityUnavailable = (...input: ConstructorParameters<typeof CapabilityUnavailableOver>): CapabilityUnavailableOver =>
  new CapabilityUnavailableOver(...input);

export const worldTools = (...input: Parameters<typeof worldToolsOver>): ReturnType<typeof worldToolsOver> => worldToolsOver(...input);

export const grantedToolNames = (
  grant: ToolGrant,
  profile: Parameters<typeof catalogProfileOf>[0],
  contributions: Parameters<typeof resolveCatalog<string>>[2],
): string[] => Object.keys(resolveCatalog({ grant }, catalogProfileOf(profile), contributions).catalog);

export const composeAgent = (...input: Parameters<typeof composeAgentOver>): ReturnType<typeof composeAgentOver> =>
  composeAgentOver(...input);

export const threadContext = (...input: Parameters<typeof threadContextOver>): ReturnType<typeof threadContextOver> =>
  threadContextOver(...input);

export const instructionRule = (...input: Parameters<typeof instructionRuleOver>): ReturnType<typeof instructionRuleOver> =>
  instructionRuleOver(...input);

export const capabilitySources = (...input: Parameters<typeof capabilitySourcesOver>): ReturnType<typeof capabilitySourcesOver> =>
  capabilitySourcesOver(...input);

export const agentLibrary = ({
  threads,
  records,
  sourceCache,
  artifacts,
  graphs,
  offers,
  world,
  ...input
}: AgentLibraryInput & {
  readonly threads: ThreadLookup['Service'];
  readonly records: ThreadRecords['Service'];
  readonly sourceCache: WorkspaceInputs['Service'];
  readonly artifacts: ArtifactStore['Service'];
  readonly graphs: ThreadGraphs['Service'];
  readonly offers: CapabilityOffers['Service'];
  readonly world: World;
}) =>
  agentLibraryOver(input).pipe(
    Effect.provideService(ThreadLookup, threads),
    Effect.provideService(ThreadRecords, records),
    Effect.provideService(WorkspaceInputs, sourceCache),
    Effect.provideService(ArtifactStore, artifacts),
    Effect.provideService(ThreadGraphs, graphs),
    Effect.provideService(CapabilityOffers, offers),
    Effect.provideService(MachineWorld, { world }),
  );

export const assemblePrompt = (...input: Parameters<typeof assemblePromptOver>): ReturnType<typeof assemblePromptOver> =>
  assemblePromptOver(...input);

export const promptDocument = (...input: Parameters<typeof promptDocumentOver>): ReturnType<typeof promptDocumentOver> =>
  promptDocumentOver(...input);

export const instructionSnapshot = (...input: Parameters<typeof instructionSnapshotOver>): ReturnType<typeof instructionSnapshotOver> =>
  instructionSnapshotOver(...input);

export const instructionsTold = (projectId: number): string => instructionsToldOver(projectId);

export const touchedTagsTold = (projectId: number): string => touchedTagsToldOver(projectId);

export const workspaceInputsLayer = (...input: Parameters<typeof workspaceInputsLayerOver>): ReturnType<typeof workspaceInputsLayerOver> =>
  workspaceInputsLayerOver(...input);

export const evidenceReads = (...input: Parameters<typeof evidenceReadsOver>): ReturnType<typeof evidenceReadsOver> =>
  evidenceReadsOver(...input);

export const evidenceReadsKind = (...input: Parameters<typeof evidenceReadsKindOver>): ReturnType<typeof evidenceReadsKindOver> =>
  evidenceReadsKindOver(...input);

export const toolOutputsKind = (...input: Parameters<typeof toolOutputsKindOver>): ReturnType<typeof toolOutputsKindOver> =>
  toolOutputsKindOver(...input);

export const threadMetadata = (kinds: ThreadEntryReader) => makeThreadMetadata.pipe(Effect.provideService(ThreadEntryKinds, kinds));

export const rowBirths = (...input: Parameters<typeof rowBirthsOver>): ReturnType<typeof rowBirthsOver> => rowBirthsOver(...input);

export const nativeTransitions = (threads: ThreadStore) => makeTransitions({ threads });

export const kernelWrites = () => kernelStorageWrites;

export const compactionPolicy = (...input: Parameters<typeof compactionPolicyOver>): ReturnType<typeof compactionPolicyOver> =>
  compactionPolicyOver(...input);

export const COMPACTION_POLICY = (...input: Parameters<typeof COMPACTION_POLICY_OVER>): ReturnType<typeof COMPACTION_POLICY_OVER> =>
  COMPACTION_POLICY_OVER(...input);

export const builtInSkills = <TContext extends PublishingContext>(
  artifacts: ArtifactStore['Service'],
  shipped: WorkspaceInputSet['shipped'],
): AgentSkillPool<TContext> => builtInSkillsOver<TContext>(artifacts, shipped);

export const capabilityLossSection = (
  ...input: Parameters<typeof capabilityLossSectionOver>
): ReturnType<typeof capabilityLossSectionOver> => capabilityLossSectionOver(...input);

export const callActivity = (...input: Parameters<typeof callActivityOver>): ReturnType<typeof callActivityOver> =>
  callActivityOver(...input);

export const delegationRule = (...input: Parameters<typeof delegationRuleOver>): ReturnType<typeof delegationRuleOver> =>
  delegationRuleOver(...input);

export const teamRule = (...input: Parameters<typeof teamRuleOver>): ReturnType<typeof teamRuleOver> => teamRuleOver(...input);

export const availabilityRule = (setup: RuleSetup) => availabilitySource.create(setup);

export const capabilitySettings = (...input: Parameters<typeof readCapabilitySettings>) => readCapabilitySettings(...input);

export const typeOf = (...input: Parameters<typeof typeOfOver>): ReturnType<typeof typeOfOver> => typeOfOver(...input);

export const mcpServerTools = (...input: Parameters<typeof mcpServerToolsOver>): ReturnType<typeof mcpServerToolsOver> =>
  mcpServerToolsOver(...input);

export const modelPreference = () => modelPreferenceTable;

export const threadLog = () => threadLogTable;

export const threadHistoryItem = () => threadHistoryItemTable;

export const threadCompactionCheckpoint = () => threadCompactionCheckpointTable;

export const threadPrunedToolCall = () => threadPrunedToolCallTable;

export const SCOPED_RUN = () => SCOPED_RUN_OVER;

export const nativeRolloutPart = () =>
  Effect.flatMap(makeRestedWork, (work) => makeNativeRolloutPart.pipe(Effect.provideService(RestedWork, work)));

export const COMPACTION_PROMPT = () => COMPACTION_PROMPT_OVER;

export const COMPACTION_TEXT = () => COMPACTION_TEXT_OVER;

export const capabilityDefinitionsOf = (declared: readonly DeclaredCapability[]) => capabilityDefinitionsOver(declared);

export const capabilitySections = () => capabilitySectionsOver;

export const RETRIEVAL_WORDS = () => RETRIEVAL_WORDS_OVER;

export const DECLARATIONS = () => DECLARATIONS_OVER;

export const DECLARED_BASE_ID = () => DECLARED_BASE_ID_OVER;

export const conversationSources = () => conversationSourcesOver;

export const tagma = () => tagmaOver;

export const agentFilesOf = () => agentFilesOfOver;

export const makePluginAgents = (): ReturnType<typeof makePluginAgentsOver> => makePluginAgentsOver();

export const makeBuiltinAgents = (...input: Parameters<typeof makeBuiltinAgentsOver>): ReturnType<typeof makeBuiltinAgentsOver> =>
  makeBuiltinAgentsOver(...input);

export const asThreadContext = (value: unknown): ThreadContext => value as ThreadContext;

export const asAgentDeclaration = (value: AgentDeclaration): AgentDeclaration => value;

export const asMcpToolsContext = (value: unknown): McpToolsContext => value as McpToolsContext;

export const CORE_KINDS = coreKinds();
