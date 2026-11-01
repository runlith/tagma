import type { ThreadPortFailure } from '../../ThreadBorder';
import { Effect } from 'effect';
import { attempt } from './attempt';
import { RUN_ENDINGS } from '../../../transcript/live';
import type { ThreadRunRow } from '../../rows';
import type { ThreadSettledClaimInput, ThreadSettledClaims, ThreadSettledPage, ThreadSettledQuery } from '../runs';
import { seedThreadNotification, type ThreadNotificationRecord } from '../settlement';
import type { HeldRun, MemoryRunsInput } from './state';
import type { MemoryTx } from './units';
import { newestSettled, viewOf } from './runViews';

const TERMINAL: readonly ThreadRunRow['status'][] = RUN_ENDINGS;

export type MemorySettledRuns = ReturnType<typeof makeMemorySettledRuns>;

export function makeMemorySettledRuns({ memory, ownerId, scope }: MemoryRunsInput) {
  const endedOf = (threadId: string): readonly HeldRun[] => {
    const thread = memory.held(threadId);
    if (!thread || thread.scope !== scope) return [];
    return thread.ended.flatMap((runId) => {
      const run = memory.runs.get(runId);
      return run ? [run] : [];
    });
  };
  const inScope = (run: HeldRun): boolean => memory.held(run.threadId)?.scope === scope;
  const claimed = (runId: string, expectedId: string | null): HeldRun | undefined => {
    const run = memory.runs.get(runId);
    if (!run || run.ownerId !== ownerId || run.status === 'running' || run.settledNotifiedAt !== null) return undefined;
    return (run.settledNotification?.id ?? null) === expectedId ? run : undefined;
  };
  const change = (unit: MemoryTx, run: HeldRun, patch: Partial<HeldRun>): HeldRun => {
    const next: HeldRun = { ...run, ...patch, updatedAt: patch.updatedAt ?? unit.now() };
    unit.put(memory.runs, run.id, next);
    return next;
  };

  return {
    claimSettledForNotification: (input: ThreadSettledClaimInput): Effect.Effect<ThreadSettledClaims, ThreadPortFailure> =>
      memory.units.commit((unit) =>
        attempt('claimSettledForNotification', () => {
          const unconfirmed = [...memory.runs.values()]
            .filter(
              (run) =>
                run.settledNotifiedAt === null &&
                TERMINAL.includes(run.status) &&
                run.heartbeatAt.getTime() < input.heartbeatBefore.getTime() &&
                inScope(run),
            )
            .sort(
              (left, right) => (left.finishedAt?.getTime() ?? 0) - (right.finishedAt?.getTime() ?? 0) || left.id.localeCompare(right.id),
            );
          const due = unconfirmed.filter((run) => run.settledNotifyAttempts < input.maxAttempts).slice(0, input.limit);
          const spent = unconfirmed
            .filter((run) => run.settledNotifyAttempts >= input.maxAttempts && run.settledNotification?.exhaustedAt === null)
            .slice(0, input.limit);
          const claims = due.map((run) => {
            const settledNotification = seedThreadNotification(run.id, input.now, run.settledNotification);
            change(unit, run, {
              ownerId,
              heartbeatAt: input.now,
              settledNotifyAttempts: run.settledNotifyAttempts + 1,
              settledNotification,
              updatedAt: input.now,
            });
            return {
              id: run.id,
              threadId: run.threadId,
              kind: run.kind,
              status: run.status,
              failureReason: run.failureReason,
              failure: run.failure,
              settledBy: run.settledBy,
              settledNotification,
              attempt: run.settledNotifyAttempts + 1,
            };
          });
          const exhausted = spent.map((run) => {
            const record = run.settledNotification!;
            change(unit, run, { settledNotification: { ...record, exhaustedAt: input.now.toISOString() } });
            return { id: run.id, threadId: run.threadId, attempts: run.settledNotifyAttempts, delivered: record.delivered };
          });
          return { claims, exhausted };
        }),
      ),
    redeliverSettled: (runId: string, maxAttempts: number) =>
      memory.units.commit((unit) =>
        attempt('redeliverSettled', () => {
          const run = memory.runs.get(runId);
          if (
            !run ||
            !TERMINAL.includes(run.status) ||
            run.settledNotifiedAt !== null ||
            run.settledNotifyAttempts < maxAttempts ||
            !inScope(run)
          )
            return false;
          change(unit, run, {
            settledNotifyAttempts: 0,
            settledNotification: run.settledNotification === null ? null : { ...run.settledNotification, exhaustedAt: null },
          });
          return true;
        }),
      ),
    settledRuns: (input: ThreadSettledQuery): Effect.Effect<ThreadSettledPage, ThreadPortFailure> =>
      attempt('settledRuns', () =>
        memory.read(undefined, () => {
          const after = input.after;
          let total = 0;
          const pages: HeldRun[] = [];
          for (const threadId of new Set(input.threadIds)) {
            const ended = endedOf(threadId);
            total += ended.length;
            let taken = 0;
            for (const run of ended) {
              if (taken === input.limit) break;
              if (after !== undefined && newestSettled(run, after) <= 0) continue;
              pages.push(run);
              taken += 1;
            }
          }
          return { rows: pages.sort(newestSettled).slice(0, input.limit).map(viewOf), total };
        }),
      ),
    newestSettled: (threadIds: readonly string[], depth: number, tx?: MemoryTx) =>
      attempt('newestSettled', () =>
        memory.read(tx, () => [...new Set(threadIds)].flatMap((threadId) => endedOf(threadId).slice(0, depth).map(viewOf))),
      ),
    writeSettledNotification: (runId: string, record: ThreadNotificationRecord, expectedId: string | null) => {
      if (record.id !== expectedId) return Effect.succeed(false);
      return memory.units.commit((unit) =>
        attempt('writeSettledNotification', () => {
          const run = claimed(runId, expectedId);
          if (!run) return false;
          change(unit, run, { settledNotification: record });
          return true;
        }),
      );
    },
    markSettledNotified: (runId: string, notifiedAt: Date, record: ThreadNotificationRecord | null) =>
      memory.units.commit((unit) =>
        attempt('markSettledNotified', () => {
          const run = claimed(runId, record?.id ?? null);
          if (!run) return false;
          change(unit, run, {
            settledNotifiedAt: notifiedAt,
            settledNotification: record
              ? { ...record, phase: 'confirmation', subscriber: null, finishedAt: notifiedAt.toISOString() }
              : null,
          });
          return true;
        }),
      ),
    heartbeatSettledClaim: (runId: string, heartbeatAt: Date, expectedId: string | null) =>
      memory.units.commit((unit) =>
        attempt('heartbeatSettledClaim', () => {
          const run = claimed(runId, expectedId);
          if (run) change(unit, run, { heartbeatAt });
        }),
      ),
  };
}
