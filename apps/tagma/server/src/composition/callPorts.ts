import { Context, Effect } from 'effect';
import { CommitHooks } from '../enforcement/commits/hooks.js';
import { actorRefOfTerminal, custodianOf } from '../executions/terminals/principals.js';
import { RegisteredRoots } from '../graph/contract/service/registeredRoots.js';
import { CacheCurves } from '../providers/contract/service/quota.js';
import { CacheWarmth } from '../threads/contract/service/evidence.js';
import { CheckoutActor } from '../workspace/contract/service/checkouts.js';

export type PortFillers = CommitHooks | CacheWarmth;

const checkoutActor: CheckoutActor['Service'] = {
  resolve: (actor, projectId) => {
    const answered = custodianOf(actor, projectId);
    return answered._tag === 'TerminalRefused' ? null : actorRefOfTerminal(answered);
  },
};

const registeredRoots = (hooks: CommitHooks['Service']): RegisteredRoots['Service'] => ({
  joined: hooks.install,
  left: hooks.uninstall,
});

const cacheCurves = (warmth: CacheWarmth['Service']): CacheCurves['Service'] => ({
  readings: () => Effect.orDie(warmth.cacheCurves()),
});

export const callPorts = (fillers: Context.Context<PortFillers>) =>
  Context.make(CheckoutActor, checkoutActor).pipe(
    Context.add(RegisteredRoots, registeredRoots(Context.get(fillers, CommitHooks))),
    Context.add(CacheCurves, cacheCurves(Context.get(fillers, CacheWarmth))),
  );
