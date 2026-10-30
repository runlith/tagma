import { ProcessPool } from '../ProcessPool';
import { inlineHosting } from '../inline';
import { childHosting } from '../children';
import { kind, shared } from '@runlith/testbed/worlds';
import { Context, Effect } from 'effect';

export const heldPool = Effect.acquireRelease(
  Effect.sync(() => new ProcessPool(undefined, 'keep', undefined, inlineHosting)),
  (pool) => Effect.promise(() => pool.close()),
);

export const childPool = (ceiling?: number): ProcessPool => new ProcessPool(ceiling, 'stop', undefined, childHosting);

class SharedPool extends Context.Service<SharedPool, ProcessPool>()('testing/SharedPool') {}
const poolWorld = kind(SharedPool, (_params: null) => heldPool);
export const sharedPool: Effect.Effect<ProcessPool> = shared(poolWorld, null);
