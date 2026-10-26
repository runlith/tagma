import type { Effect } from 'effect';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';

export interface AdoptionList {
  advanceReaderOrder(threadId: string): Effect.Effect<void, HarnessFailure>;
  announce(threadId: string): Effect.Effect<void>;
}
