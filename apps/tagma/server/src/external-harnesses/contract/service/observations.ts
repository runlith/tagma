import { Context, type Effect } from 'effect';
import type { ExternalSession } from '../../../threads/contract/wire/harness/externalSession.js';
import type { HarnessHeldAnswer } from '../../../threads/contract/wire/harness/answer.js';
import type { HarnessSession } from '../../../threads/contract/wire/harness/session.js';
import type {
  HarnessDiagnostic,
  HarnessEvent,
  HarnessObservation,
  HarnessReceipt,
} from '../../../threads/contract/wire/harness/observation.js';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';
import type { HarnessAdapter } from './adapter.js';

export type HarnessAccepted = { readonly facet: ExternalSession; readonly receipt: HarnessReceipt };

export class SessionObservations extends Context.Service<
  SessionObservations,
  {
    read(threadId: string): Effect.Effect<HarnessObservation | null, HarnessFailure>;
    speaking(
      threadId: string,
      source: { readonly sessionId: string | null; readonly rootKey: string | null },
    ): Effect.Effect<
      | { readonly _tag: 'Proven'; readonly session: HarnessSession }
      | { readonly _tag: 'Unjudged'; readonly session: HarnessSession; readonly rootKey: string }
      | { readonly _tag: 'Refused'; readonly cause: HarnessDiagnostic['cause']; readonly detail: string },
      HarnessFailure
    >;
    admit(facet: ExternalSession, event: HarnessEvent, adapter: HarnessAdapter): HarnessAccepted;
    bindWitness(threadId: string, sessionId: string, revision: number, rootKey: string): Effect.Effect<HarnessReceipt, HarnessFailure>;
    notedWords(threadId: string, cause: HarnessDiagnostic['cause'], detail: string): Effect.Effect<void, HarnessFailure>;
    holdWords(threadId: string, sessionId: string, entry: HarnessHeldAnswer): Effect.Effect<void, HarnessFailure>;
    releaseHeld(
      threadId: string,
      sessionId: string,
    ): Effect.Effect<
      {
        readonly publish: readonly HarnessHeldAnswer[];
        readonly session: HarnessSession | null;
      },
      HarnessFailure
    >;
    expireHeld(
      threadId: string,
      sessionId: string,
      proved: string | null,
    ): Effect.Effect<
      {
        readonly deliver: readonly HarnessHeldAnswer[];
        readonly session: HarnessSession | null;
      },
      HarnessFailure
    >;
  }
>()('tagma/external-harnesses/SessionObservations') {}
