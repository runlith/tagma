import { Effect, Layer } from 'effect';
import { capacity } from '@runlith/held/Capacity';
import { WatchTickets } from '../contract/service/watch.js';
import { machineWatchLimits, watchBudget } from './limits.js';

const WATCH_HANDLES = 'watch-handles';
const WATCH = { name: 'watch', class: 'call', needs: [{ pool: WATCH_HANDLES, units: 1 }] } as const;

export const watchTickets = (budget: number): WatchTickets['Service'] => {
  const ledger =
    budget === 0
      ? null
      : capacity([{ name: WATCH_HANDLES, units: budget, limits: { call: budget, background: budget } }], {
          admission: 0,
          queued: 0,
        });
  return WatchTickets.of({
    grant: () => (ledger === null ? Effect.succeed(null) : ledger.tryLease(WATCH)),
    standing: () => ({ budget, active: ledger?.standing()[0]?.taken.call ?? 0 }),
  });
};

export const watchTicketsLayer = Layer.effect(
  WatchTickets,
  Effect.map(machineWatchLimits, (limits) => watchTickets(watchBudget(limits))),
);
