import { ProcessPool } from '../ProcessPool';
import type { Hosting } from '../hosting';
import { inlineHosting } from '../inline';
import { childHosting } from '../children';
import { hold, release } from '@runlith/testbed/fixture';
import { kind, shared } from '@runlith/testbed/worlds';
import { Context, Effect } from 'effect';

const HOSTING_ENV = 'RUNLITH_SQLITE_HOSTING';
const SEED_ENV = 'RUNLITH_TEST_SEED';
const WORKER_ENV = 'BUN_TEST_WORKER_ID';
const ONE_IN = 4;

const hashOf = (text: string): number => {
  let hash = 2166136261;
  for (let at = 0; at < text.length; at++) hash = Math.imul(hash ^ text.charCodeAt(at), 16777619);
  return hash >>> 0;
};

export const hostingOfRun = (env: Readonly<Record<string, string | undefined>> = process.env): Hosting => {
  const forced = env[HOSTING_ENV];
  if (forced === 'child') return childHosting;
  if (forced === 'inline') return inlineHosting;
  const seed = env[SEED_ENV];
  if (seed === undefined || seed === '') return inlineHosting;
  return hashOf(`${seed}:${env[WORKER_ENV] ?? ''}`) % ONE_IN === 0 ? childHosting : inlineHosting;
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
