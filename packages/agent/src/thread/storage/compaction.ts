import { Data, type Effect } from 'effect';
import type { Usage } from '@runlith/llm/schema/events';
import type { ThreadSummarizerSkip } from '../../transcript/entries';
import type { ThreadCompactionCheckpointRow } from '../rows';
import type { ThreadPortFailure } from '../ThreadBorder';

export type ThreadCheckpointWrite = {
  readonly threadId: string;
  readonly sourceRunId: string | null;
  readonly coveredMessageCount: number;
  readonly coveredPrefixHash: string;
  readonly summary: string;
  readonly usage: Usage | null;
};

export type ThreadPrunedToolCall = {
  readonly toolCallId: string;
  readonly tokens: number;
};

export type ThreadPrunedVolume = {
  readonly count: number;
  readonly tokens: number;
};

export interface ThreadCompactionStorage<TWrite = unknown> {
  latestCheckpoint(threadId: string): Effect.Effect<ThreadCompactionCheckpointRow | null, ThreadPortFailure>;

  prunedToolCalls(threadId: string): Effect.Effect<ReadonlySet<string>, ThreadPortFailure>;

  prunedToolCallVolume(threadId: string): Effect.Effect<ThreadPrunedVolume, ThreadPortFailure>;

  compactionCount(threadId: string): Effect.Effect<number, ThreadPortFailure>;

  markToolCallsPrunedIn(threadId: string, calls: readonly ThreadPrunedToolCall[], tx: TWrite): Effect.Effect<void, ThreadPortFailure>;

  retirePrunedToolCallsIn(threadId: string, toolCallIds: readonly string[], tx: TWrite): Effect.Effect<void, ThreadPortFailure>;

  writeCheckpointIn(input: ThreadCheckpointWrite, tx: TWrite): Effect.Effect<ThreadCompactionCheckpointRow, ThreadPortFailure>;
}

export class ThreadCompactionConflictError extends Data.TaggedError('ThreadCompactionConflict')<{
  readonly message: string;
  readonly threadId: string;
}> {
  constructor(threadId: string) {
    super({ message: `Thread history changed inside the covered compaction prefix: ${threadId}.`, threadId });
    this.name = 'ThreadCompactionConflictError';
  }
}

export class ThreadCompactionExhaustedError extends Data.TaggedError('ThreadCompactionExhausted')<{
  readonly message: string;
  readonly threadId: string;
}> {
  constructor(threadId: string) {
    super({ message: `Thread ${threadId} exceeds its model context and no safe reduction remains.`, threadId });
    this.name = 'ThreadCompactionExhaustedError';
  }
}

type ThreadSummarizerAt = { readonly threadId: string; readonly provider: string; readonly account?: string };

export class ThreadSummaryFailedError extends Data.TaggedError('ThreadSummaryFailed')<{
  readonly message: string;
  readonly threadId: string;
  readonly provider: string;
  readonly account: string | null;
  readonly reason: 'model' | 'unfinished' | 'empty' | 'over-budget' | 'too-short' | 'no-fit';
  readonly failure: unknown;
}> {
  constructor(at: ThreadSummarizerAt, reason: ThreadSummaryFailedError['reason'], detail: string, failure: unknown = null) {
    super({
      message: `Thread ${at.threadId} compaction summary failed: ${detail}`,
      threadId: at.threadId,
      provider: at.provider,
      account: at.account ?? null,
      reason,
      failure,
    });
    this.name = 'ThreadSummaryFailedError';
  }
}

export class ThreadCompactionOffError extends Data.TaggedError('ThreadCompactionOff')<{
  readonly message: string;
  readonly threadId: string;
}> {
  constructor(threadId: string) {
    super({ message: `The agent of thread ${threadId} has compaction off, so nothing compacts it.`, threadId });
    this.name = 'ThreadCompactionOffError';
  }
}

export class ThreadNoSummarizerError extends Data.TaggedError('ThreadNoSummarizer')<{
  readonly message: string;
  readonly threadId: string;
  readonly skipped: readonly ThreadSummarizerSkip[];
}> {
  constructor(threadId: string, skipped: readonly ThreadSummarizerSkip[]) {
    super({
      message: `No summarizer can compact thread ${threadId}: ${
        skipped
          .map((skip) => `${skip.provider}/${skip.model} ${skip.reason}${skip.until === undefined ? '' : ` until ${skip.until}`}`)
          .join('; ') || 'no chain member is spendable'
      }.`,
      threadId,
      skipped,
    });
    this.name = 'ThreadNoSummarizerError';
  }
}
