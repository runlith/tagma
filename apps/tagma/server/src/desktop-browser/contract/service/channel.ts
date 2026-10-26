import { Context, type Effect, type Scope, type Stream } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { Order } from '../wire/channel.js';

export type Intake = {
  readonly take: (message: string) => Effect.Effect<void, GateRefusal<'channel-broken'>>;
  readonly ended: Effect.Effect<void>;
};

export class DesktopChannel extends Context.Service<
  DesktopChannel,
  {
    attach(host: string, pid: number): Stream.Stream<Order, GateRefusal<'channel-broken'>>;
    report(host: string, generation: number): Effect.Effect<Intake, GateRefusal<'channel-unknown'>, Scope.Scope>;
  }
>()('tagma/desktop-browser/DesktopChannel') {}
