import { Context, type Effect } from 'effect';
import type {
  ResolvedSummarizer,
  ThreadSummarizerAsk,
  ThreadSummarizerSelection,
  ThreadSummarizers,
} from '@runlith/agent/thread/compaction/summarizer';
import type { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { SettableScope } from '../../../platform/contract/wire/setting.js';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';
import type { CompactionChoicesRead, CompactionSummarizersRead } from '../wire/compactionChoices.js';

export class CompactionChoices extends Context.Service<
  CompactionChoices,
  {
    summarizers(ask: ThreadSummarizerAsk): Effect.Effect<ThreadSummarizers, ThreadNotFoundError | ThreadStorageFailed>;
    read(
      threadId: string,
      projectId: number,
      asked: { readonly limit?: number; readonly cursor?: string },
    ): Effect.Effect<CompactionChoicesRead, HarnessFailure>;
    admit(threadId: string, named: ThreadSummarizerSelection): Effect.Effect<ResolvedSummarizer, HarnessFailure>;
    chainAt(
      layer: SettableScope,
      projectId: number | undefined,
    ): Effect.Effect<CompactionSummarizersRead, StoreFailure | GateRefusal<'project-required'>>;
  }
>()('tagma/native-harness/CompactionChoices') {}
