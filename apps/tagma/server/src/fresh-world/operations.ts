import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { FreshWorld } from './contract/service/world.js';
import { FRESH_OPERATIONS as OPS } from './contract/wire/operations.js';

export const FRESH_PAIRS = {
  open_fresh_world: pair(
    OPS.open_fresh_world,
    body(OPS.open_fresh_world, {
      execute: Effect.fnUntraced(function* (input) {
        const opened = yield* (yield* FreshWorld).open({
          over: input.over ?? false,
          release: input.release ?? null,
          from: input.from ?? null,
        });
        return { status: 'opened' as const, ...opened };
      }),
    }),
  ),
  read_fresh_world: pair(
    OPS.read_fresh_world,
    body(OPS.read_fresh_world, {
      execute: Effect.fnUntraced(function* () {
        const standing = yield* (yield* FreshWorld).read;
        return { status: 'read' as const, ...standing };
      }),
    }),
  ),
};
