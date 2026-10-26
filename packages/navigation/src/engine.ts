import { Context, Data, type Effect, type Scope } from 'effect';
import type { Adapter, Capability, EngineLost, Snapshot } from './adapter';

export type Launch = {
  readonly base: string;
  readonly memory: number;
  readonly cpus: number;
};

export type Touch = { readonly _tag: 'paths'; readonly paths: readonly string[] } | { readonly _tag: 'head' } | { readonly _tag: 'rescan' };

export type Served = { readonly snapshot: Snapshot; readonly warming: boolean; readonly adapter: Adapter };

export class CheckoutRefused extends Data.TaggedError('CheckoutRefused')<{ readonly detail: string }> {
  override get message(): string {
    return `the navigation engine cannot serve this checkout: ${this.detail}`;
  }
}

export type Checkout = {
  readonly served: Effect.Effect<Served | null, never, Scope.Scope>;
  readonly ready: Effect.Effect<Served, EngineLost | CheckoutRefused, Scope.Scope>;
  readonly touch: (touch: Touch) => Effect.Effect<void, EngineLost>;
  readonly rest: Effect.Effect<void, EngineLost>;
};

export type Process = {
  readonly checkout: (root: string) => Effect.Effect<Checkout, EngineLost, Scope.Scope>;
  readonly limit: (bytes: number) => Effect.Effect<void, EngineLost>;
  readonly usage: Effect.Effect<number, EngineLost>;
  readonly ended: Effect.Effect<string>;
};

export class Launcher extends Context.Service<
  Launcher,
  {
    readonly capability: Capability;
    readonly open: (launch: Launch) => Effect.Effect<Process, EngineLost, Scope.Scope>;
  }
>()('@runlith/navigation/Launcher') {}
