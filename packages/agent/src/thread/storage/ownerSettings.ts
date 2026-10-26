import type { Effect } from 'effect';
import type { AgentApprovalMode } from '../../agent/contracts';
import type { ThreadPortFailure } from '../ThreadBorder';

export interface ThreadOwnerSettingsStorage {
  approvalMode(ownerId: string): Effect.Effect<AgentApprovalMode, ThreadPortFailure>;

  saveApprovalMode(ownerId: string, approvalMode: AgentApprovalMode): Effect.Effect<AgentApprovalMode, ThreadPortFailure>;
}
