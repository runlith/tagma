import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer, Schema } from 'effect';
import { CostLedger, costLedgerLayer } from './CostLedger.js';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';
import { performanceQuerySchema } from './protocol/queries.js';
import { PerformanceStoreReader } from './store/store.js';

const reports = performanceReportsLayer.pipe(
  Layer.provide(
    Layer.succeed(
      PerformanceStoreReader,
      PerformanceStoreReader.of({
        read: () => Effect.die('a cost-ledger query must not read the retained store'),
      }),
    ),
  ),
);

it.effect('ledger queries read live counters without storage and an unmounted process answers explicitly unavailable', () =>
  Effect.gen(function* () {
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 1 })));
    ledger.open('act', 'root').counts.statements = 3;
    const query = yield* Schema.decodeUnknownEffect(performanceQuerySchema)({ type: 'ledger', rootId: 'root', limit: 1 });
    const page = yield* PerformanceReports.use((owner) => owner.read(query)).pipe(
      Effect.provide(reports),
      Effect.provideService(CostLedger, ledger),
    );
    expect(page).toEqual({ type: 'ledger', ...ledger.read({ rootId: 'root', limit: 1 }) });
    const unavailable = yield* PerformanceReports.use((owner) => owner.read(query)).pipe(Effect.provide(reports), Effect.result);
    expect(unavailable).toMatchObject({ _tag: 'Failure', failure: { _tag: 'PerformanceStoreUnavailable' } });
  }),
);
