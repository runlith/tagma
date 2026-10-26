import { Effect } from 'effect';
import type { ThreadOwnerSettingsStorage } from '../ownerSettings';
import { attempt } from './attempt';
import type { MemoryStorageInput } from './state';

export const makeMemoryOwnerSettings = ({ memory }: MemoryStorageInput): ThreadOwnerSettingsStorage => ({
  approvalMode: (ownerId) => attempt('approvalMode', () => memory.read(undefined, () => memory.approvals.get(ownerId) ?? 'trust')),
  saveApprovalMode: (ownerId, approvalMode) =>
    memory.units.commit((unit) =>
      Effect.as(
        attempt('saveApprovalMode', () => unit.put(memory.approvals, ownerId, approvalMode)),
        approvalMode,
      ),
    ),
});
