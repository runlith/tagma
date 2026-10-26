import { Context, type Effect } from 'effect';
import type { RedeliveryOnTheWire } from '../wire/endings.js';
import type { HarnessFailure } from './failure.js';

export class EndingRedelivery extends Context.Service<
  EndingRedelivery,
  {
    redeliver(threadId: string, projectId: number, runId: string): Effect.Effect<RedeliveryOnTheWire, HarnessFailure>;
  }
>()('tagma/threads/EndingRedelivery') {}
