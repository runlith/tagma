import { Context, Data, type Effect } from 'effect';
import type { KeyedRequest, KeyedSpent } from '../thread/keyed';
import type { ThreadSummarizerSelection } from '../thread/compaction/summarizer';
import type { ThreadMissing } from '../thread/ThreadBorder';
import type { ThreadStorageFailed } from '../thread/persisted';
import type { ThreadCompactionPoint, ThreadInboxItemValues } from '../thread/storage/inbox';
import type { ThreadSummarizerSkip } from '../transcript/entries';
import type { ThreadChildSummarizer } from './ThreadPlaneAccess';
import type { CurrentRun } from '../thread/record';

export class ThreadCompactionRefused extends Data.TaggedError('ThreadCompactionRefused')<{
  readonly threadId: string;
  readonly reason: 'exhausted' | 'unsupported' | 'running' | 'summary-failed' | 'off';
  readonly running: CurrentRun | null;
}> {}

export class ThreadCompactionConflict extends Data.TaggedError('ThreadCompactionConflict')<{
  readonly threadId: string;
  readonly reason: 'prefix-moved' | 'act-id-reused';
  readonly key: string | null;
}> {}

export class SummarizerMissing extends Data.TaggedError('SummarizerMissing')<{
  readonly threadId: string;
  readonly skipped: readonly ThreadSummarizerSkip[];
}> {}

export class ThreadCompactionUnavailable extends Data.TaggedError('ThreadCompactionUnavailable')<{
  readonly threadId: string;
  readonly reason: 'deadline';
}> {}

export class ThreadCompactionLost extends Data.TaggedError('ThreadCompactionLost')<{
  readonly threadId: string;
  readonly key: string;
}> {}

export type ContextCompactionFailure =
  | ThreadMissing
  | ThreadCompactionRefused
  | ThreadCompactionConflict
  | SummarizerMissing
  | ThreadCompactionUnavailable
  | ThreadCompactionLost
  | ThreadStorageFailed;

export class ContextCompaction extends Context.Service<
  ContextCompaction,
  {
    readonly choosesSummarizer: boolean;
    summarizer(threadId: string): Effect.Effect<'own' | 'foreign' | 'none', ContextCompactionFailure>;
    compact(
      threadId: string,
      input: {
        readonly request: KeyedRequest;
        readonly keep?: string;
        readonly at?: ThreadCompactionPoint;
        readonly summarizer?: ThreadSummarizerSelection;
      },
    ): Effect.Effect<
      | {
          readonly status: 'completed' | 'unchanged' | 'failed' | 'aborted';
          readonly runId: string;
          readonly history: { readonly before: number; readonly after: number };
          readonly summarizer: ThreadChildSummarizer | null;
          readonly skipped: readonly ThreadSummarizerSkip[];
          readonly acted: boolean;
        }
      | {
          readonly status: 'requested';
          readonly requestId: string;
          readonly at: ThreadCompactionPoint;
          readonly runId: string;
          readonly acted: boolean;
        }
      | { readonly status: 'joined'; readonly runId: string }
      | KeyedSpent,
      ContextCompactionFailure
    >;
    compactAhead(
      threadId: string,
      input: { readonly request: KeyedRequest; readonly item: ThreadInboxItemValues; readonly keep: string },
    ): Effect.Effect<
      | {
          readonly itemId: string;
          readonly requestId: string;
          readonly runId: string | null;
          readonly started: boolean;
          readonly summarizer: ThreadChildSummarizer | null;
          readonly acted: boolean;
        }
      | KeyedSpent,
      ContextCompactionFailure
    >;
  }
>()('@runlith/agent/ContextCompaction') {}
