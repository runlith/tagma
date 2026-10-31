import { Effect } from 'effect';
import type { ThreadPortFailure } from '../../ThreadBorder';
import { attempt } from './attempt';
import { uuidv7 } from 'uuidv7';
import { sumUsage } from '@runlith/llm/schema/events';
import { utf8Order } from '@runlith/utils/utf8';
import { ThreadNotFoundError } from '../aggregate';
import {
  THREAD_RUN_AWAITING_QUESTION_STAGE,
  ThreadRunConflictError,
  ThreadRunKeyReusedError,
  type ThreadRunReapSelector,
  type ThreadRunStorage,
  type ThreadRunStopAsked,
} from '../runs';
import { mergedStopRequest, seedThreadNotification } from '../settlement';
import type { ThreadRunProgress, ThreadRunStage } from '../../rows';
import type { HeldRun, MemoryRunsInput } from './state';
import { newestSettled, viewOf } from './runViews';
import { makeMemorySettledRuns, type MemorySettledRuns } from './ThreadSettledRuns';
import type { MemoryTx } from './units';

export function makeMemoryRuns({ memory, ownerId, scope }: MemoryRunsInput): ThreadRunStorage<MemoryTx> {
  const settled: MemorySettledRuns = makeMemorySettledRuns({ memory, ownerId, scope });
  const heldRuns = (threadId: string): HeldRun[] => [...memory.runs.values()].filter((run) => run.threadId === threadId);
  const oldestFirst = (left: HeldRun, right: HeldRun): number =>
    left.createdAt.getTime() - right.createdAt.getTime() || utf8Order(left.id, right.id);
  const keyed = (threadId: string, key: string): HeldRun | undefined => heldRuns(threadId).find((run) => run.startKey === key);
  const owned = (runId: string): HeldRun | undefined => {
    const run = memory.runs.get(runId);
    return run && run.status === 'running' && run.ownerId === ownerId ? run : undefined;
  };
  const inScope = (run: HeldRun): boolean => memory.held(run.threadId)?.scope === scope;
  const reapable = (run: HeldRun, selector: ThreadRunReapSelector): boolean => {
    if (run.status !== 'running' || run.progress.stage === THREAD_RUN_AWAITING_QUESTION_STAGE || !inScope(run)) return false;
    if (selector.kind === 'handed-over') return run.ownerId !== ownerId && run.handedOverAt !== null;
    if (selector.kind === 'dropped') return run.ownerId === ownerId;
    const silent = run.heartbeatAt.getTime() < selector.heartbeatBefore.getTime();
    return selector.kind === 'foreign-owner'
      ? run.ownerId !== ownerId && run.handedOverAt === null && silent
      : run.ownerId === ownerId && silent;
  };
  const change = (unit: MemoryTx, run: HeldRun, patch: Partial<HeldRun>): HeldRun => {
    const next: HeldRun = {
      ...run,
      ...patch,
      receipt: patch.status !== undefined && patch.status !== 'running' ? null : patch.receipt === undefined ? run.receipt : patch.receipt,
      updatedAt: patch.updatedAt ?? unit.now(),
    };
    unit.put(memory.runs, run.id, next);
    return next;
  };
  const stageOf = (stage: ThreadRunStage): ThreadRunStage =>
    stage.halt === undefined
      ? { stage: stage.stage, message: stage.message }
      : { stage: stage.stage, message: stage.message, halt: stage.halt };
  const staged = (run: HeldRun, stage: ThreadRunStage): ThreadRunProgress =>
    run.progress.phase === undefined ? stageOf(stage) : { ...stageOf(stage), phase: run.progress.phase };
  const patched = (runId: string, patch: Partial<HeldRun>, tx?: MemoryTx): Effect.Effect<void, ThreadPortFailure> =>
    memory.units.commit(
      (unit) =>
        attempt('patched', () => {
          const run = owned(runId);
          if (run) change(unit, run, patch);
        }),
      tx,
    );
  const closed = (unit: MemoryTx, run: HeldRun): void => {
    const thread = memory.held(run.threadId);
    if (!thread) return;
    unit.keep(thread);
    if (thread.runningRunId === run.id) thread.runningRunId = null;
    const at = thread.ended.findIndex((id) => {
      const standing = memory.runs.get(id);
      return standing !== undefined && newestSettled(standing, run) > 0;
    });
    thread.ended.splice(at === -1 ? thread.ended.length : at, 0, run.id);
  };

  return {
    ...settled,
    ownerId,
    createRun: (input, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('createRun', () => {
            const { startFrom, kind, approval, progress, startKey, runId, origin } = input;
            const thread = memory.held(startFrom.id);
            if (!thread) throw new ThreadNotFoundError(startFrom.id);
            const standing = startKey === undefined ? undefined : keyed(startFrom.id, startKey.key);
            if (standing && startKey) {
              if (standing.startDigest !== null && standing.startDigest !== startKey.digest)
                throw new ThreadRunKeyReusedError({ threadId: startFrom.id, runId: standing.id });
              return { _tag: 'Replayed', run: viewOf(standing) };
            }
            const active = heldRuns(startFrom.id).find((run) => run.status === 'running');
            if (active) throw new ThreadRunConflictError({ threadId: startFrom.id, runId: active.id });
            if (runId !== undefined && memory.runs.has(runId)) throw new Error(`Thread run ${runId} already exists.`);
            const at = unit.now();
            const run: HeldRun = {
              id: runId ?? uuidv7(),
              threadId: startFrom.id,
              kind,
              origin: origin ?? 'core',
              status: 'running',
              ownerId,
              account: startFrom.account,
              provider: startFrom.provider,
              model: startFrom.model,
              reasoning: startFrom.reasoning,
              switches: startFrom.switches,
              approvalMode: approval.mode,
              interactive: approval.interactive,
              progress,
              usage: null,
              cost: null,
              streamTail: null,
              resumes: 0,
              failureReason: null,
              failure: null,
              createdAt: at,
              startedAt: at,
              heartbeatAt: at,
              handedOverAt: null,
              finishedAt: null,
              settledNotifiedAt: null,
              settledBy: null,
              stopRequest: null,
              withdrawnWords: null,
              settledNotification: null,
              settledNotifyAttempts: 0,
              updatedAt: at,
              startKey: startKey?.key ?? null,
              startDigest: startKey?.digest ?? null,
              endDigest: null,
              endResult: null,
              appliedSeq: 0,
              receipt: null,
            };
            unit.put(memory.runs, run.id, run);
            unit.keep(thread);
            thread.row = { ...thread.row, status: 'running', failureReason: null, updatedAt: at };
            thread.runningRunId = run.id;
            return { _tag: 'Started', run: viewOf(run) };
          }),
        tx,
      ),
    runByStartKey: (threadId, key, tx) =>
      attempt('runByStartKey', () =>
        memory.read(tx, () => {
          const run = keyed(threadId, key);
          return run ? viewOf(run) : null;
        }),
      ),
    runById: (runId, tx) =>
      attempt('runById', () =>
        memory.read(tx, () => {
          const run = memory.runs.get(runId);
          return run ? viewOf(run) : null;
        }),
      ),
    resumeAwaitingRun: (input) =>
      memory.units.commit((unit) =>
        attempt('resumeAwaitingRun', () => {
          const run = memory.runs.get(input.runId);
          if (
            !run ||
            run.threadId !== input.threadId ||
            run.status !== 'running' ||
            run.progress.stage !== THREAD_RUN_AWAITING_QUESTION_STAGE
          )
            throw new ThreadRunConflictError({ threadId: input.threadId, runId: input.runId });
          if (run.stopRequest !== null) return 'stopping';
          change(unit, run, { ownerId, progress: staged(run, input.progress), heartbeatAt: input.heartbeatAt, handedOverAt: null });
          return 'resumed';
        }),
      ),
    parkRun: (runId, progress, heartbeatAt, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('parkRun', () => {
            const run = owned(runId);
            if (!run) return 'gone';
            if (run.stopRequest !== null) return 'stopping';
            change(unit, run, { progress: staged(run, progress), heartbeatAt });
            return 'parked';
          }),
        tx,
      ),
    settleRun: (runId, patch, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('settleRun', () => {
            const run = owned(runId);
            if (!run) return null;
            const ended = change(unit, run, {
              status: patch.status,
              progress: patch.progress,
              failureReason: patch.failureReason === undefined ? run.failureReason : patch.failureReason,
              failure: patch.failure === undefined ? run.failure : patch.failure,
              finishedAt: patch.finishedAt,
              heartbeatAt: patch.heartbeatAt,
              settledBy: patch.settledBy ?? null,
              stopRequest: patch.stopRequest ?? run.stopRequest,
              settledNotification: seedThreadNotification(runId, patch.finishedAt, null),
              streamTail: null,
            });
            closed(unit, ended);
            return viewOf({ ...ended, streamTail: run.streamTail });
          }),
        tx,
      ),
    stopRun: (runId, patch, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('stopRun', () => {
            const run = memory.runs.get(runId);
            if (!run || run.status !== 'running' || !inScope(run)) return null;
            const request = mergedStopRequest(run.stopRequest, patch.intent, patch.finishedAt);
            const ended = change(unit, run, {
              status: 'aborted',
              ownerId,
              failureReason: null,
              failure: null,
              progress: patch.progress,
              finishedAt: patch.finishedAt,
              settledBy: request.by,
              stopRequest: request,
              settledNotification: seedThreadNotification(runId, patch.finishedAt, null),
              heartbeatAt: patch.heartbeatAt,
              streamTail: null,
            });
            closed(unit, ended);
            return viewOf({ ...ended, streamTail: run.streamTail });
          }),
        tx,
      ),
    withdrawRun: (runId, words, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('withdrawRun', () => {
            const run = memory.runs.get(runId);
            if (!run || run.status !== 'aborted' || !inScope(run)) return null;
            return viewOf(change(unit, run, { status: 'withdrawn', withdrawnWords: words }));
          }),
        tx,
      ),
    markStatus: (input, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('markStatus', () => {
            const thread = memory.held(input.threadId);
            if (!thread) return;
            if (input.status !== 'running' && heldRuns(input.threadId).some((run) => run.status === 'running')) return;
            unit.keep(thread);
            thread.row = { ...thread.row, status: input.status, failureReason: input.failureReason, updatedAt: input.updatedAt };
          }),
        tx,
      ),
    latestRun: (threadId, statuses, tx) =>
      attempt('latestRun', () =>
        memory.read(tx, () => {
          let latest: HeldRun | undefined;
          for (const run of memory.runs.values()) {
            if (run.threadId !== threadId || (statuses !== undefined && !statuses.includes(run.status))) continue;
            if (latest === undefined || oldestFirst(latest, run) < 0) latest = run;
          }
          return latest ? viewOf(latest) : null;
        }),
      ),
    latestRuns: (threadIds, tx) =>
      attempt('latestRuns', () =>
        memory.read(tx, () => {
          const wanted = new Set(threadIds);
          const latest = new Map<string, HeldRun>();
          for (const run of memory.runs.values()) {
            if (!wanted.has(run.threadId)) continue;
            const previous = latest.get(run.threadId);
            if (previous === undefined || oldestFirst(previous, run) < 0) latest.set(run.threadId, run);
          }
          return [...latest.values()].map(viewOf);
        }),
      ),
    runsOf: (threadId, tx) => attempt('runsOf', () => memory.read(tx, () => heldRuns(threadId).sort(oldestFirst).map(viewOf))),
    runningOf: (threadIds, tx) =>
      attempt('heldRuns', () =>
        memory.read(tx, () => {
          const wanted = new Set(threadIds);
          return [...memory.runs.values()].filter((run) => run.status === 'running' && wanted.has(run.threadId)).map(viewOf);
        }),
      ),
    spentBySpawnRoot: (spawnRootId, ownerId, tx) =>
      attempt('spentBySpawnRoot', () =>
        memory.read(tx, () => {
          let spent = 0;
          for (const run of memory.runs.values()) {
            const thread = memory.held(run.threadId);
            if (thread?.row.spawnRootId === spawnRootId && thread.row.ownerId === ownerId) spent += run.usage?.totalTokens ?? 0;
          }
          return spent;
        }),
      ),
    isRunning: (runId) => attempt('isRunning', () => memory.read(undefined, () => owned(runId) !== undefined)),
    runningHere: (runIds) => attempt('runningHere', () => memory.read(undefined, () => runIds.filter((id) => owned(id) !== undefined))),
    writeProgress: (runId, progress, heartbeatAt, tx, durable = false) =>
      memory.units.commit(
        (unit) =>
          attempt('writeProgress', () => {
            const run = owned(runId);
            if (run) change(unit, run, { progress: staged(run, progress), ...(durable ? { resumes: 0 } : {}), heartbeatAt });
          }),
        tx,
      ),
    writePhase: (runId, phase, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('writePhase', () => {
            const run = owned(runId);
            if (!run) return;
            const stage = stageOf(run.progress);
            change(unit, run, { progress: phase === null ? stage : { ...stage, phase } });
          }),
        tx,
      ),
    addUsage: (runId, delta, heartbeatAt, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('addUsage', () => {
            const run = owned(runId);
            if (run) change(unit, run, { usage: sumUsage(run.usage, delta), resumes: 0, heartbeatAt });
          }),
        tx,
      ),
    charge: (runId, charge, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('charge', () => {
            const run = memory.runs.get(runId);
            if (!run) return;
            change(unit, run, {
              ...(charge.usage === null ? {} : { usage: sumUsage(run.usage, charge.usage) }),
              ...(charge.cost === null ? {} : { cost: charge.cost }),
            });
          }),
        tx,
      ),
    writeHeartbeats: (runIds, heartbeatAt, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('writeHeartbeats', () => {
            const asked: ThreadRunStopAsked[] = [];
            for (const runId of runIds) {
              const run = owned(runId);
              if (!run) continue;
              change(unit, run, { heartbeatAt, updatedAt: heartbeatAt });
              if (run.stopRequest !== null) asked.push({ runId, by: run.stopRequest.by });
            }
            return asked;
          }),
        tx,
      ),
    requestStop: (runId, intent, at, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('requestStop', () => {
            const run = memory.runs.get(runId);
            if (!run || run.status !== 'running' || !inScope(run)) return null;
            const request = mergedStopRequest(run.stopRequest, intent, at);
            change(unit, run, { stopRequest: request });
            return request;
          }),
        tx,
      ),
    writeStreamTail: (runId, tail, heartbeatAt, tx, durable = false) =>
      patched(runId, { streamTail: tail, ...(durable || tail?.length ? { resumes: 0 } : {}), heartbeatAt }, tx),
    reapableRuns: (selector, limit) =>
      attempt('reapableRuns', () =>
        memory.read(undefined, () => {
          const stamp = (run: HeldRun): number => (run.handedOverAt ?? run.heartbeatAt).getTime();
          const claimable = [...memory.runs.values()]
            .filter((run) => reapable(run, selector))
            .sort((left, right) => stamp(right) - stamp(left) || left.id.localeCompare(right.id));
          return claimable.slice(0, limit).map((run) => ({
            id: run.id,
            threadId: run.threadId,
            kind: run.kind,
            handedOverAt: run.handedOverAt,
            heartbeatAt: run.heartbeatAt,
            stopRequest: run.stopRequest,
          }));
        }),
      ),
    reapRun: (runId, input, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('reapRun', () => {
            const run = memory.runs.get(runId);
            if (!run || !reapable(run, input.selector)) return null;
            const stopped = run.stopRequest;
            const ended = change(unit, run, {
              status: stopped === null ? 'failed' : 'aborted',
              ownerId,
              failureReason: stopped === null ? input.failureReason : null,
              failure: stopped === null ? (input.failure ?? null) : null,
              progress: stopped === null ? input.progress : { stage: 'aborted', message: 'Thread run stopped.' },
              finishedAt: input.finishedAt,
              settledBy: stopped?.by ?? null,
              settledNotification: seedThreadNotification(runId, input.finishedAt, null),
              heartbeatAt: input.finishedAt,
              streamTail: null,
            });
            closed(unit, ended);
            return viewOf({ ...ended, streamTail: run.streamTail });
          }),
        tx,
      ),
    handOverRuns: (runIds, at, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('handOverRuns', () => {
            for (const id of runIds) {
              const run = memory.runs.get(id);
              if (run && run.ownerId === ownerId && run.status === 'running' && run.handedOverAt === null)
                change(unit, run, { handedOverAt: at });
            }
          }),
        tx,
      ),
    cutRun: (runId, input, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('cutRun', () => {
            const run = memory.runs.get(runId);
            if (!run || !reapable(run, input.selector)) return null;
            const ended = change(unit, run, {
              status: 'cut',
              ownerId,
              failureReason: input.failureReason ?? null,
              failure: null,
              progress: input.progress,
              finishedAt: input.finishedAt,
              settledBy: null,
              settledNotification: seedThreadNotification(runId, input.finishedAt, null),
              heartbeatAt: input.finishedAt,
              streamTail: null,
            });
            closed(unit, ended);
            return viewOf({ ...ended, streamTail: run.streamTail });
          }),
        tx,
      ),
    adoptRun: (runId, input, tx) =>
      memory.units.commit(
        (unit) =>
          attempt('adoptRun', () => {
            const run = memory.runs.get(runId);
            const handedOver = input.selector.kind === 'handed-over';
            if (!run || !reapable(run, input.selector) || run.stopRequest !== null || (!handedOver && run.resumes >= input.maxResumes))
              return null;
            const adopted = change(unit, run, {
              ownerId,
              progress: staged(run, input.progress),
              heartbeatAt: input.heartbeatAt,
              resumes: handedOver ? run.resumes : run.resumes + 1,
              streamTail: null,
              handedOverAt: null,
            });
            const thread = memory.held(run.threadId);
            if (thread && thread.runningRunId !== run.id) {
              unit.keep(thread);
              thread.runningRunId = run.id;
            }
            return viewOf({ ...adopted, streamTail: run.streamTail });
          }),
        tx,
      ),
  };
}
