import { Context, type Effect, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { Notification, Outcome, Question } from '../wire/notification.js';

export type Draft = {
  readonly title: string;
  readonly body: string;
  readonly question: Question | null;
  readonly key?: string;
};

export type Sent = Notification & { readonly repeated: boolean };

export type Resolved = { readonly id: string; readonly outcome: Outcome; readonly repeated: boolean };

export type NotificationChange =
  | { readonly _tag: 'all'; readonly rows: readonly Notification[] }
  | { readonly _tag: 'put'; readonly row: Notification }
  | { readonly _tag: 'gone'; readonly id: string };

export class Notifications extends Context.Service<
  Notifications,
  {
    send(sender: string, draft: Draft): Effect.Effect<Sent, GateRefusal<'too-many-open'> | StoreFailure>;
    answer(id: string, answer: string): Effect.Effect<Resolved, GateRefusal<'not-found' | 'no-question' | 'bad-answer'> | StoreFailure>;
    dismiss(id: string): Effect.Effect<Resolved, GateRefusal<'not-found'> | StoreFailure>;
    readonly changes: Stream.Stream<NotificationChange, StoreFailure>;
  }
>()('tagma/notify/Notifications') {}
