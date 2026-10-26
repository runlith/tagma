import * as Effect from 'effect/Effect';
import { and, asc, eq, gt, gte, isNull, or } from 'drizzle-orm';
import type { TimeCursor } from '../protocol/queries.js';
import type { SegmentReader } from '../SegmentRing.js';
import { performanceRecord } from '../schema.js';
import type { Readers, Row } from './answer.js';

export const HOUR_MS = 60 * 60 * 1_000;

export type TimePage = {
  readonly rows: ReadonlyArray<Row>;
  readonly next: TimeCursor | null;
};

const TIME_PAGE_KINDS = ['stall', 'vital', 'profile', 'memory', 'loss', 'command', 'load'] as const;
export type TimePageKind = (typeof TIME_PAGE_KINDS)[number];

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export const byTime = (left: { wallTime: number; id: string }, right: { wallTime: number; id: string }): number =>
  left.wallTime - right.wallTime || compareText(left.id, right.id);

export const fan = Effect.fnUntraced(function* <A, E>(
  readers: Readers,
  run: (reader: SegmentReader) => Effect.Effect<ReadonlyArray<A>, E>,
) {
  const found: Array<A> = [];
  for (const reader of readers) found.push(...(yield* run(reader)));
  return found;
});

export const firstOf = Effect.fnUntraced(function* <A, E>(
  readers: Readers,
  run: (reader: SegmentReader) => Effect.Effect<A | undefined, E>,
) {
  for (let at = readers.length - 1; at >= 0; at -= 1) {
    const found = yield* run(readers[at]!);
    if (found !== undefined) return found;
  }
  return undefined;
});

export const timePageConditions = (
  kind: TimePageKind,
  query: {
    readonly since?: number | undefined;
    readonly after?: TimeCursor | undefined;
  },
) =>
  [
    eq(performanceRecord.kind, kind),
    isNull(performanceRecord.name),
    query.since === undefined ? undefined : gte(performanceRecord.wallTime, query.since),
    query.after === undefined
      ? undefined
      : or(
          gt(performanceRecord.wallTime, query.after.wallTime),
          and(eq(performanceRecord.wallTime, query.after.wallTime), gt(performanceRecord.id, query.after.id)),
        ),
  ].filter((condition) => condition !== undefined);

export const pageFrom = (query: { readonly since?: number | undefined; readonly after?: TimeCursor | undefined }) =>
  query.after === undefined ? query.since : Math.max(query.after.wallTime, query.since ?? query.after.wallTime);

export const timePage = Effect.fn('PerformanceWorker.timePage')(function* (
  readers: Readers,
  kind: TimePageKind,
  query: {
    readonly since?: number | undefined;
    readonly after?: TimeCursor | undefined;
    readonly limit: number;
  },
) {
  const rows = yield* fan(readers, (reader) =>
    reader.db
      .select()
      .from(performanceRecord)
      .where(and(...timePageConditions(kind, query)))
      .orderBy(asc(performanceRecord.wallTime), asc(performanceRecord.id))
      .limit(query.limit + 1),
  );
  rows.sort(byTime);
  const visible = rows.slice(0, query.limit);
  const last = rows.length > query.limit ? visible.at(-1) : undefined;
  return {
    rows: visible,
    next: last === undefined ? null : { wallTime: last.wallTime, id: last.id },
  } satisfies TimePage;
});
