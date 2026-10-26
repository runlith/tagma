import { Context, type Effect } from 'effect';
import type { Caller } from '../wire/caller.js';
import type { Place, SubjectKind } from '../wire/place.js';
import type { GateRefusal } from '../wire/refusal.js';
import type { StoreFailure } from './store.js';

export const CallPlace = Context.Reference<Place | null>('tagma/platform/CallPlace', { defaultValue: () => null });

export const CallerAim = Context.Reference<{
  readonly project: string | undefined;
  readonly cwd: string | undefined;
  readonly branch: string | undefined;
} | null>('tagma/platform/CallerAim', { defaultValue: () => null });

export const SubjectProject = Context.Reference<number | null>('tagma/platform/SubjectProject', { defaultValue: () => null });

export interface PlaceScoped {
  readonly placeScoped: true;
}

export type SubjectPlace = {
  readonly kind: SubjectKind;
  readonly place: (value: string, operation: string, caller: Caller) => Effect.Effect<Place | null, GateRefusal | StoreFailure, any>;
  readonly call?: () => Context.Context<never>;
  readonly canonical?: (value: string, caller: Caller) => Effect.Effect<string | null, GateRefusal | StoreFailure, any>;
};
