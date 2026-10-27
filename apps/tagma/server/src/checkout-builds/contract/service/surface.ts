import { Context, type Effect } from 'effect';
import type { FieldRefusal, GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { RefusalOf } from '../../../platform/contract/service/body.js';
import type { DEV_SURFACE_OPERATIONS } from '../wire/operations.js';

export type SurfaceServed = { readonly url: string; readonly started: boolean };

export type SurfaceRefusal = RefusalOf<(typeof DEV_SURFACE_OPERATIONS)['start_dev_surface']> | FieldRefusal;

export class DevSurface extends Context.Service<
  DevSurface,
  {
    readonly serve: Effect.Effect<SurfaceServed, GateRefusal<SurfaceRefusal> | StoreFailure>;
  }
>()('tagma/checkout-builds/DevSurface') {}
