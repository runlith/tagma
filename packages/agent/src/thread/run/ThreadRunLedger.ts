import { Context, Effect, Layer } from 'effect';
import type { ThreadFailureDiagnostics } from '../../transcript/entries';
import type { RunTerminalStatus } from '../../transcript/live';
import type { ThreadRunStoppedBy } from '../ending';
import type { ThreadRunKind, ThreadRunRow } from '../rows';
import type { HostedResume, ThreadAbandonedRun, ThreadRunReapResult, ThreadRunReapSelector, ThreadSettledClaim } from '../storage/runs';
import type { ThreadBorderFailed, ThreadPortFailure } from '../ThreadBorder';
import { type ThreadTx, ThreadOwner, ThreadRunStoreFactory } from '../ThreadPorts';

export type ParkedTakeUp = { readonly runId: string | null; readonly release: () => void };

export type RunOwnership = {
  launchable(runId: string): boolean;
  adopt(candidate: ThreadAbandonedRun): Effect.Effect<HostedResume, ThreadBorderFailed>;
  resumeParked(threadId: string): Effect.Effect<ParkedTakeUp, ThreadPortFailure>;
  dropped(threadId: string, failure: string): Effect.Effect<boolean, ThreadBorderFailed>;
};

export type ThreadRunRef = {
  readonly id: string;
  readonly threadId: string;
};

export type ThreadRunSettled = {
  readonly runId: string;
  readonly threadId: string;
  readonly kind: ThreadRunKind;
  readonly status: RunTerminalStatus;
  readonly failureReason: string | null;
  readonly failure: ThreadFailureDiagnostics | null;
  readonly stoppedBy: ThreadRunStoppedBy | null;
};

export function settledOutcome(event: ThreadRunSettled): RunTerminalStatus {
  return event.kind === 'keep-warm' ? 'completed' : event.status;
}

export const settledEvent = (settled: ThreadRunRow | ThreadSettledClaim): ThreadRunSettled => ({
  runId: settled.id,
  threadId: settled.threadId,
  kind: settled.kind,
  status: settled.status as RunTerminalStatus,
  failureReason: settled.failureReason,
  failure: settled.failure,
  stoppedBy: settled.status === 'aborted' || settled.status === 'withdrawn' ? settled.settledBy : null,
});

export class ThreadRunLedger extends Context.Service<
  ThreadRunLedger,
  {
    runById(runId: string): Effect.Effect<ThreadRunRow | null, ThreadPortFailure>;
    isRunning(runId: string): Effect.Effect<boolean, ThreadPortFailure>;
    runningHere(runIds: readonly string[]): Effect.Effect<readonly string[], ThreadPortFailure>;
    activeRun(threadId: string): Effect.Effect<ThreadRunRow | null, ThreadPortFailure>;
    activeRunIn(threadId: string, tx: ThreadTx): Effect.Effect<ThreadRunRow | null, ThreadPortFailure>;
    runningOf(threadIds: readonly string[], tx?: ThreadTx): Effect.Effect<readonly ThreadRunRow[], ThreadPortFailure>;
    latestRun(
      threadId: string,
      statuses?: readonly ThreadRunRow['status'][],
      tx?: ThreadTx,
    ): Effect.Effect<ThreadRunRow | null, ThreadPortFailure>;
    runsOf(threadId: string): Effect.Effect<readonly ThreadRunRow[], ThreadPortFailure>;
    latestRuns(threadIds: readonly string[]): Effect.Effect<readonly ThreadRunRow[], ThreadPortFailure>;
    reapable(selector: ThreadRunReapSelector, limit?: number): Effect.Effect<readonly ThreadRunReapResult[], ThreadPortFailure>;
  }
>()('@runlith/agent/ThreadRunLedger') {}

export const threadRunLedgerLayer: Layer.Layer<ThreadRunLedger, never, ThreadOwner | ThreadRunStoreFactory> = Layer.effect(
  ThreadRunLedger,
  Effect.gen(function* () {
    const runs = (yield* ThreadRunStoreFactory).create((yield* ThreadOwner).id);
    return ThreadRunLedger.of({
      runById: (runId) => runs.runById(runId),
      isRunning: (runId) => runs.isRunning(runId),
      runningHere: (runIds) => runs.runningHere(runIds),
      activeRun: (threadId) => runs.latestRun(threadId, ['running']),
      activeRunIn: (threadId, tx) => runs.latestRun(threadId, ['running'], tx),
      runningOf: (threadIds, tx) => runs.runningOf(threadIds, tx),
      latestRun: (threadId, statuses, tx) => runs.latestRun(threadId, statuses, tx),
      runsOf: (threadId) => runs.runsOf(threadId),
      latestRuns: (threadIds) => runs.latestRuns(threadIds),
      reapable: (selector, limit) => runs.reapableRuns(selector, limit),
    });
  }),
);
