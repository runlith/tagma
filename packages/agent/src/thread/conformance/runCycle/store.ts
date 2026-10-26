import { Effect } from 'effect';
import type { ThreadRunRow } from '../../rows';
import { ThreadStorageFailed } from '../../persisted';
import { MemoryTx } from '../../storage/memory/units';
import { mergedStopRequest } from '../../storage/settlement';
import { ThreadRunConflictError, type ThreadRunReapSelector, type ThreadRunStorage } from '../../storage/runs';
import type { ThreadTx, ThreadWriteTx } from '../../ThreadPorts';
import { runRow, unreadRuns } from './runDoubles';

export function runStore(initial: readonly ThreadRunRow[] = [runRow('run-1')]) {
  const rows = new Map(initial.map((row) => [row.id, row]));
  const threadStatus = new Map<string, string>();
  const faults: { requestStop: ThreadStorageFailed | null; create: ThreadRunConflictError | null; mark: ThreadStorageFailed | null } = {
    requestStop: null,
    create: null,
    mark: null,
  };
  const put = <K, V>(into: Map<K, V>, key: K, value: V, tx?: ThreadWriteTx) =>
    Effect.suspend(() => {
      if (tx === undefined)
        return Effect.sync(() => {
          into.set(key, value);
        });
      if (tx instanceof MemoryTx) return Effect.sync(() => tx.put(into, key, value));
      return Effect.fail(new ThreadStorageFailed({ call: 'run.write', cause: new Error('These runs use memory write units.') }));
    });
  const eligible = (row: ThreadRunRow, selector: ThreadRunReapSelector) => {
    if (row.status !== 'running' || row.progress.stage === 'awaiting-question') return false;
    if (selector.kind === 'handed-over') return row.ownerId !== unreadRuns.ownerId && row.handedOverAt !== null;
    if (selector.kind === 'dropped') return row.ownerId === unreadRuns.ownerId;
    if (row.heartbeatAt >= selector.heartbeatBefore) return false;
    return selector.kind === 'stale-heartbeat'
      ? row.ownerId === unreadRuns.ownerId
      : row.ownerId !== unreadRuns.ownerId && row.handedOverAt === null;
  };
  const runs: ThreadRunStorage<ThreadTx, ThreadWriteTx> = {
    ...unreadRuns,
    createRun: Effect.fnUntraced(function* (input, tx) {
      if (faults.create) return yield* faults.create;
      const active = [...rows.values()].find((row) => row.threadId === input.startFrom.id && row.status === 'running');
      if (active) return yield* new ThreadRunConflictError({ threadId: active.threadId, runId: active.id });
      const row = runRow(input.runId ?? 'run-1', {
        threadId: input.startFrom.id,
        kind: input.kind,
        provider: input.startFrom.provider,
        model: input.startFrom.model,
        approvalMode: input.approval.mode,
        interactive: input.approval.interactive,
        progress: input.progress,
      });
      yield* put(rows, row.id, row, tx);
      return { _tag: 'Started', run: row };
    }),
    runByStartKey: () => Effect.succeed(null),
    runById: (id) => Effect.sync(() => rows.get(id) ?? null),
    latestRun: (threadId, statuses) =>
      Effect.sync(
        () =>
          [...rows.values()].findLast((row) => row.threadId === threadId && (statuses === undefined || statuses.includes(row.status))) ??
          null,
      ),
    isRunning: (id) => Effect.sync(() => rows.get(id)?.status === 'running' && rows.get(id)?.ownerId === runs.ownerId),
    runningHere: (ids) =>
      Effect.sync(() => ids.filter((id) => rows.get(id)?.status === 'running' && rows.get(id)?.ownerId === runs.ownerId)),
    settleRun: Effect.fnUntraced(function* (id, patch, tx) {
      const row = rows.get(id);
      if (!row || row.status !== 'running') return null;
      const next = { ...row, ...patch };
      yield* put(rows, id, next, tx);
      return next;
    }),
    requestStop: Effect.fnUntraced(function* (id, intent, at, tx) {
      if (faults.requestStop) return yield* faults.requestStop;
      const row = rows.get(id);
      if (!row || row.status !== 'running') return null;
      const stopRequest = mergedStopRequest(row.stopRequest, intent, at);
      yield* put(rows, id, { ...row, stopRequest }, tx);
      return stopRequest;
    }),
    stopRun: Effect.fnUntraced(function* (id, patch, tx) {
      const row = rows.get(id);
      if (!row || row.status !== 'running') return null;
      const { intent, ...ending } = patch;
      const stopRequest = mergedStopRequest(row.stopRequest, intent, patch.finishedAt);
      const next: ThreadRunRow = { ...row, ...ending, stopRequest, status: 'aborted', settledBy: stopRequest.by };
      yield* put(rows, id, next, tx);
      return next;
    }),
    withdrawRun: Effect.fnUntraced(function* (id, words, tx) {
      const row = rows.get(id);
      if (!row || row.status !== 'aborted') return null;
      const next = { ...row, status: 'withdrawn' as const, withdrawnWords: words };
      yield* put(rows, id, next, tx);
      return next;
    }),
    parkRun: Effect.fnUntraced(function* (id, progress, heartbeatAt, tx) {
      const row = rows.get(id);
      if (!row || row.status !== 'running') return 'gone';
      if (row.stopRequest) return 'stopping';
      yield* put(rows, id, { ...row, progress, heartbeatAt }, tx);
      return 'parked';
    }),
    resumeAwaitingRun: Effect.fnUntraced(function* (input) {
      const row = rows.get(input.runId);
      if (!row || row.status !== 'running') return yield* new ThreadRunConflictError({ threadId: input.threadId, runId: input.runId });
      if (row.stopRequest) return 'stopping';
      yield* put(rows, row.id, { ...row, progress: input.progress, heartbeatAt: input.heartbeatAt });
      return 'resumed';
    }),
    markStatus: Effect.fnUntraced(function* (input, tx) {
      yield* put(threadStatus, input.threadId, input.status, tx);
      if (faults.mark) return yield* faults.mark;
    }),
    handOverRuns: (ids, at, tx) =>
      Effect.forEach(
        ids,
        (id) => {
          const row = rows.get(id);
          return row?.status === 'running' ? put(rows, id, { ...row, handedOverAt: at }, tx) : Effect.void;
        },
        { discard: true },
      ),
    reapableRuns: (selector, limit) =>
      Effect.sync(() =>
        [...rows.values()]
          .filter((row) => eligible(row, selector))
          .slice(0, limit)
          .map((row) => ({
            id: row.id,
            threadId: row.threadId,
            kind: row.kind,
            handedOverAt: row.handedOverAt,
            heartbeatAt: row.heartbeatAt,
            stopRequest: row.stopRequest,
          })),
      ),
    cutRun: Effect.fnUntraced(function* (id, patch, tx) {
      const row = rows.get(id);
      if (!row || !eligible(row, patch.selector)) return null;
      const next: ThreadRunRow = { ...row, ...patch, status: 'cut' };
      yield* put(rows, id, next, tx);
      return next;
    }),
    reapRun: Effect.fnUntraced(function* (id, patch, tx) {
      const row = rows.get(id);
      if (!row || !eligible(row, patch.selector)) return null;
      const next: ThreadRunRow = {
        ...row,
        ...patch,
        status: row.stopRequest ? 'aborted' : 'failed',
        settledBy: row.stopRequest?.by ?? null,
      };
      yield* put(rows, id, next, tx);
      return next;
    }),
    adoptRun: Effect.fnUntraced(function* (id, patch, tx) {
      const row = rows.get(id);
      if (
        !row ||
        !eligible(row, patch.selector) ||
        row.stopRequest !== null ||
        (patch.selector.kind !== 'handed-over' && row.resumes >= patch.maxResumes)
      )
        return null;
      const next = {
        ...row,
        ownerId: runs.ownerId,
        progress: patch.progress,
        heartbeatAt: patch.heartbeatAt,
        handedOverAt: null,
        resumes: patch.selector.kind === 'handed-over' ? row.resumes : row.resumes + 1,
      };
      yield* put(rows, id, next, tx);
      return next;
    }),
    claimSettledForNotification: () => Effect.succeed({ claims: [], exhausted: [] }),
    writeSettledNotification: (id, record, expectedId) =>
      Effect.sync(() => {
        const row = rows.get(id);
        if (!row || (row.settledNotification?.id ?? null) !== expectedId) return false;
        rows.set(id, { ...row, settledNotification: record });
        return true;
      }),
    markSettledNotified: (id, notifiedAt, record) =>
      Effect.sync(() => {
        const row = rows.get(id);
        if (!row || row.settledNotification?.id !== record?.id) return false;
        rows.set(id, { ...row, settledNotification: record, settledNotifiedAt: notifiedAt });
        return true;
      }),
    heartbeatSettledClaim: (id, heartbeatAt, expectedId) =>
      Effect.sync(() => {
        const row = rows.get(id);
        if (row?.settledNotification?.id === expectedId) rows.set(id, { ...row, heartbeatAt });
      }),
  };
  return { runs, rows, threadStatus, faults };
}
