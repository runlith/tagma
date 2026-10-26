import { Context, Data, type Duration, type Effect } from 'effect';
import type { Cursor } from '@runlith/paging';
import type { ThreadFailureDiagnostics } from '../transcript/entries';
import type { RunTerminalStatus } from '../transcript/live';
import type { ThreadStorageFailed } from './persisted';
import type { ThreadContextReading, ThreadRunKind } from './rows';
import type { ThreadWriteTx } from './ThreadPorts';

export type ThreadRunStoppedBy = 'reader' | 'parent' | 'agent' | 'model';

export type ThreadStopDoor =
  | 'stop_run'
  | 'stop_agent'
  | 'interrupt-task'
  | 'rewind'
  | 'archive'
  | 'delete'
  | 'project-removed'
  | 'worktree-finished'
  | 'restart'
  | 'handle';

export type ThreadRestarted = { readonly stoppedRunId: string | null; readonly runId: string | null };

export type ThreadWithdrawal = { readonly withdraw?: boolean };

export type ThreadStopOptions = ThreadWithdrawal & { readonly door: ThreadStopDoor };

export type ThreadStop =
  | { readonly status: 'stopped' | 'requested' | 'run-mismatch'; readonly runId: string }
  | { readonly status: 'nothing-running' };

export type ThreadStopAsk = ThreadStopOptions & {
  readonly by: ThreadRunStoppedBy;
  readonly expected?: string;
  readonly at?: 'step';
  readonly key?: string;
  readonly settled?: { readonly within?: Duration.Duration };
};

export type ThreadStopAnswer = ThreadStop | { readonly status: 'still-settling'; readonly runId: string };

export type RunEnded = {
  readonly threadId: string;
  readonly principal: string;
  readonly runId: string;
  readonly ending: string;
  readonly kind: 'answered' | 'ended';
  readonly status: RunTerminalStatus;
  readonly stoppedBy: ThreadRunStoppedBy | null;
  readonly work: ThreadRunKind;
  readonly handled: readonly string[] | null;
  readonly answer: string | null;
  readonly report: string | null;
  readonly failure: ThreadFailureDiagnostics | null;
  readonly failureReason: string | null;
  readonly reading: ThreadContextReading | null;
};

export type EndingStage = 'settled' | 'reported';

export type ReportReceipt = {
  readonly requesterThreadId: string;
  readonly requestId: string;
  readonly envelopeId: string;
  readonly status: 'delivered' | 'queued' | 'woken' | 'stored';
  readonly acted: boolean;
};

export type OwedEnding = {
  readonly ending: string;
  readonly stage: EndingStage;
  readonly threadId: string;
};

export class EndingStages extends Context.Service<
  EndingStages,
  {
    record(ended: RunEnded, unit: ThreadWriteTx): Effect.Effect<void, ThreadStorageFailed>;
    acknowledge(ending: string, stage: EndingStage): Effect.Effect<void, ThreadStorageFailed>;
    read(ending: string): Effect.Effect<{ readonly ended: RunEnded; readonly owed: readonly EndingStage[] } | null, ThreadStorageFailed>;
    pending(input: {
      readonly limit: number;
      readonly cursor?: Cursor;
    }): Effect.Effect<
      { readonly rows: readonly OwedEnding[]; readonly total: number; readonly cursor: Cursor | null },
      ThreadStorageFailed
    >;
  }
>()('@runlith/agent/EndingStages') {}

export class EndingStageFailed extends Data.TaggedError('EndingStageFailed')<{
  readonly ending: string;
  readonly stage: EndingStage;
  readonly cause: unknown;
}> {}

export class EndingRunner extends Context.Service<
  EndingRunner,
  {
    run(ended: { readonly ending: string; readonly threadId: string }): Effect.Effect<void, EndingStageFailed | ThreadStorageFailed>;
    recover(input: { readonly limit: number }): Effect.Effect<number, ThreadStorageFailed>;
  }
>()('@runlith/agent/EndingRunner') {}
