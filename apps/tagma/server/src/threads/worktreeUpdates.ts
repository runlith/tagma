import { Effect } from 'effect';
import { uuidv7 } from 'uuidv7';
import { WorktreeFinishRefused, WorktreeUnavailable } from '../worktrees/contract/wire/failures.js';
import type { ActProgress } from '../worktrees/contract/service/progress.js';
import { type FinishingGuards, type FinishingThreads } from '../worktrees/contract/service/finishingGate.js';
import type { WorktreeRecord } from '../worktrees/contract/service/worktrees.js';
import type { FinishingGate } from '../worktrees/contract/service/retirement.js';
import type { Unblock } from '../platform/contract/wire/refusal.js';
import type { WorktreeUpdateHanded } from '../worktrees/contract/wire/retirement.js';
import type { WorktreeUpdates } from './contract/service/worktreeUpdates.js';

export type UpdateDelivery = (
  threadId: string,
  envelope: { readonly id: string; readonly senderThreadId: string | null; readonly intent: 'task' | 'message'; readonly text: string },
) => Effect.Effect<{ readonly status: WorktreeUpdateHanded['delivery'] }, { readonly message: string }>;

export type UpdateStart = (
  projectId: number,
  record: WorktreeRecord,
  title: string,
  sender: string | null,
) => Effect.Effect<string, { readonly message: string; readonly unblock: Unblock }>;

export const worktreeUpdates = (
  guards: FinishingGuards,
  gates: FinishingGate['Service'],
  threads: Pick<FinishingThreads, 'placedIn'>,
  deliver: UpdateDelivery,
  start: UpdateStart,
  progress: ActProgress,
): WorktreeUpdates['Service'] => ({
  update: (projectId, rootId, sender) =>
    progress.during(
      projectId,
      rootId,
      'update',
      Effect.gen(function* () {
        const record = yield* guards.recorded(projectId, rootId);
        yield* guards.stands(record);
        const branch = yield* guards.branchOf(record);
        const baseBranch = yield* guards.baseOf(record);
        const threadId = yield* gates.hold(
          { kind: 'root', rootId },
          Effect.gen(function* () {
            const placed = (yield* threads.placedIn(projectId, rootId)).filter((one) => one.archivedAt === null);
            const here = new Set(placed.map((one) => one.threadId));
            const lead = placed
              .filter((one) => one.parentThreadId === null || !here.has(one.parentThreadId))
              .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
            if (lead !== undefined) return lead.threadId;
            return yield* Effect.mapError(
              start(projectId, record, `Bring ${baseBranch} into ${record.name}`, sender),
              (failure) =>
                new WorktreeFinishRefused({
                  reason: 'no-lead-thread',
                  message: `no thread stands in ${record.name} to take the update, and none could be started there: ${failure.message}`,
                  unblock: failure.unblock,
                }),
            );
          }),
        );
        const envelopeId = `envelope:worktree-update:${rootId}:${uuidv7()}`;
        const handed = yield* Effect.mapError(
          deliver(threadId, {
            id: envelopeId,
            senderThreadId: sender,
            intent: sender === null ? 'message' : 'task',
            text: `Bring ${baseBranch} into this worktree: in ${record.path}, merge ${baseBranch} into ${branch}, resolve every conflict in the files themselves, run the project's checks, and land the result with submit_work.`,
          }),
          (failure) => new WorktreeUnavailable({ reason: 'storage', message: failure.message }),
        );
        return { rootId, threadId, base: baseBranch, envelopeId, delivery: handed.status };
      }),
    ),
});
