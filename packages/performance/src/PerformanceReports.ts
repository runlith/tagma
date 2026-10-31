import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { CostLedger } from './CostLedger.js';
import { WriterMetrics } from './WriterMetrics.js';
import type { LossKindCounts } from './protocol/records.js';
import type { PerformancePointQuery, PerformanceQuery } from './protocol/queries.js';
import type { LedgerReport, PerformanceReport, RetainedRange } from './protocol/reports.js';
import { PerformanceStoreReader } from './store/store.js';
import { PerformanceReportUnavailable, PerformanceStoreQueryFailed, PerformanceStoreUnavailable } from './store/records.js';

export class PerformanceReportMissing extends Data.TaggedError('PerformanceReportMissing')<{
  readonly query: PerformancePointQuery;
  readonly inheritedDrops: number | null;
  readonly sessionDrops: number;
  readonly inheritedDroppedKinds: LossKindCounts | null;
  readonly sessionDroppedKinds: LossKindCounts;
  readonly retainedRange: RetainedRange;
}> {
  override get message(): string {
    return `${this.query.type} report ${this.query.id} was not found`;
  }
}

export type PerformanceReportsFailure =
  | PerformanceReportMissing
  | PerformanceReportUnavailable
  | PerformanceStoreQueryFailed
  | PerformanceStoreUnavailable;

export class PerformanceReports extends Context.Service<
  PerformanceReports,
  {
    readonly read: (query: PerformanceQuery) => Effect.Effect<PerformanceReport, PerformanceReportsFailure>;
  }
>()('@runlith/performance/PerformanceReports') {}

export const performanceReportsLayer = Layer.effect(
  PerformanceReports,
  Effect.gen(function* () {
    const reader = yield* PerformanceStoreReader;
    const ledger = yield* Effect.serviceOption(CostLedger);
    const writers = yield* Effect.serviceOption(WriterMetrics);
    return PerformanceReports.of({
      read: (query) => {
        if (query.type === 'ledger') {
          return ledger._tag === 'None'
            ? Effect.fail(
                new PerformanceStoreUnavailable({ message: 'the process cost ledger is unavailable; it retains no durable history' }),
              )
            : Effect.sync((): LedgerReport => ({ type: 'ledger', ...ledger.value.read(query) }));
        }
        if (query.type === 'writer-units' || query.type === 'writer-metrics') {
          if (writers._tag === 'None')
            return Effect.fail(
              new PerformanceStoreUnavailable({ message: 'the process writer metrics are unavailable; they retain no durable history' }),
            );
          return query.type === 'writer-units'
            ? Effect.sync(() => ({ type: 'writer-units' as const, ...writers.value.units(query) }))
            : Effect.sync(() => ({ type: 'writer-metrics' as const, ...writers.value.metrics(query) }));
        }
        return reader.read(query).pipe(
          Effect.flatMap((result) =>
            result._tag === 'Found'
              ? Effect.succeed(result.report)
              : Effect.fail(
                  new PerformanceReportMissing({
                    query: result.query,
                    inheritedDrops: result.meta.inheritedDrops,
                    sessionDrops: result.meta.sessionDrops,
                    inheritedDroppedKinds: result.meta.inheritedDroppedKinds,
                    sessionDroppedKinds: result.meta.sessionDroppedKinds,
                    retainedRange: result.meta.retainedRange,
                  }),
                ),
          ),
        );
      },
    });
  }),
);
