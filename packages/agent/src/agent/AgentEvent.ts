import type { LLMEvent } from '@runlith/llm/schema/events';
import type { WireFailureRecord } from '@runlith/llm/schema/errors';
import type { AgentCallMeasurement } from './AgentCallMeasurement';
import type { AgentPhase } from './AgentPhase';
import type { CallAdmission } from './callProgress';
import type { ToolDisplay } from '../tool/display';
import type { ToolOutcome } from './tool';

export type AgentEvent =
  | LLMEvent
  | AgentRunEvent
  | AgentApprovalEvent
  | AgentToolDisplayEvent
  | { type: `data-${string}`; id?: string; data: unknown; transient?: boolean };

export type AgentRunEvent =
  | { type: 'run-start'; messageId?: string }
  | { type: 'phase'; phase: AgentPhase['phase'] }
  | { type: 'run-finish' }
  | { type: 'run-abort'; reason?: string }
  | { type: 'context-estimate'; stepNumber: number; tokens: number; contextWindow: number | null }
  | { type: 'measurement'; measurement: AgentCallMeasurement }
  | {
      type: 'retry';
      stepNumber: number;
      attempt: number;
      of: number;
      family: string;
      delayMs: number;
      message: string;
      reason?: WireFailureRecord;
    }
  | {
      type: 'tool-input-interrupted';
      toolCallId: string;
      toolName: string;
      stepNumber: number;
      attempt: number;
      cause?: WireFailureRecord;
    };

export type AgentToolDisplayEvent =
  | { type: 'tool-display'; toolCallId: string; display: ToolDisplay }
  | { type: 'tool-execution'; toolCallId: string; admission: CallAdmission }
  | { type: 'tool-outcome'; toolCallId: string; toolName: string; outcome: ToolOutcome };

export type AgentApprovalEvent =
  | { type: 'tool-approval-request'; approvalId: string; toolCallId: string; isAutomatic?: boolean; signature?: string }
  | {
      type: 'tool-approval-response';
      approvalId: string;
      approved: boolean;
      reason?: string;
      providerExecuted?: boolean;
    };

const AGENT_FRAMING_EVENTS = new Set<string>([
  'run-start',
  'phase',
  'run-finish',
  'run-abort',
  'context-estimate',
  'measurement',
  'input-usage',
  'step-start',
  'step-finish',
  'finish',
  'retry',
  'tool-input-interrupted',
]);

export function isAgentOutputEvent(type: string): boolean {
  return !AGENT_FRAMING_EVENTS.has(type);
}
