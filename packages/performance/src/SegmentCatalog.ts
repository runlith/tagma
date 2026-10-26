import * as Effect from 'effect/Effect';
import type { SqlError } from 'effect/sql/SqlError';
import type { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { PERFORMANCE_RECORD_KINDS, type LossKindCounts, type PerformanceRecordKind } from './protocol/records.js';
import { performanceMeta, performanceSegment, type SegmentState } from './schema.js';

const DROP_COUNT = 'drop_count';
const DROP_KIND_PREFIX = 'drop_kind_';

const dropKindKey = (kind: PerformanceRecordKind): string => `${DROP_KIND_PREFIX}${kind}`;

export type Segment = {
  readonly startedAt: number;
  state: SegmentState;
  firstWallTime: number;
  lastWallTime: number;
  bytes: number;
  records: number;
  readonly counts: Map<PerformanceRecordKind, number>;
  deletedAt: number | null;
  deletedBy: string | null;
};

export type SegmentWindow = { readonly first: number; readonly last: number };

export type SegmentFailure = EffectDrizzleQueryError | SqlError;

const EMPTY_FIRST = Number.POSITIVE_INFINITY;
const EMPTY_LAST = Number.NEGATIVE_INFINITY;

const asCounts = (counts: ReadonlyMap<PerformanceRecordKind, number>): LossKindCounts =>
  Object.fromEntries([...counts].filter(([, count]) => count > 0)) as LossKindCounts;

export const countsOf = (segment: Segment): LossKindCounts => asCounts(segment.counts);

const readCounts = (text: string): Map<PerformanceRecordKind, number> => {
  const counts = new Map<PerformanceRecordKind, number>();
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object') return counts;
  for (const [kind, count] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof count !== 'number' || count <= 0) continue;
    if (!(PERFORMANCE_RECORD_KINDS as readonly string[]).includes(kind)) continue;
    counts.set(kind as PerformanceRecordKind, count);
  }
  return counts;
};

export const makeSegmentCatalog = (db: EffectSQLiteBunDatabase) => {
  const segments = new Map<number, Segment>();
  let standingBytes = 0;
  let drops = 0;
  const droppedKinds = new Map<PerformanceRecordKind, number>();

  const standing = (): ReadonlyArray<Segment> =>
    [...segments.values()].filter((segment) => segment.state !== 'deleted').sort((left, right) => left.startedAt - right.startedAt);

  const write = (segment: Segment): Effect.Effect<void, SegmentFailure> => {
    const values = {
      startedAt: segment.startedAt,
      state: segment.state,
      firstWallTime: segment.records === 0 ? 0 : segment.firstWallTime,
      lastWallTime: segment.records === 0 ? 0 : segment.lastWallTime,
      bytes: segment.bytes,
      records: segment.records,
      counts: JSON.stringify(Object.fromEntries(segment.counts)),
      deletedAt: segment.deletedAt,
      deletedBy: segment.deletedBy,
    };
    return db
      .insert(performanceSegment)
      .values(values)
      .onConflictDoUpdate({ target: performanceSegment.startedAt, set: values })
      .pipe(Effect.asVoid);
  };

  const put = (key: string, value: number): Effect.Effect<void, SegmentFailure> =>
    db
      .insert(performanceMeta)
      .values({ key, value })
      .onConflictDoUpdate({ target: performanceMeta.key, set: { value } })
      .pipe(Effect.asVoid);

  const writeDrops = Effect.fnUntraced(function* () {
    yield* put(DROP_COUNT, drops);
    for (const [kind, count] of droppedKinds) yield* put(dropKindKey(kind), count);
  });

  const resize = (segment: Segment, bytes: number): void => {
    if (segment.state !== 'deleted') standingBytes += bytes - segment.bytes;
    segment.bytes = bytes;
  };

  return {
    get storedBytes(): number {
      return standingBytes;
    },
    get dropCount(): number {
      return drops;
    },
    get droppedByKind(): LossKindCounts {
      return asCounts(droppedKinds);
    },
    get standing(): ReadonlyArray<Segment> {
      return standing();
    },
    get open(): Segment | undefined {
      return [...segments.values()].find((segment) => segment.state === 'open');
    },
    get lastStartedAt(): number {
      let last = 0;
      for (const startedAt of segments.keys()) last = Math.max(last, startedAt);
      return last;
    },
    get evicted(): ReadonlyArray<Segment> {
      return [...segments.values()]
        .filter((segment) => segment.state === 'deleted')
        .sort((left, right) => (right.deletedAt ?? 0) - (left.deletedAt ?? 0));
    },
    overlapping: (since: number | undefined, until: number | undefined): ReadonlyArray<Segment> =>
      standing().filter(
        (segment) =>
          segment.records > 0 &&
          (since === undefined || segment.lastWallTime >= since) &&
          (until === undefined || segment.firstWallTime <= until),
      ),
    load: Effect.fnUntraced(function* () {
      const rows = yield* db.select().from(performanceSegment);
      segments.clear();
      standingBytes = 0;
      for (const row of rows) {
        const empty = row.records === 0;
        const segment: Segment = {
          startedAt: row.startedAt,
          state: row.state,
          firstWallTime: empty ? EMPTY_FIRST : row.firstWallTime,
          lastWallTime: empty ? EMPTY_LAST : row.lastWallTime,
          bytes: row.bytes,
          records: row.records,
          counts: readCounts(row.counts),
          deletedAt: row.deletedAt,
          deletedBy: row.deletedBy,
        };
        segments.set(segment.startedAt, segment);
        if (segment.state !== 'deleted') standingBytes += segment.bytes;
      }
      const meta = yield* db.select().from(performanceMeta);
      drops = 0;
      droppedKinds.clear();
      for (const row of meta) {
        if (row.key === DROP_COUNT) {
          drops = row.value;
          continue;
        }
        if (!row.key.startsWith(DROP_KIND_PREFIX) || row.value <= 0) continue;
        const kind = row.key.slice(DROP_KIND_PREFIX.length);
        if (!(PERFORMANCE_RECORD_KINDS as readonly string[]).includes(kind)) continue;
        droppedKinds.set(kind as PerformanceRecordKind, row.value);
      }
    }),
    add: Effect.fnUntraced(function* (startedAt: number, state: SegmentState) {
      const segment: Segment = {
        startedAt,
        state,
        firstWallTime: EMPTY_FIRST,
        lastWallTime: EMPTY_LAST,
        bytes: 0,
        records: 0,
        counts: new Map(),
        deletedAt: null,
        deletedBy: null,
      };
      segments.set(startedAt, segment);
      yield* write(segment);
      return segment;
    }),
    observe: (
      segment: Segment,
      added: {
        readonly records: number;
        readonly kinds: ReadonlyMap<PerformanceRecordKind, number>;
        readonly firstWallTime: number;
        readonly lastWallTime: number;
      },
      bytes: number,
    ): Effect.Effect<void, SegmentFailure> => {
      segment.records += added.records;
      for (const [kind, count] of added.kinds) segment.counts.set(kind, (segment.counts.get(kind) ?? 0) + count);
      segment.firstWallTime = Math.min(segment.firstWallTime, added.firstWallTime);
      segment.lastWallTime = Math.max(segment.lastWallTime, added.lastWallTime);
      resize(segment, bytes);
      return write(segment);
    },
    resize,
    seal: (segment: Segment, window: SegmentWindow | undefined, bytes: number): Effect.Effect<void, SegmentFailure> => {
      segment.state = 'sealed';
      if (window !== undefined) {
        segment.firstWallTime = Math.min(segment.firstWallTime, window.first);
        segment.lastWallTime = Math.max(segment.lastWallTime, window.last);
      }
      resize(segment, bytes);
      return write(segment);
    },
    remove: Effect.fnUntraced(function* (segment: Segment, at: number, instanceId: string) {
      standingBytes -= segment.bytes;
      segment.state = 'deleted';
      segment.deletedAt = at;
      segment.deletedBy = instanceId;
      drops += segment.records;
      for (const [kind, count] of segment.counts) droppedKinds.set(kind, (droppedKinds.get(kind) ?? 0) + count);
      yield* write(segment);
      yield* writeDrops();
    }),
    addDrops: (kinds: LossKindCounts): Effect.Effect<void, SegmentFailure> => {
      let added = 0;
      for (const [kind, count] of Object.entries(kinds)) {
        if (count === undefined || count <= 0) continue;
        added += count;
        const key = kind as PerformanceRecordKind;
        droppedKinds.set(key, (droppedKinds.get(key) ?? 0) + count);
      }
      if (added === 0) return Effect.void;
      drops += added;
      return writeDrops();
    },
  };
};

export type SegmentCatalog = ReturnType<typeof makeSegmentCatalog>;
