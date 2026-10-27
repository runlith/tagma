import { Context, Data, type Effect, type Stream } from 'effect';
import type { AccessState, Blocked } from '../wire/access.js';

export type ExposureStep =
  | { readonly _tag: 'setting-up' }
  | { readonly _tag: 'certificate'; readonly origin: string }
  | { readonly _tag: 'listening'; readonly sandbox: AccessState }
  | { readonly _tag: 'ready'; readonly origin: string; readonly sandbox: AccessState; readonly machine: string | null }
  | Blocked;

export type SiteAsk = { readonly name: string; readonly port: number | null };

export type PointAsk = SiteAsk & { readonly target: number };

export type SitePlaced = { readonly name: string; readonly port: number | null; readonly state: AccessState };

export type SiteKeeping = (name: string, port: number) => Effect.Effect<void, Blocked>;

export class WithdrawalRefused extends Data.TaggedError('WithdrawalRefused')<{ readonly reason: string }> {}

export class Exposure extends Context.Service<
  Exposure,
  {
    expose(port: number, settled: string | null): Stream.Stream<ExposureStep>;
    place(asked: readonly SiteAsk[], reserved: readonly number[], keep: SiteKeeping): Stream.Stream<SitePlaced>;
    point(asked: PointAsk, keep: SiteKeeping): Effect.Effect<SitePlaced>;
    withdraw(port: number, pointed: readonly number[]): Effect.Effect<void, WithdrawalRefused>;
  }
>()('tagma/remote/Exposure') {}

export class ListenerRefused extends Data.TaggedError('ListenerRefused')<{ readonly reason: string }> {}

export type Listener = {
  readonly port: number;
  readonly open: Effect.Effect<void, ListenerRefused>;
  readonly close: Effect.Effect<void>;
};
