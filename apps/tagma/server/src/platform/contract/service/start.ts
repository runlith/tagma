import { Context, Effect, Option } from 'effect';
import type { StartMoves, StartPrice } from '../wire/start.js';

export type StartPricing = {
  readonly projectId: number;
  readonly moves: StartMoves;
  readonly quiet: boolean;
};

export class StartCosts extends Context.Service<
  StartCosts,
  {
    priced<A, E, R>(pricing: StartPricing, write: Effect.Effect<A, E, R>): Effect.Effect<readonly [A, StartPrice | undefined], E, R>;
  }
>()('tagma/platform/StartCosts') {}

export type Priced<A> = { readonly value: A; readonly start: StartPrice | undefined };

export const priced = <A, E, R>(pricing: StartPricing | null, write: Effect.Effect<A, E, R>): Effect.Effect<Priced<A>, E, R> =>
  Effect.flatMap(Effect.serviceOption(StartCosts), (costs): Effect.Effect<Priced<A>, E, R> =>
    pricing === null || Option.isNone(costs)
      ? Effect.map(write, (value) => ({ value, start: undefined }))
      : Effect.map(costs.value.priced(pricing, write), ([value, start]) => ({ value, start })),
  );
