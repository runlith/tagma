import { Data, type Effect } from 'effect';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { Usage } from '@runlith/llm/schema/events';
import type { ThreadNotificationRecord, ThreadRunStopRequest } from './settlement';
import type { AgentApproval } from '../../agent/contracts';
import type { AgentPhase } from '../../agent/AgentPhase';
import type { ThreadRunCost, ThreadRunKind, ThreadRunProgress, ThreadRunRow, ThreadRunStage, ThreadRunStatus } from '../rows';
import type { RunStage } from '../../transcript/live';
import type { ThreadTranscript } from '../../transcript/rows';
import type { WithdrawnWords } from '../../transcript/entries';
import type { ThreadBorderFailed, ThreadPortFailure } from '../ThreadBorder';

export const THREAD_RUN_AWAITING_QUESTION_STAGE = 'awaiting-question' satisfies RunStage;
export const THREAD_RUN_RESUMING_STAGE = 'resuming' satisfies RunStage;

export type ThreadRunStartFrom = {
  readonly id: string;
  readonly ownerId: string;
  readonly account: string | null;
  readonly provider: ThreadRunRow['provider'];
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly switches: ModelSwitches;
};

export type ThreadRunSettlePatch = {
  readonly status: 'completed' | 'failed' | 'aborted';
  readonly progress: ThreadRunProgress;
  readonly failureReason?: string | null;
  readonly failure?: ThreadRunRow['failure'];
  readonly settledBy?: ThreadRunRow['settledBy'];
  readonly stopRequest?: ThreadRunStopRequest;
  readonly finishedAt: Date;
  readonly heartbeatAt: Date;
};

export type ThreadRunStopAsked = { readonly runId: string; readonly by: ThreadRunRow['settledBy'] };

export type ThreadRunHeartbeat = {
  readonly id: string;
  readonly threadId: string;
  readonly heartbeatAt: Date;
  readonly updatedAt: Date;
};

export type ThreadRunPhase = {
  readonly id: string;
  readonly threadId: string;
  readonly progress: ThreadRunProgress;
  readonly updatedAt: Date;
};

type ThreadRunHeartbeats = {
  readonly written: readonly ThreadRunHeartbeat[];
  readonly asked: readonly ThreadRunStopAsked[];
};

export type ThreadRunStopIntent = {
  readonly by: ThreadRunRow['settledBy'];
  readonly key?: string;
  readonly marker: boolean;
  readonly withdraw: boolean;
};

export type ThreadRunStopPatch = {
  readonly intent: ThreadRunStopIntent;
  readonly progress: ThreadRunProgress;
  readonly finishedAt: Date;
  readonly heartbeatAt: Date;
};

export type ThreadRunStart =
  | { readonly _tag: 'Started'; readonly run: ThreadRunRow }
  | { readonly _tag: 'Replayed'; readonly run: ThreadRunRow };

export type ThreadRunParking = 'parked' | 'stopping' | 'gone';

export type ThreadRunResumption = 'resumed' | 'stopping';

export type ThreadRunReapPatch = {
  readonly failureReason: string;
  readonly failure?: ThreadRunRow['failure'];
  readonly progress: ThreadRunProgress;
  readonly finishedAt: Date;
};

export type ThreadRunCutPatch = {
  readonly failureReason?: string;
  readonly progress: ThreadRunProgress;
  readonly finishedAt: Date;
};

//! Spend the vendor billed lands on the run in any status: a turn can report it after the core ended the run.
export type ThreadRunCharge = {
  readonly usage: Usage | null;
  readonly cost: ThreadRunCost | null;
};

export type ThreadRunAdoptPatch = {
  readonly progress: ThreadRunStage;
  readonly heartbeatAt: Date;
};

export type ThreadRunReapSelector =
  | { readonly kind: 'handed-over' }
  | { readonly kind: 'foreign-owner'; readonly heartbeatBefore: Date }
  | { readonly kind: 'stale-heartbeat'; readonly heartbeatBefore: Date }
  | { readonly kind: 'dropped'; readonly failure: string };

export type ThreadRunReapResult = {
  readonly id: string;
  readonly threadId: string;
  readonly kind: ThreadRunKind;
  readonly handedOverAt: Date | null;
  readonly heartbeatAt: Date;
  readonly stopRequest: ThreadRunStopRequest | null;
};

export type ThreadSettledClaim = {
  readonly id: string;
  readonly threadId: string;
  readonly kind: ThreadRunKind;
  readonly status: ThreadRunRow['status'];
  readonly failureReason: ThreadRunRow['failureReason'];
  readonly failure: ThreadRunRow['failure'];
  readonly settledBy: ThreadRunRow['settledBy'];
  readonly settledNotification: ThreadNotificationRecord | null;
  readonly attempt: number;
};

export type ThreadSettledExhaustion = {
  readonly id: string;
  readonly threadId: string;
  readonly attempts: number;
  readonly delivered: readonly string[];
};

export type ThreadSettledClaims = {
  readonly claims: readonly ThreadSettledClaim[];
  readonly exhausted: readonly ThreadSettledExhaustion[];
};

export type ThreadSettledPosition = { readonly finishedAt: Date; readonly id: string };

export type ThreadSettledClaimInput = {
  readonly heartbeatBefore: Date;
  readonly now: Date;
  readonly limit: number;
  readonly maxAttempts: number;
};

export type ThreadSettledQuery = {
  readonly threadIds: readonly string[];
  readonly limit: number;
  readonly after?: ThreadSettledPosition;
};

export type ThreadSettledPage = { readonly rows: readonly ThreadRunRow[]; readonly total: number };

export type ThreadRunStartKey = { readonly key: string; readonly digest: string };

export type ThreadRunCreate = {
  readonly startFrom: ThreadRunStartFrom;
  readonly kind: ThreadRunKind;
  readonly approval: AgentApproval;
  readonly progress: ThreadRunProgress;
  readonly startKey?: ThreadRunStartKey;
  readonly runId?: string;
  readonly origin?: 'observed';
};

export interface ThreadRunStorage<TTx, TWrite extends TTx = TTx> {
  readonly ownerId: string;

  createRun(input: ThreadRunCreate, tx?: TWrite): Effect.Effect<ThreadRunStart, ThreadPortFailure>;

  runByStartKey(threadId: string, key: string, tx?: TTx): Effect.Effect<ThreadRunRow | null, ThreadPortFailure>;

  runById(runId: string, tx?: TTx): Effect.Effect<ThreadRunRow | null, ThreadPortFailure>;

  resumeAwaitingRun(input: {
    threadId: string;
    runId: string;
    progress: ThreadRunStage;
    heartbeatAt: Date;
  }): Effect.Effect<ThreadRunResumption, ThreadPortFailure>;

  parkRun(runId: string, progress: ThreadRunStage, heartbeatAt: Date, tx?: TWrite): Effect.Effect<ThreadRunParking, ThreadPortFailure>;

  settleRun(runId: string, patch: ThreadRunSettlePatch, tx?: TWrite): Effect.Effect<ThreadRunRow | null, ThreadPortFailure>;

  stopRun(runId: string, patch: ThreadRunStopPatch, tx?: TWrite): Effect.Effect<ThreadRunRow | null, ThreadPortFailure>;

  withdrawRun(runId: string, words: WithdrawnWords | null, tx?: TWrite): Effect.Effect<ThreadRunRow | null, ThreadPortFailure>;

  markStatus(
    input: {
      threadId: string;
      status: 'idle' | 'running' | 'failed';
      failureReason: string | null;
      updatedAt: Date;
    },
    tx?: TWrite,
  ): Effect.Effect<void, ThreadPortFailure>;

  latestRun(
    threadId: string,
    statuses?: readonly ThreadRunRow['status'][],
    tx?: TTx,
  ): Effect.Effect<ThreadRunRow | null, ThreadPortFailure>;

  runsOf(threadId: string, tx?: TTx): Effect.Effect<readonly ThreadRunRow[], ThreadPortFailure>;

  latestRuns(threadIds: readonly string[], tx?: TTx): Effect.Effect<readonly ThreadRunRow[], ThreadPortFailure>;

  runningOf(threadIds: readonly string[], tx?: TTx): Effect.Effect<readonly ThreadRunRow[], ThreadPortFailure>;

  spentBySpawnRoot(spawnRootId: string, ownerId: string, tx?: TTx): Effect.Effect<number, ThreadPortFailure>;

  isRunning(runId: string): Effect.Effect<boolean, ThreadPortFailure>;

  runningHere(runIds: readonly string[]): Effect.Effect<readonly string[], ThreadPortFailure>;

  writeProgress(
    runId: string,
    progress: ThreadRunStage,
    heartbeatAt: Date,
    tx?: TWrite,
    durable?: boolean,
  ): Effect.Effect<void, ThreadPortFailure>;
  writePhase(runId: string, phase: AgentPhase | null, tx?: TWrite): Effect.Effect<readonly ThreadRunPhase[], ThreadPortFailure>;
  addUsage(runId: string, delta: Usage, heartbeatAt: Date, tx?: TWrite): Effect.Effect<void, ThreadPortFailure>;
  charge(runId: string, charge: ThreadRunCharge, tx?: TWrite): Effect.Effect<void, ThreadPortFailure>;
  writeHeartbeats(runIds: readonly string[], heartbeatAt: Date, tx?: TWrite): Effect.Effect<ThreadRunHeartbeats, ThreadPortFailure>;

  requestStop(
    runId: string,
    intent: ThreadRunStopIntent,
    at: Date,
    tx?: TWrite,
  ): Effect.Effect<ThreadRunStopRequest | null, ThreadPortFailure>;

  writeStreamTail(
    runId: string,
    tail: ThreadTranscript | null,
    heartbeatAt: Date,
    tx?: TWrite,
    durable?: boolean,
  ): Effect.Effect<void, ThreadPortFailure>;

  reapableRuns(selector: ThreadRunReapSelector, limit?: number): Effect.Effect<readonly ThreadRunReapResult[], ThreadPortFailure>;

  reapRun(
    runId: string,
    input: { selector: ThreadRunReapSelector } & ThreadRunReapPatch,
    tx?: TWrite,
  ): Effect.Effect<ThreadRunRow | null, ThreadPortFailure>;

  handOverRuns(runIds: readonly string[], at: Date, tx?: TWrite): Effect.Effect<void, ThreadPortFailure>;

  cutRun(
    runId: string,
    input: { selector: ThreadRunReapSelector } & ThreadRunCutPatch,
    tx?: TWrite,
  ): Effect.Effect<ThreadRunRow | null, ThreadPortFailure>;

  adoptRun(
    runId: string,
    input: { selector: ThreadRunReapSelector; maxResumes: number } & ThreadRunAdoptPatch,
    tx?: TWrite,
  ): Effect.Effect<ThreadRunRow | null, ThreadPortFailure>;

  claimSettledForNotification(input: ThreadSettledClaimInput): Effect.Effect<ThreadSettledClaims, ThreadPortFailure>;

  writeSettledNotification(
    runId: string,
    record: ThreadNotificationRecord,
    expectedId: string | null,
  ): Effect.Effect<boolean, ThreadPortFailure>;
  markSettledNotified(runId: string, notifiedAt: Date, record: ThreadNotificationRecord | null): Effect.Effect<boolean, ThreadPortFailure>;
  heartbeatSettledClaim(runId: string, heartbeatAt: Date, expectedId: string | null): Effect.Effect<void, ThreadPortFailure>;
  redeliverSettled(runId: string, maxAttempts: number): Effect.Effect<boolean, ThreadPortFailure>;

  settledRuns(input: ThreadSettledQuery): Effect.Effect<ThreadSettledPage, ThreadPortFailure>;
  newestSettled(threadIds: readonly string[], depth: number, tx?: TTx): Effect.Effect<readonly ThreadRunRow[], ThreadPortFailure>;
}

export class ThreadRunNotInterruptedError extends Data.TaggedError('ThreadRunNotInterrupted')<{
  readonly message: string;
  readonly threadId: string;
  readonly status: ThreadRunStatus | null;
}> {
  constructor(input: { threadId: string; status: ThreadRunStatus | null }) {
    super({
      message:
        input.status === null
          ? 'This thread has no run to continue.'
          : `This thread's newest run ${input.status}; Continue takes up a run that was cut, stopped or broke.`,
      threadId: input.threadId,
      status: input.status,
    });
    this.name = 'ThreadRunNotInterruptedError';
  }
}

export class ThreadRunHeldError extends Data.TaggedError('ThreadRunHeld')<{ readonly message: string; readonly threadId: string }> {
  constructor(input: { threadId: string }) {
    super({ message: `The work of ${input.threadId} is being landed right now, so no run of it may open.`, threadId: input.threadId });
    this.name = 'ThreadRunHeldError';
  }
}

export class ThreadRunNotHeldError extends Data.TaggedError('ThreadRunNotHeld')<{
  readonly message: string;
  readonly threadId: string;
  readonly runId: string;
}> {
  constructor(input: { threadId: string; runId: string }) {
    super({
      message: `This server does not hold run ${input.runId} of ${input.threadId} yet: a run its previous server left is taken up within the lease, and only the server holding it answers its calls.`,
      threadId: input.threadId,
      runId: input.runId,
    });
    this.name = 'ThreadRunNotHeldError';
  }
}

export class ThreadRunConflictError extends Data.TaggedError('ThreadRunConflict')<{
  readonly message: string;
  readonly threadId: string;
  readonly runId: string;
}> {
  constructor(input: { threadId: string; runId: string }) {
    super({ message: `A thread run is already active for ${input.threadId}.`, threadId: input.threadId, runId: input.runId });
    this.name = 'ThreadRunConflictError';
  }
}

export class ThreadRunKeyReusedError extends Data.TaggedError('ThreadRunKeyReused')<{
  readonly message: string;
  readonly threadId: string;
  readonly runId: string;
}> {
  constructor(input: { threadId: string; runId: string }) {
    super({
      message: `The start key of run ${input.runId} on ${input.threadId} was given again with other content.`,
      threadId: input.threadId,
      runId: input.runId,
    });
    this.name = 'ThreadRunKeyReusedError';
  }
}

export type RunAct = 'resume' | 'park' | 'stop' | 'finish' | 'cut' | 'reap';

export type RunState = 'absent' | 'running' | 'parked' | 'live' | 'foreign' | 'ended' | 'stopped';

export class RunActRefused extends Data.TaggedError('RunActRefused')<{
  readonly message: string;
  readonly runId: string;
  readonly act: RunAct;
  readonly state: RunState;
}> {
  constructor(input: { runId: string; act: RunAct; state: RunState }) {
    super({
      message: `Run ${input.runId} refuses ${input.act}: it is ${input.state}.`,
      runId: input.runId,
      act: input.act,
      state: input.state,
    });
    this.name = 'RunActRefused';
  }
}

export type ThreadAbandonedRun = {
  readonly id: string;
  readonly threadId: string;
  readonly kind: ThreadRunKind;
  readonly gapMs: number;
  readonly selector: ThreadRunReapSelector;
  readonly resumeLimit: number;
  readonly stopRequest: ThreadRunStopRequest | null;
};

export type HostedResume = 'adopted' | 'declined' | 'ownership-lost' | 'exhausted' | 'stopped';
