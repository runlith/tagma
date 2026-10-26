import * as Effect from 'effect/Effect';
import { NAME_KINDS } from '../protocol/queries.js';
import type { PerformanceQuery } from '../protocol/queries.js';
import type { PerformanceReportMeta } from '../protocol/reports.js';
import { type Readers, type ReportAnswer } from './answer.js';
import { compareText } from './page.js';
import type { SegmentReader } from '../SegmentRing.js';
import { performanceRecord } from '../schema.js';
import { and, asc, eq, gt, gte, isNotNull } from 'drizzle-orm';

export const namesOf = Effect.fn('PerformanceWorker.namesOf')(function* (
  reader: SegmentReader,
  kind: (typeof NAME_KINDS)[number],
  query: Extract<PerformanceQuery, { readonly type: 'names' }>,
) {
  const page: string[] = [];
  let after = query.after?.[kind];
  while (page.length <= query.limit) {
    const seek: string | undefined = after;
    const row = yield* reader.db
      .select({ name: performanceRecord.name })
      .from(performanceRecord)
      .where(
        and(
          eq(performanceRecord.kind, kind),
          isNotNull(performanceRecord.name),
          seek === undefined ? undefined : gt(performanceRecord.name, seek),
          query.since === undefined ? undefined : gte(performanceRecord.wallTime, query.since),
        ),
      )
      .orderBy(asc(performanceRecord.name))
      .limit(1)
      .get();
    const name = row?.name;
    if (name === undefined || name === null) break;
    page.push(name);
    after = name;
  }
  return page;
});

export const readNames = Effect.fn('PerformanceWorker.readNames')(function* (
  readers: Readers,
  query: Extract<PerformanceQuery, { readonly type: 'names' }>,
  meta: PerformanceReportMeta,
) {
  const names = new Map<
    (typeof NAME_KINDS)[number],
    { readonly page: string[]; readonly at: string | undefined; readonly more: boolean }
  >();
  for (const kind of NAME_KINDS) {
    const found = new Set<string>();
    for (const reader of readers) {
      for (const name of yield* namesOf(reader, kind, query)) found.add(name);
    }
    const page = [...found].sort(compareText).slice(0, query.limit + 1);
    const visible = page.slice(0, query.limit);
    names.set(kind, {
      page: visible,
      at: visible.at(-1) ?? query.after?.[kind],
      more: page.length > query.limit,
    });
  }
  const spans = names.get('span')!;
  const metrics = names.get('metric')!;
  return {
    _tag: 'Found',
    report: {
      type: 'names',
      ...meta,
      spanNames: spans.page,
      metricNames: metrics.page,
      evidence: 'retained-only',
      next:
        spans.more || metrics.more
          ? {
              span: spans.at,
              metric: metrics.at,
            }
          : null,
    },
  } satisfies ReportAnswer;
});
