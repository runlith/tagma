import type { Effect } from 'effect';
import type { ProjectionRow, SelectionRow } from '../../platform/contract/service/projections.js';
import type { recordRows } from '../../thread-record/store/table.js';
import type { RecapStatus, ThreadRecap } from '../../thread-record/contract/wire/recap.js';
import type { nativeRows } from '../store/kernel.js';
import type { mandateRows } from '../store/mandate.js';
import type { ExternalSession } from '../contract/wire/harness/externalSession.js';
import type { ThreadAncestry } from '../contract/service/rows.js';
import type { activityInput, heldRows, latestInput, outcomeInput } from './inputs.js';
import type { SummaryRow } from './summary.js';

type Activity = SelectionRow<typeof activityInput.columns>;

export type HeldRow = {
  at: number;
  record: ProjectionRow<typeof recordRows.columns>;
  native: ProjectionRow<typeof nativeRows.columns>;
  mandate: ProjectionRow<typeof mandateRows.columns>;
  facet: ExternalSession | null;
  seen: string | null;
  root: string | null;
  active: Activity | null;
  outcome: SelectionRow<typeof outcomeInput.columns> | null;
  latest: SelectionRow<typeof latestInput.columns> | null;
  appeared: number | null;
  owing: boolean;
  ancestry: ThreadAncestry;
};

export type HeldBirth = {
  record?: ProjectionRow<typeof recordRows.columns>;
  native?: ProjectionRow<typeof nativeRows.columns>;
  mandate?: ProjectionRow<typeof mandateRows.columns>;
  facet?: ExternalSession;
  root?: string | null;
};

const liveRootAt = (path: ThreadAncestry): number => {
  let at = 0;
  while (at + 1 < path.length && path[at + 1]!.archived === null) at += 1;
  return at;
};

const spellOf = (path: ThreadAncestry): Date | null => {
  const spell = path[liveRootAt(path)]?.spell ?? null;
  return spell === null ? null : new Date(spell);
};

const recapStatusOf = (recap: ThreadRecap | null, appeared: number | null): RecapStatus | null =>
  recap === null ? null : recap.voided ? 'void' : appeared !== null && appeared > recap.basis.position ? 'stale' : 'current';

export const activeOf = (selected: Activity | null): Activity | null => (selected === null || selected.runId === null ? null : selected);

export const heldOf = (row: Effect.Success<ReturnType<typeof heldRows>>[number], at: number): HeldRow => ({
  at,
  record: row.record,
  native: row.native,
  mandate: row.mandate,
  facet: row.facet,
  seen: row.seen,
  root: row.root,
  active: activeOf(row.activity),
  outcome: row.outcome,
  latest: row.latest,
  appeared: row.recap?.appeared ?? null,
  owing: row.owing?.owing ?? false,
  ancestry: row.ancestry?.path ?? [],
});

export const rowOf = (held: HeldRow): SummaryRow => {
  const { record, native, mandate, active, outcome } = held;
  return {
    thread: {
      id: record.id,
      ownerId: record.principalId,
      agentId: record.agentId,
      parentThreadId: record.parentId,
      spawnedByRunId: record.spawnedByRunId,
      bornOf: record.bornOf,
      spawnRootId: record.spawnRootId,
      cacheGroup: native.cacheGroup,
      name: record.name,
      budgetTokens: mandate.budgetTokens,
      profile: native.profile,
      authority: mandate.authority,
      plain: mandate.plain,
      hostKind: mandate.hostKind,
      hostId: mandate.hostId,
      bindings: mandate.bindings,
      pendingInteraction: native.pendingInteraction,
      account: native.account,
      provider: native.provider,
      model: native.model,
      reasoning: native.reasoning,
      switches: native.switches,
      transport: native.transport,
      capabilities: native.capabilities,
      status: record.status,
      failureReason: native.failureReason,
      contextReading: native.contextReading,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
      updatedAt: native.updatedAt,
    },
    title: record.title,
    titleOrigin: record.titleOrigin,
    createdBySessionId: record.createdBySessionId,
    harness: held.facet,
    projectId: record.projectId!,
    scopeBlockUuid: record.scopeBlockUuid,
    readerOrderAt: record.readerOrderAt,
    liveSpellStartedAt: spellOf(held.ancestry),
    pinnedAt: record.pinnedAt,
    folderId: record.folderId,
    archivedAt: record.archivedAt,
    detachedFrom: record.detachedFrom,
    runId: active?.runId ?? null,
    runStatus: active?.runStatus ?? null,
    heartbeatAt: active?.heartbeatAt ?? null,
    handedOverAt: active?.handedOverAt ?? null,
    runResumes: active?.resumes ?? null,
    runStartedAt: active?.startedAt ?? null,
    progress: active?.progress ?? null,
    runProvider: active?.runProvider ?? null,
    runModel: active?.runModel ?? null,
    runReasoning: active?.runReasoning ?? null,
    outcomeRunId: outcome?.id ?? null,
    outcomeStatus: outcome?.status ?? null,
    outcomeFailureReason: outcome?.failureReason ?? null,
    outcomeFailure: outcome?.failure ?? null,
    outcomeProvider: outcome?.provider ?? null,
    outcomeModel: outcome?.model ?? null,
    outcomeReasoning: outcome?.reasoning ?? null,
    outcomeFinishedAt: outcome?.finishedAt ?? null,
    seenRunId: held.seen,
    said: active !== null ? active.saidLive : outcome?.status === 'completed' ? outcome.saidFinal : null,
    recap: record.recap,
    recapStatus: recapStatusOf(record.recap, held.appeared),
  };
};
