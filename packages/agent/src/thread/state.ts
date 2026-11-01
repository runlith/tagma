import { stallAfterMs } from '../agent/callProgress';
import type { ThreadEventDelta } from '../transcript/eventFold';
import type { RunHalt, RunOwnership, RunStage, RunStatus, ThreadPendingInput, ThreadSnapshotOf } from '../transcript/live';
import { THREAD_RUN_AWAITING_QUESTION_STAGE, THREAD_RUN_RESUMING_STAGE } from './storage/runs';
import type { CurrentRun, TransportCapabilities } from './record';
import type { ThreadRunLeaseRhythm } from './ThreadPorts';
import type { ThreadMetadataRow, ThreadRunRow, ThreadRunStatus } from './rows';
import type { ThreadEventRecord } from './events';

export type ThreadState = {
  readonly thread: ThreadMetadataRow;
  readonly position: number;
  readonly activeRun: ThreadRunRow | null;
  readonly latestRun: ThreadRunRow | null;
  readonly pendingInput: ThreadPendingInput;
  readonly status: RunStatus;
  readonly now: string;
};

export type ThreadSnapshot = ThreadSnapshotOf<ThreadState>;

export type ThreadStateShape = {
  readonly thread: { readonly id: string };
  readonly position: number;
  readonly activeRun: { readonly id: string; readonly progress: { readonly stage: RunStage | null } } | null;
  readonly latestRun: { readonly id: string } | null;
};

export type ThreadStateFrame<TState> = {
  readonly state: TState;
  readonly from: number;
  readonly deltas: readonly ThreadEventDelta[];
};

export type ThreadMetadataChange = Partial<Pick<ThreadMetadataRow, 'updatedAt' | 'contextReading' | 'pendingInteraction'>>;

export type ThreadChangeRevision = { readonly from: number; readonly to: number };

export type ThreadStateChange =
  | {
      readonly kind: 'appended';
      readonly threadId: string;
      readonly revision: ThreadChangeRevision;
      readonly from: number;
      readonly records: readonly ThreadEventRecord[];
      readonly thread: ThreadMetadataChange;
      readonly runs?: readonly ThreadRunChange[];
    }
  | {
      readonly kind: 'ran';
      readonly threadId: string;
      readonly revision: ThreadChangeRevision;
      readonly runs: readonly ThreadRunChange[];
    }
  | { readonly kind: 'moved'; readonly threadId: string };

export type ThreadRunChange = { readonly id: string } & Partial<Pick<ThreadRunRow, 'heartbeatAt' | 'updatedAt' | 'streamTail' | 'resumes'>>;

export type ThreadChangePart =
  | {
      readonly kind: 'appended';
      readonly from: number;
      readonly records: readonly ThreadEventRecord[];
      readonly thread: ThreadMetadataChange;
    }
  | { readonly kind: 'run'; readonly run: ThreadRunChange }
  | { readonly kind: 'unseen' };

export type ActiveLife = 'working' | 'awaiting' | 'stalled';

export type RunMovement = { readonly updatedAt: Date; readonly capabilities: TransportCapabilities };

export type RunLifeFacts = { readonly stage: RunStage | null; readonly thread: RunMovement };

export function stalledBefore(now: Date, stalledAfterMs: number): Date {
  return new Date(now.getTime() - stalledAfterMs);
}

export const awaitsAnswer = (stage: RunStage | null): boolean => stage === THREAD_RUN_AWAITING_QUESTION_STAGE;

export function runLife(facts: RunLifeFacts, now: Date): ActiveLife {
  if (awaitsAnswer(facts.stage)) return 'awaiting';
  const after = stallAfterMs(facts.thread.capabilities.callEnvelopeMs);
  const stalled = after !== null && facts.thread.updatedAt.getTime() < stalledBefore(now, after).getTime();
  return stalled ? 'stalled' : 'working';
}

export type RunStanding = {
  readonly status: ThreadRunStatus;
  readonly progress: { readonly stage: RunStage | null };
  readonly heartbeatAt: Date;
  readonly handedOverAt: Date | null;
};

export type RunSignals = {
  readonly life: ActiveLife;
  readonly stalledSince: Date | null;
  readonly ownership: RunOwnership;
  readonly changesAt: Date | null;
};

export function runSignals(run: RunStanding, thread: RunMovement, now: Date, rhythm: ThreadRunLeaseRhythm): RunSignals | null {
  if (run.status !== 'running') return null;
  if (awaitsAnswer(run.progress.stage)) {
    return { life: 'awaiting', stalledSince: null, ownership: 'held', changesAt: null };
  }
  const at = now.getTime();
  const movedAt = thread.updatedAt;
  const after = stallAfterMs(thread.capabilities.callEnvelopeMs);
  const stallAt = after === null ? null : movedAt.getTime() + after;
  const life = runLife({ stage: run.progress.stage, thread }, now);
  const stalled = life === 'stalled';
  const recovering = run.handedOverAt !== null || run.progress.stage === THREAD_RUN_RESUMING_STAGE;
  const staleAt = run.heartbeatAt.getTime() + rhythm.takeoverAfterMs;
  const ownership: RunOwnership = recovering ? 'recovering' : at > staleAt ? 'stale-evidence' : 'held';
  const flips = [...(stallAt !== null && !stalled ? [stallAt + 1] : []), ...(ownership === 'held' ? [staleAt + 1] : [])];
  return {
    life,
    stalledSince: stalled ? movedAt : null,
    ownership,
    changesAt: flips.length === 0 ? null : new Date(Math.min(...flips)),
  };
}

export type RunRecovery = { readonly resumes: number; readonly progress: { readonly halt?: RunHalt } };

export function runHalt(run: RunRecovery): RunHalt | undefined {
  return run.resumes > 0 ? run.progress.halt : undefined;
}

export type CurrentRunFacts = RunStanding & { readonly id: string; readonly startedAt: Date };

export function currentRunOf(run: CurrentRunFacts, thread: RunMovement, now: Date, rhythm: ThreadRunLeaseRhythm): CurrentRun | null {
  const signals = runSignals(run, thread, now, rhythm);
  if (signals === null) return null;
  return {
    runId: run.id,
    life: signals.life === 'awaiting' ? 'awaiting' : 'working',
    askPrompt: null,
    since: run.startedAt,
    stalledSince: signals.stalledSince,
  };
}
