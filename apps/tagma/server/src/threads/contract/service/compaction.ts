import { Context, type Effect } from 'effect';
import type { HarnessFailure } from './failure.js';
import type { TransportCapabilities } from '@runlith/agent/thread/record';

export class CompactionPlanning extends Context.Service<
  CompactionPlanning,
  {
    readonly instructions: string;
    threshold(
      threadId: string,
      provider: string,
      model: string | null,
      window: number,
      compaction: TransportCapabilities['compaction'],
    ): Effect.Effect<number | null, HarnessFailure>;
  }
>()('tagma/threads/CompactionPlanning') {}
