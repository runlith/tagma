import { Effect } from 'effect';
import { ContextCompaction, ThreadCompactionRefused } from '@runlith/agent/collaboration/compaction';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { ThreadStore } from '../rows/threadRow.js';

export function contextCompaction(native: ContextCompaction['Service'], store: ThreadStore): ContextCompaction['Service'] {
  const owner = Effect.fnUntraced(
    function* (threadId: string, summarized: boolean) {
      const mode = (yield* store.capabilities(threadId))?.capabilities.compaction ?? 'core';
      if (mode === 'none' || (mode === 'session' && summarized))
        return yield* new ThreadCompactionRefused({ threadId, reason: 'unsupported', running: null });
      return native;
    },
    Effect.mapError((cause) =>
      cause instanceof ThreadCompactionRefused ? cause : new ThreadStorageFailed({ call: 'compaction.owner', cause }),
    ),
  );
  return {
    choosesSummarizer: native.choosesSummarizer,
    summarizer: native.summarizer,
    compact: (threadId, input) => Effect.flatMap(owner(threadId, input.summarizer !== undefined), (held) => held.compact(threadId, input)),
    compactAhead: (threadId, input) => Effect.flatMap(owner(threadId, false), (held) => held.compactAhead(threadId, input)),
  };
}
