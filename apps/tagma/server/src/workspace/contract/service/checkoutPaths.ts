import { Context, Data, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { PlacedPath } from '../wire/place.js';
import type { ProjectRoot } from '../wire/coverage.js';

export type PathWithinRefusal = 'path-outside-tree' | 'files';

export type CheckoutPlace = PlacedPath & { readonly projectId: number; readonly root: string };

export class PlaceUnread extends Data.TaggedError('PlaceUnread')<{
  readonly path: string;
  readonly reason: string;
}> {}

export class CheckoutUnknown extends Data.TaggedError('CheckoutUnknown')<{
  readonly path: string;
  readonly reason: string;
}> {}

export class CheckoutPaths extends Context.Service<
  CheckoutPaths,
  {
    pathWithin(root: string, path: string): Effect.Effect<{ readonly exists: boolean }, GateRefusal<PathWithinRefusal>>;
    placeOf(projectId: number, path: string): Effect.Effect<CheckoutPlace | null, PlaceUnread>;
    placeAcross(path: string): Effect.Effect<CheckoutPlace | null, PlaceUnread>;
    resourceAcross(path: string): Effect.Effect<CheckoutPlace | null, PlaceUnread>;
    rootAcross(named: string, preferred: number | null): Effect.Effect<ProjectRoot | null, PlaceUnread>;
    rootsWithin(directory: string): Effect.Effect<readonly CheckoutPlace[], PlaceUnread>;
  }
>()('tagma/workspace/CheckoutPaths') {}
