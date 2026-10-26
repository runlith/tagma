import { Context, type Effect } from 'effect';

export type Vapid = { readonly publicKey: string; readonly privateKey: string; readonly subject: string };

export type Target = { readonly endpoint: string; readonly p256dh: string; readonly auth: string };

export type Message = { readonly payload: string; readonly ttlSeconds: number; readonly urgency: 'normal' | 'high' };

export type Sent =
  | { readonly _tag: 'accepted' }
  | { readonly _tag: 'gone' }
  | { readonly _tag: 'later'; readonly afterMs: number | null; readonly reason: string }
  | { readonly _tag: 'rejected'; readonly reason: string };

export class Sender extends Context.Service<
  Sender,
  {
    send(target: Target, message: Message, vapid: Vapid): Effect.Effect<Sent>;
  }
>()('tagma/push/Sender') {}
