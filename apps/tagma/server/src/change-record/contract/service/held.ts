import { Context, type Effect } from 'effect';
import type { PlacedPath } from '../../../workspace/contract/wire/place.js';

export type HeldMove = { readonly projectId: number; readonly places: readonly PlacedPath[] };

export type HeldChange = { readonly threadId: string | null; readonly moved: HeldMove; readonly outcomes?: boolean };

export class HeldFeed extends Context.Service<
  HeldFeed,
  {
    publish(change: HeldChange): Effect.Effect<void>;
    heldChanged(subscriber: (change: HeldChange) => Effect.Effect<void>): () => void;
  }
>()('tagma/change-record/HeldFeed') {}
