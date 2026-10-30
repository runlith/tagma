import { ProcessPool } from '../ProcessPool';
import type { Hosting } from '../hosting';
import { inlineHosting } from '../inline';
import { childHosting } from '../children';
import { sampledShare } from '@runlith/testbed/sampling';
import { hold, release } from '@runlith/testbed/fixture';
import { kind, shared } from '@runlith/testbed/worlds';
import { Context, Effect } from 'effect';

const HOSTING_ENV = 'RUNLITH_SQLITE_HOSTING';
const SEED_ENV = 'RUNLITH_TEST_SEED';
const WORKER_ENV = 'BUN_TEST_WORKER_ID';

export const hostingOfRun = (env: Readonly<Record<string, string | undefined>> = process.env): Hosting => {
  const forced = env[HOSTING_ENV];
  if (forced === 'child') return childHosting;
  if (forced === 'inline') return inlineHosting;
  const seed = env[SEED_ENV];
  if (seed === undefined || seed === '') return inlineHosting;
  return sampledShare(seed, env[WORKER_ENV] ?? '') ? childHosting : inlineHosting;
};

export const heldPool = Effect.acquireRelease(
  Effect.sync(
    () =>
      new ProcessPool(
        undefined,
        'keep',
        (pid) => {
          hold(pid);
          return () => release(pid);
        },
        hostingOfRun(),
      ),
  ),
  (pool) => Effect.promise(() => pool.close()),
);

export const childPool = (ceiling?: number): ProcessPool => new ProcessPool(ceiling, 'stop', undefined, childHosting);

class SharedPool extends Context.Service<SharedPool, ProcessPool>()('testing/SharedPool') {}
const poolWorld = kind(SharedPool, (_params: null) => heldPool);
export const sharedPool: Effect.Effect<ProcessPool> = shared(poolWorld, null);
