import { Clock, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { stored } from '../../platform/store/crossing.js';
import { approvalPreference } from './preferences.js';
import type { AgentApprovalMode } from '@runlith/agent/contracts';

export type ApprovalPreferences = Effect.Success<typeof makeApprovalPreferences>;

export const makeApprovalPreferences = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  return {
    approvalMode: (ownerId: string) =>
      stored('approvalMode')(
        units.read((unit) =>
          Effect.map(
            unit.run(
              db
                .select({ approvalMode: approvalPreference.approvalMode })
                .from(approvalPreference)
                .where(eq(approvalPreference.principalId, ownerId))
                .get(),
            ),
            (row) => row?.approvalMode ?? 'trust',
          ),
        ),
      ),
    saveApprovalMode: (ownerId: string, approvalMode: AgentApprovalMode) =>
      stored('saveApprovalMode')(
        units.write(
          writes('ApprovalPreferences.saveApprovalMode', [approvalPreference]),
          Effect.fnUntraced(function* (unit) {
            const row = yield* unit.run(
              db
                .insert(approvalPreference)
                .values({ principalId: ownerId, approvalMode })
                .onConflictDoUpdate({
                  target: approvalPreference.principalId,
                  set: { approvalMode, updatedAt: new Date(yield* Clock.currentTimeMillis) },
                })
                .returning({ approvalMode: approvalPreference.approvalMode })
                .get(),
            );
            if (!row) return yield* Effect.die(new Error('Thread owner settings update returned no row.'));
            return row.approvalMode;
          }),
        ),
      ),
  };
});
