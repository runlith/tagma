import type { AgentApprovalMode, ThreadBindings } from '../agent/contracts';
import type { ThreadBornOf } from '../protocol/birth';
import type { AgentRequestFootprint } from '../agent/AgentCallMeasurement';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { ThreadDefinition, ThreadProfileBirth } from './agents/AgentProfile';
import type { Message } from '@runlith/llm/schema/messages';
import type { Usage } from '@runlith/llm/schema/events';
import type { ThreadFailureDiagnostics, ThreadQuestionEntry, WithdrawnWords } from '../transcript/entries';
import type { ThreadNotificationRecord, ThreadRunStopRequest } from './storage/settlement';
import type { ThreadTranscript, ThreadTranscriptEntry } from '../transcript/rows';
import type { RunTerminalStatus } from '../transcript/live';
import { NATIVE_BINDING, type TransportBinding } from './record';
import type { TransportCapabilities } from './record';

export type ThreadStatus = 'idle' | 'running' | 'failed';

export type ThreadAuthority = {
  readonly mode: AgentApprovalMode;
  readonly bypassFrom: string | null;
};

export const THREAD_AUTHORITY_DEFAULT: ThreadAuthority = { mode: 'trust', bypassFrom: null };
export type ThreadRunStatus = 'running' | RunTerminalStatus;

export const THREAD_RUN_INTERRUPTED: readonly ThreadRunStatus[] = ['cut', 'aborted', 'failed'];

export function threadRunInterrupted(status: ThreadRunStatus | null | undefined): boolean {
  return status !== null && status !== undefined && THREAD_RUN_INTERRUPTED.includes(status);
}

export function threadRunLimited(run: ThreadRunRow | null): boolean {
  return run !== null && run.status === 'failed' && run.failure?.reason?.family === 'rate-limit';
}

export type ThreadRunStage = {
  stage: import('../transcript/live').RunStage | null;
  message: string | null;
  halt?: import('../transcript/live').RunHalt;
};

export type ThreadRunProgress = ThreadRunStage & {
  phase?: import('../agent/AgentPhase').AgentPhase;
};

export type ThreadContextReading = {
  readonly usage: Usage;
  readonly contextWindow: number | null;
  readonly inputLimit?: number | null;
  readonly footprint?: AgentRequestFootprint;
  readonly attempt?: number;
  readonly historyMessages?: number;
  readonly runId: string;
  readonly stepNumber: number;
  readonly provider: string | null;
  readonly model: string | null;
  readonly account?: string;
  readonly reasoning?: string | null;
  readonly measuredAt: string;
  readonly sentAt?: string;
  readonly cache?: { readonly ttlSeconds: number | null };
  readonly stale: boolean;
  readonly staleBy?: 'rewind';
};

export type ThreadContextRecord = {
  readonly generation: number;
  readonly sourceKey: string;
  readonly requestId: string;
};

export type ThreadContextEvidence = {
  readonly instructions: string;
  readonly tools: readonly string[];
  readonly profileId: string | null;
  readonly approvalMode: AgentApprovalMode;
};

export type ThreadContextChange = {
  readonly requestId: string;
  readonly runId: string;
  readonly sourceKey: string;
  readonly fromGeneration: number;
  readonly outcome: 'pending' | 'published' | 'denied';
  readonly record?: ThreadContextRecord;
  readonly evidence?: ThreadContextEvidence;
  readonly stepNumber?: number;
  readonly detail?: string;
  readonly requestedAt: string;
  readonly settledAt?: string;
};

export type ThreadHistory = readonly Message[];
export type ThreadPendingInteraction = ThreadQuestionEntry | null;

export type ThreadBirthCarried = 'all' | 'turns' | 'before' | 'none' | 'fresh';

export type ThreadBirthPlace = { readonly [key: string]: unknown };

export type ThreadHostBinding = {
  readonly kind: string;
  readonly id: string;
};

export type ThreadTransport = {
  transport: TransportBinding;
  capabilities: TransportCapabilities;
};

export type ThreadMetadataRow = {
  id: string;
  projectId?: number | null;
  ownerId: string;
  agentId: string;
  parentThreadId: string | null;
  spawnedByRunId: string | null;
  bornOf: ThreadBornOf | null;
  spawnRootId: string;
  cacheGroup: string;
  name: string | null;
  budgetTokens: number | null;
  profile: ThreadProfileBirth | null;
  pendingDefinition?: ThreadDefinition | null;
  authority: ThreadAuthority;
  plain: boolean;
  hostKind: string | null;
  hostId: string | null;
  bindings: ThreadBindings;
  pendingInteraction: ThreadPendingInteraction;
  account: string | null;
  provider: string;
  model: string | null;
  reasoning: string | null;
  switches: ModelSwitches;
  status: ThreadStatus;
  failureReason: string | null;
  contextReading: ThreadContextReading | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
} & ThreadTransport;

export const agentOf = (row: ThreadMetadataRow): string => row.transport.agent ?? row.agentId;

export const servedAgentOf = (row: ThreadMetadataRow): string | null =>
  row.transport.agent ?? (row.transport.adapter === NATIVE_BINDING.adapter ? row.agentId : null);

export type ThreadPromptState = {
  systemPrompt: string | null;
  pendingSystemPrompt: string | null;
  pendingDefinition?: ThreadDefinition | null;
};

export type ThreadRow = ThreadMetadataRow &
  ThreadPromptState & {
    history: ThreadHistory;
  };

export type ThreadRunKind = 'turn' | 'keep-warm' | 'compaction';

export type ThreadRunOrigin = 'core' | 'observed';

export type ThreadRunCost = { readonly amount: number; readonly currency: string; readonly basis: string };

export type ThreadRunRow = {
  id: string;
  threadId: string;
  kind: ThreadRunKind;
  origin: ThreadRunOrigin;
  status: ThreadRunStatus;
  ownerId: string;
  account: string | null;
  provider: string | null;
  model: string | null;
  reasoning: string | null;
  switches: ModelSwitches;
  approvalMode: AgentApprovalMode;
  interactive: boolean;
  progress: ThreadRunProgress;
  usage: Usage | null;
  cost: ThreadRunCost | null;
  streamTail: ThreadTranscript | null;
  resumes: number;
  failureReason: string | null;
  failure: ThreadFailureDiagnostics | null;
  createdAt: Date;
  startedAt: Date;
  heartbeatAt: Date;
  handedOverAt: Date | null;
  finishedAt: Date | null;
  settledNotifiedAt: Date | null;
  settledBy: 'reader' | 'parent' | 'agent' | 'model' | null;
  stopRequest: ThreadRunStopRequest | null;
  withdrawnWords: WithdrawnWords | null;
  settledNotification: ThreadNotificationRecord | null;
  settledNotifyAttempts: number;
  updatedAt: Date;
};

export type ThreadCompactionCheckpointRow = {
  id: string;
  threadId: string;
  sourceRunId: string | null;
  coveredMessageCount: number;
  coveredPrefixHash: string;
  summary: string;
  usage: Usage | null;
  createdAt: Date;
};

export type ThreadOwnerSettingsRow = {
  ownerId: string;
  approvalMode: AgentApprovalMode;
  createdAt: Date;
  updatedAt: Date;
};
