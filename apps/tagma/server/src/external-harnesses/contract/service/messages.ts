import type { Effect } from 'effect';
import type { ThreadEnvelopeInput, ThreadEnvelopeReceipt } from '@runlith/agent/collaboration/ThreadEnvelopes';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';

export interface SessionMessages {
  deliver(threadId: string, principal: string, envelope: ThreadEnvelopeInput): Effect.Effect<ThreadEnvelopeReceipt, HarnessFailure>;
}
