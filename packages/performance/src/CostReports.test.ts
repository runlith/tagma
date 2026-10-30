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
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 2 })));
    ledger.open('act', 'root').counts.statements = 3;
    ledger.open('second', 'second').counts.statements = 4;
    const query = yield* Schema.decodeUnknownEffect(performanceQuerySchema)({ type: 'ledger', limit: 1 });
    const page = yield* PerformanceReports.use((owner) => owner.read(query)).pipe(
      Effect.provide(reports),
      Effect.provideService(CostLedger, ledger),
    );
    expect(page).toEqual({ type: 'ledger', ...ledger.read({ limit: 1 }) });
    if (page.type !== 'ledger' || page.next === null) return yield* Effect.die('the first page must carry a ledger continuation');
    const continued = yield* Schema.decodeUnknownEffect(performanceQuerySchema)({ type: 'ledger', after: page.next, limit: 1 });
    const next = yield* PerformanceReports.use((owner) => owner.read(continued)).pipe(
      Effect.provide(reports),
      Effect.provideService(CostLedger, ledger),
    );
    expect(next).toEqual({ type: 'ledger', ...ledger.read({ limit: 1, after: page.next }) });
    const unavailable = yield* PerformanceReports.use((owner) => owner.read(query)).pipe(Effect.provide(reports), Effect.result);
    expect(unavailable).toMatchObject({ _tag: 'Failure', failure: { _tag: 'PerformanceStoreUnavailable' } });
  }),
);
