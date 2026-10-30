import * as Effect from 'effect/Effect';
import type { InitializeStore } from '../store/wire.js';
import type { PerformanceStoreQuery } from '../protocol/queries.js';
import type { PerformanceReportMeta, RetainedRange } from '../protocol/reports.js';
import type { SegmentFailure } from '../SegmentCatalog.js';
import type { SegmentRing } from '../SegmentRing.js';
import type { PerformanceRecordUnreadable, ReportAnswer } from './answer.js';
import { pageFrom } from './page.js';
import { readCaptures, readGrowth, readMemory } from './memory.js';
import { readNames } from './names.js';
import { readStall, readStalls } from './stalls.js';
import { readBreakdown, readSlow, readTrace } from './spans.js';
import { readVitals } from './vitals.js';
import { readLosses } from './losses.js';
import { readCommands } from './commands.js';
import { readLoad } from './load.js';
import { readMetrics } from './metrics.js';
import { readOverview } from './overview.js';
import { readProfile, readProfiles } from './profiles.js';

export const reportMeta = (ring: SegmentRing): PerformanceReportMeta => {
  const standing = ring.catalog.standing.filter((segment) => segment.records > 0);
  const retainedRange: RetainedRange =
    standing.length === 0
      ? null
      : {
          from: Math.min(...standing.map((segment) => segment.firstWallTime)),
          to: Math.max(...standing.map((segment) => segment.lastWallTime)),
        };
  return {
    inheritedDrops: ring.catalog.dropCount,
    sessionDrops: 0,
    inheritedDroppedKinds: ring.catalog.droppedByKind,
    sessionDroppedKinds: {},
    retainedRange,
  };
};

export const readReport = Effect.fn('PerformanceWorker.readReport')(function* (
  ring: SegmentRing,
  options: InitializeStore,
  query: PerformanceStoreQuery,
  meta: PerformanceReportMeta,
): Effect.fn.Return<ReportAnswer, PerformanceRecordUnreadable | SegmentFailure> {
  switch (query.type) {
    case 'memory':
      return yield* readMemory(ring, meta);
    case 'captures':
      return yield* readCaptures(yield* ring.readersFor(pageFrom(query), undefined), query, meta);
    case 'growth':
      return yield* readGrowth(yield* ring.all, query, meta);
    case 'names':
      return yield* readNames(yield* ring.readersFor(query.since, undefined), query, meta);
    case 'stalls':
      return yield* readStalls(ring, query, meta);
    case 'stall':
      return yield* readStall(yield* ring.all, query, meta);
    case 'slow':
      return yield* readSlow(yield* ring.readersFor(query.since, undefined), query, meta);
    case 'trace':
      return yield* readTrace(yield* ring.all, query, meta);
    case 'breakdown':
      return yield* readBreakdown(yield* ring.all, query, meta);
    case 'vitals':
      return yield* readVitals(yield* ring.readersFor(pageFrom(query), undefined), query, meta);
    case 'metrics':
      return yield* readMetrics(yield* ring.all, query, meta);
    case 'overview':
      return yield* readOverview(yield* ring.all, options, query, meta);
    case 'profiles':
      return yield* readProfiles(yield* ring.readersFor(pageFrom(query), undefined), query, meta);
    case 'profile':
      return yield* readProfile(yield* ring.all, query, meta);
    case 'losses':
      return yield* readLosses(ring, query, meta);
    case 'commands':
      return yield* readCommands(yield* ring.readersFor(pageFrom(query), undefined), query, meta);
    case 'load':
      return yield* readLoad(yield* ring.readersFor(pageFrom(query), undefined), query, meta);
  }
});
