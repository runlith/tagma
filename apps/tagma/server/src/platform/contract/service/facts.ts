import { Context, type Effect } from 'effect';
import type { FactCheckout } from '../wire/section.js';

export class DoctrineFacts extends Context.Service<
  DoctrineFacts,
  { read(ids: readonly string[], checkout: FactCheckout): Effect.Effect<Readonly<Record<string, boolean>>> }
>()('tagma/platform/DoctrineFacts') {}
