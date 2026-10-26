import type { AgentApprovalMode } from '@runlith/agent/contracts';
import type { Effect } from 'effect';
import type { Unit } from '../../../platform/contract/service/units.js';
import type { ExternalSession } from '../../../threads/contract/wire/harness/externalSession.js';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';

export interface SessionThreads {
  find(
    threadId: string,
    principal: string,
  ): Effect.Effect<
    | {
        readonly harness: ExternalSession | null;
        readonly authority: { readonly mode: AgentApprovalMode };
      }
    | undefined,
    HarnessFailure
  >;
  runningRun(threadId: string, unit: Unit<'machine'>): Effect.Effect<string | null, HarnessFailure>;
}
