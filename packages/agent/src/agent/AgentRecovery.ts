import type { Effect } from 'effect';
import type { WireFailureRecord } from '@runlith/llm/schema/errors';
import type { AgentHostFailed } from './AgentFailure';
import type { PendingRuntimeGuide } from './AgentGuidanceJournal';
import type { ToolRecovery } from './tool';

export type AgentInterruptedCall = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly received: string;
  readonly recovery?: ToolRecovery<Record<string, unknown>>;
};

export type AgentRecoveryRequest = {
  readonly stepNumber: number;
  readonly attempt: number;
  readonly calls: readonly AgentInterruptedCall[];
  readonly cause: WireFailureRecord | undefined;
};

export interface AgentRecovery {
  interrupted(input: AgentRecoveryRequest): Effect.Effect<readonly PendingRuntimeGuide[], AgentHostFailed>;
}
