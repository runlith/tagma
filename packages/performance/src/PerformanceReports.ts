import * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { LossKindCounts } from './protocol/records.js';
import type { PerformancePointQuery, PerformanceQuery } from './protocol/queries.js';
import type { PerformanceReport, RetainedRange } from './protocol/reports.js';
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
    return PerformanceReports.of({
      read: (query) =>
        reader.read(query).pipe(
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
        ),
    });
  }),
);
