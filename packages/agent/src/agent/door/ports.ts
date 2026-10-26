import type { Effect } from 'effect';
import type { AskedReason, PermissionOutcome, PermissionSubject, Raised } from '../../permissions/vocabulary';
import type { AgentToolFailed } from '../AgentFailure';
import type { Tool, ToolConfirmation } from '../tool';
import type { AgentPermissionQuestion } from './types';

export interface ToolVerdicts {
  verdict(tool: Tool, name: string, raised: readonly Raised[]): PermissionOutcome;
}

export type ToolConfirmationAsk = {
  readonly call: AgentPermissionQuestion;
  readonly input: unknown;
  readonly prepared: unknown;
  readonly subjects: readonly PermissionSubject[];
  readonly reasons: readonly AskedReason[];
};

export interface ToolConfirmations {
  confirm(ask: ToolConfirmationAsk): Effect.Effect<ToolConfirmation | undefined, AgentToolFailed>;
}
