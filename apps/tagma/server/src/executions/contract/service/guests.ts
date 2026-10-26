import { Context, Data, type Stream } from 'effect';
import type { ThreadId } from '../../../platform/contract/wire/thread.js';

export type LiveGuest = {
  readonly guest: string;
  readonly thread: ThreadId;
  readonly startedAt: number;
};

export class GuestsUnread extends Data.TaggedError('GuestsUnread')<{ readonly reason: string }> {}

export class LiveGuests extends Context.Service<
  LiveGuests,
  {
    readonly follow: (projectId: number) => Stream.Stream<readonly LiveGuest[], GuestsUnread>;
  }
>()('tagma/executions/LiveGuests') {}
