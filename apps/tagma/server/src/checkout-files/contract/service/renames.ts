import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { PlacedPath } from '../../../workspace/contract/wire/place.js';

export class Renames extends Context.Service<
  Renames,
  {
    movedTo(from: PlacedPath): Effect.Effect<string | null, StoreFailure>;
  }
>()('tagma/checkout-files/Renames') {}
