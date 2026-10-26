import { Context, type Effect, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { ThreadChangesFrame } from '../wire/threadChanges.js';
import type { KnownOutcomes, OutcomeUnread } from './record.js';

export type WholeChanges = Extract<ThreadChangesFrame, { readonly kind: 'whole' }> & { readonly outcomes: KnownOutcomes };

export class ThreadChanges extends Context.Service<
  ThreadChanges,
  {
    subscribe(
      projectId: number,
      threadId: string,
      home: RootId | null,
      limit: number,
    ): Stream.Stream<ThreadChangesFrame, StoreFailure | OutcomeUnread>;
    read(
      projectId: number,
      threadId: string,
      home: RootId | null,
      limit: number,
    ): Effect.Effect<WholeChanges, StoreFailure | OutcomeUnread>;
  }
>()('tagma/change-record/ThreadChanges') {}
