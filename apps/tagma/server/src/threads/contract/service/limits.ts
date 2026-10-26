import { Context, type Effect } from 'effect';
import type { ThreadLimitSubject, ThreadLimitTable } from '@runlith/agent/thread/compaction/limit';
import type { HarnessFailure } from './failure.js';

export class ContextLimits extends Context.Service<
  ContextLimits,
  {
    of(threads: readonly ThreadLimitSubject[]): Effect.Effect<ThreadLimitTable, HarnessFailure>;
  }
>()('tagma/threads/ContextLimits') {}
