import { Context, Data, type Effect } from 'effect';
import type { KeyedRequest, KeyedSpent } from '../thread/keyed';
import type { CurrentRun } from '../thread/record';
import type { ThreadRunStoppedBy } from '../thread/ending';
import type { ThreadCallBroke, ThreadMissing } from '../thread/ThreadBorder';
import type { ThreadStorageFailed } from '../thread/persisted';
import type { ThreadInboxItem } from '../thread/storage/inbox';
import type { ThreadInputAcceptance } from '../thread/storage/inbox';

export class ThreadRunConflict extends Data.TaggedError('ThreadRunConflict')<{
  readonly threadId: string;
  readonly reason: 'running' | 'act-id-reused';
  readonly running: CurrentRun | null;
  readonly key: string | null;
}> {}

export class ThreadRunRefused extends Data.TaggedError('ThreadRunRefused')<{
  readonly threadId: string;
  readonly reason: 'not-interrupted' | 'session-deleting' | 'cli-standing' | 'harness-missing' | 'harness-refused';
  readonly detail?: string;
}> {
  override get message(): string {
    return this.detail === undefined ? `Run of thread ${this.threadId} refused: ${this.reason}.` : `${this.reason}: ${this.detail}`;
  }
}

export class ThreadDeliveryConflict extends Data.TaggedError('ThreadDeliveryConflict')<{
  readonly threadId: string;
  readonly itemId: string;
}> {}

export class ThreadRunUnavailable extends Data.TaggedError('ThreadRunUnavailable')<{
  readonly threadId: string;
  readonly reason: 'not-ready' | 'deadline';
  readonly cause?: unknown;
}> {}

export type ThreadRunsFailure =
  | ThreadCallBroke
  | ThreadMissing
  | ThreadRunConflict
  | ThreadRunRefused
  | ThreadDeliveryConflict
  | ThreadRunUnavailable
  | ThreadStorageFailed;

export type ThreadStopReceipt = { readonly status: 'stopped' | 'not-running'; readonly runId: string | null };

export type ThreadStepWait = 'deadline' | 'boundary';

export class ThreadRuns extends Context.Service<
  ThreadRuns,
  {
    current(threadId: string): Effect.Effect<CurrentRun | null, ThreadMissing | ThreadStorageFailed>;
    stopReceipt(threadId: string, key: string): Effect.Effect<ThreadStopReceipt | KeyedSpent | null, ThreadRunsFailure>;
    start(
      threadId: string,
      input: { readonly itemId: string; readonly text: string; readonly deadline: Date },
    ): Effect.Effect<
      { readonly status: 'started' | 'queued'; readonly runId: string; readonly acted: boolean } | KeyedSpent,
      ThreadRunsFailure
    >;
    deliver(
      threadId: string,
      input: { readonly item: ThreadInboxItem; readonly deadline: Date },
    ): Effect.Effect<
      | {
          readonly status: 'queued' | 'delivered' | 'woken' | 'stored';
          readonly runId: string | null;
          readonly acted: boolean;
          readonly acceptance?: ThreadInputAcceptance;
        }
      | KeyedSpent,
      ThreadRunsFailure
    >;
    continue(
      threadId: string,
      input: { readonly request: KeyedRequest; readonly expected?: string },
    ): Effect.Effect<
      { readonly status: 'continued' | 'joined'; readonly runId: string; readonly acted: boolean } | KeyedSpent,
      ThreadRunsFailure
    >;
    stop(
      threadId: string,
      input: {
        readonly request: KeyedRequest;
        readonly expected?: string;
        readonly by: ThreadRunStoppedBy;
        readonly at?: 'step';
        readonly until?: ThreadStepWait;
      },
    ): Effect.Effect<{ readonly status: 'stopped' | 'stopping' | 'not-running'; readonly acted: boolean } | KeyedSpent, ThreadRunsFailure>;
  }
>()('@runlith/agent/ThreadRuns') {}
