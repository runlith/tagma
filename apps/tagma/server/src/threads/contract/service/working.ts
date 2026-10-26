import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ServedGraph } from '../../../graph/contract/service/serving.js';
import type { InstructionSet } from '../../../graph/contract/wire/instructions.js';
import type { CheckoutPlace, PlaceUnread } from '../../../workspace/contract/service/checkoutPaths.js';
import type { GraphOrigin } from '../wire/target.js';

export type PendingCopies = { readonly copies: readonly GraphOrigin[]; readonly through: Date };

export class WorkPlaces extends Context.Service<
  WorkPlaces,
  {
    held(threadId: string): Effect.Effect<readonly GraphOrigin[], StoreFailure>;
    worked(threadId: string): Effect.Effect<readonly GraphOrigin[], StoreFailure | PlaceUnread>;
    taking(threadId: string): Effect.Effect<PendingCopies, StoreFailure | PlaceUnread>;
    handed(threadId: string, pending: PendingCopies): Effect.Effect<void, StoreFailure>;
    locate(path: string): Effect.Effect<GraphOrigin | null, PlaceUnread>;
    resource(path: string): Effect.Effect<CheckoutPlace | null, PlaceUnread>;
    checkoutOf(path: string): Effect.Effect<CheckoutPlace | null, PlaceUnread>;
    within(directory: string): Effect.Effect<readonly GraphOrigin[], PlaceUnread>;
    graphAt(place: GraphOrigin): Effect.Effect<ServedGraph, GateRefusal>;
    enter(input: {
      readonly threadId: string;
      readonly home: number;
      readonly place: GraphOrigin;
      readonly mutates: boolean;
      readonly law?: InstructionSet | null;
      readonly toolCallId?: string;
    }): Effect.Effect<void, StoreFailure | GateRefusal>;
    acted(input: { readonly threadId: string; readonly home: number; readonly place: GraphOrigin }): Effect.Effect<void, StoreFailure>;
    leave(threadId: string, projectId: number): Effect.Effect<void, StoreFailure>;
  }
>()('tagma/threads/WorkPlaces') {}
