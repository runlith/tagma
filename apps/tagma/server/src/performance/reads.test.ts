import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { CostLedger, costLedgerLayer } from '@runlith/performance/CostLedger';
import { Effect } from 'effect';
import { readHostPerformance } from './reads.js';

it.effect('a host ledger read cannot return the calling server ledger or open a retained ring', () =>
  Effect.gen(function* () {
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 1 })));
    ledger.open('server').counts.statements = 3;
    const result = yield* readHostPerformance('/no-host-ring', { type: 'ledger', limit: 1 }).pipe(
      Effect.provideService(CostLedger, ledger),
    );
    expect(result.type).toBe('unavailable');
  }),
);
