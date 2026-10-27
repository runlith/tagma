import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { DevSurface } from './contract/service/surface.js';
import { DEV_SURFACE_OPERATIONS as OPS } from './contract/wire/operations.js';

export const SURFACE_PAIRS = {
  start_dev_surface: pair(
    OPS.start_dev_surface,
    body(OPS.start_dev_surface, {
      execute: Effect.fnUntraced(function* () {
        const served = yield* (yield* DevSurface).serve;
        return { status: 'ready' as const, ...served };
      }),
    }),
  ),
};
