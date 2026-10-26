import * as SqliteClient from '@effect/sql-sqlite-bun/SqliteClient';
import * as Clock from 'effect/Clock';
import * as Data from 'effect/Data';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as Scope from 'effect/Scope';
import { asc, desc, getTableName, sql } from 'drizzle-orm';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { makeWithDefaults } from 'drizzle-orm/effect-sqlite-bun';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { monotonicMs } from './monotonic.js';
import type { LossKindCounts, PerformanceRecordKind } from './protocol/records.js';
import { makeSegmentCatalog, type SegmentCatalog, type Segment, type SegmentFailure, type SegmentWindow } from './SegmentCatalog.js';
import { CATALOG_DDL, SEGMENT_DDL, performanceMeta, performanceRecord } from './schema.js';

export type Database = EffectSQLiteBunDatabase;

const HOUR_MS = 60 * 60 * 1_000;
const SEGMENT_SHARE = 16;
const MIN_SEGMENT_BYTES = 1024 * 1024;
const MAX_SEGMENT_BYTES = 512 * 1024 * 1024;
const WRITER_CACHE_KIB = 64 * 1024;
const READER_CACHE_KIB = 8 * 1024;
const LOG_SIZE_LIMIT = 8 * 1024 * 1024;
const MEMORY = ':memory:';

const schemaText = (statement: string): string =>
  statement
    .replace(/\bif\s+not\s+exists\s+/giu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^CREATE (TABLE|INDEX) /u, (text) => text.toLowerCase());

const catalogSchema = CATALOG_DDL.map(schemaText).sort();
const segmentSchema = SEGMENT_DDL.map(schemaText).sort();

const hasSchema = (db: Database, expected: readonly string[]): Effect.Effect<boolean, SegmentFailure> =>
  db.all<{ definition: string }>(sql`select sql as definition from sqlite_master where sql is not null and name not like 'sqlite_%'`).pipe(
    Effect.map((rows) => {
      const actual = rows.map((row) => schemaText(row.definition)).sort();
      return actual.length === expected.length && actual.every((definition, at) => definition === expected[at]);
    }),
  );

export const segmentBytesFor = (maxStoredBytes: number): number =>
  Math.min(MAX_SEGMENT_BYTES, Math.max(MIN_SEGMENT_BYTES, Math.floor(maxStoredBytes / SEGMENT_SHARE)));

export const ringRoot = (path: string): string =>
  path === MEMORY ? MEMORY : path.endsWith('.sqlite') ? path.slice(0, -'.sqlite'.length) : `${path}.ring`;

export class SegmentOpenFailed extends Data.TaggedError('SegmentOpenFailed')<{
  readonly message: string;
}> {}

type Connection = { readonly db: Database; readonly scope: Scope.Closeable };

type Opened = { readonly segment: Segment; readonly connection: Connection };

export type SegmentReader = {
  readonly segment: Segment;
  readonly db: Database;
};

export type SegmentWrite = {
  readonly rows: ReadonlyArray<typeof performanceRecord.$inferInsert>;
  readonly kinds: ReadonlyMap<PerformanceRecordKind, number>;
  readonly firstWallTime: number;
  readonly lastWallTime: number;
  readonly groups: ReadonlySet<string>;
  readonly chunk: number;
};

export type EvictionStep = {
  readonly evicted: number;
  readonly records: number;
  readonly kinds: LossKindCounts;
  readonly elapsedMs: number;
  readonly blocked: boolean;
};

const openConnection = Effect.fnUntraced(function* (
  filename: string,
  options: { readonly readonly: boolean; readonly busyTimeout: Duration.Duration },
) {
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(
    SqliteClient.layer({
      filename,
      busyTimeout: options.busyTimeout,
      readonly: options.readonly ? true : undefined,
      disableWAL: options.readonly ? true : undefined,
    }),
    scope,
  ).pipe(Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))));
  const db = yield* makeWithDefaults().pipe(Effect.provide(context));
  return { db, scope };
});

const closeConnection = (connection: Connection): Effect.Effect<void> => Scope.close(connection.scope, Exit.void);

const hasRingSchema = Effect.fnUntraced(function* (connection: Connection, root: string, busyTimeout: Duration.Duration) {
  if (!(yield* hasSchema(connection.db, catalogSchema))) return false;
  const segments = yield* connection.db.all<{ startedAt: number }>(
    sql`select started_at as startedAt from performance_segment where state != 'deleted'`,
  );
  for (const segment of segments) {
    const path = join(root, 'segments', `${segment.startedAt}.sqlite`);
    if (!existsSync(path)) return yield* new SegmentOpenFailed({ message: `the performance ring is missing segment ${path}` });
    const probe = yield* openConnection(path, { readonly: true, busyTimeout });
    const matches = yield* hasSchema(probe.db, segmentSchema).pipe(Effect.ensuring(closeConnection(probe)));
    if (!matches) return false;
  }
  return true;
});

const discardTelemetryFile = Effect.fnUntraced(function* (path: string, busyTimeout: Duration.Duration) {
  if (!existsSync(path) || !statSync(path).isFile()) return;
  const probe = yield* openConnection(path, { readonly: true, busyTimeout });
  const tables = yield* probe.db
    .all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`)
    .pipe(Effect.ensuring(closeConnection(probe)));
  const record = getTableName(performanceRecord);
  const meta = getTableName(performanceMeta);
  if (!tables.some((table) => table.name === record) || tables.some((table) => table.name !== record && table.name !== meta)) return;
  yield* Effect.try({
    try: () => {
      for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) rmSync(file, { force: true });
    },
    catch: (cause) => new SegmentOpenFailed({ message: String(cause) }),
  });
});

const fileBytes = (path: string): number => {
  let bytes = 0;
  for (const candidate of [path, `${path}-wal`]) {
    if (existsSync(candidate)) bytes += statSync(candidate).size;
  }
  return bytes;
};

const logBytesOf = (path: string): number => (existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0);

const readWindow = Effect.fnUntraced(function* (db: Database) {
  const first = yield* db
    .select({ wallTime: performanceRecord.wallTime })
    .from(performanceRecord)
    .orderBy(asc(performanceRecord.wallTime), asc(performanceRecord.id))
    .limit(1)
    .get();
  if (first === undefined) return undefined;
  const last = yield* db
    .select({ wallTime: performanceRecord.wallTime })
    .from(performanceRecord)
    .orderBy(desc(performanceRecord.wallTime), desc(performanceRecord.id))
    .limit(1)
    .get();
  return { first: first.wallTime, last: last?.wallTime ?? first.wallTime } satisfies SegmentWindow;
});

const makeRing = ({
  catalog,
  root,
  instanceId,
  busyTimeout,
  catalogConnection,
}: {
  readonly catalog: SegmentCatalog;
  readonly root: string;
  readonly instanceId: string;
  readonly busyTimeout: Duration.Duration;
  readonly catalogConnection: Connection;
}) => {
  const memory = root === MEMORY;
  let opened: Opened | undefined;
  const readers = new Map<number, Connection>();
  const groupFloor = new Map<string, number>();

  const fileOf = (startedAt: number): string => (memory ? MEMORY : join(root, 'segments', `${startedAt}.sqlite`));

  const rollDue = (segment: Segment, maxStoredBytes: number, now: number): boolean => {
    const hourEnd = (Math.floor(segment.startedAt / HOUR_MS) + 1) * HOUR_MS;
    return now >= hourEnd || segment.bytes >= segmentBytesFor(maxStoredBytes);
  };

  const weigh = Effect.fnUntraced(function* (segment: Segment, connection: Connection) {
    if (!memory) return fileBytes(fileOf(segment.startedAt));
    const pageSize = (yield* connection.db.all<{ page_size: number }>(sql`PRAGMA page_size`))[0]?.page_size ?? 0;
    const pageCount = (yield* connection.db.all<{ page_count: number }>(sql`PRAGMA page_count`))[0]?.page_count ?? 0;
    return pageSize * pageCount;
  });

  const reader = Effect.fnUntraced(function* (segment: Segment) {
    const held = opened;
    if (held !== undefined && held.segment.startedAt === segment.startedAt) return held.connection;
    const cached = readers.get(segment.startedAt);
    if (cached !== undefined) return cached;
    const connection = yield* openConnection(fileOf(segment.startedAt), { readonly: !memory, busyTimeout });
    yield* connection.db.run(sql.raw(`PRAGMA cache_size = -${READER_CACHE_KIB}`));
    readers.set(segment.startedAt, connection);
    return connection;
  });

  const readersFor = Effect.fnUntraced(function* (since: number | undefined, until: number | undefined) {
    const found: SegmentReader[] = [];
    for (const segment of catalog.overlapping(since, until)) {
      const connection = yield* reader(segment);
      found.push({ segment, db: connection.db });
    }
    return found as ReadonlyArray<SegmentReader>;
  });

  const prepareWriter = Effect.fnUntraced(function* (connection: Connection) {
    const db = connection.db;
    yield* db.run(sql`PRAGMA journal_mode = WAL`);
    yield* db.run(sql`PRAGMA synchronous = NORMAL`);
    yield* db.run(sql.raw(`PRAGMA cache_size = -${WRITER_CACHE_KIB}`));
    yield* db.run(sql.raw(`PRAGMA journal_size_limit = ${LOG_SIZE_LIMIT}`));
    for (const statement of SEGMENT_DDL) yield* db.run(sql.raw(statement));
  });

  const start = Effect.fnUntraced(function* () {
    const startedAt = Math.max(yield* Clock.currentTimeMillis, catalog.lastStartedAt + 1);
    const connection = yield* openConnection(fileOf(startedAt), { readonly: false, busyTimeout });
    yield* prepareWriter(connection);
    const segment = yield* catalog.add(startedAt, 'open');
    const started = { segment, connection };
    opened = started;
    return started;
  });

  const seal = Effect.fnUntraced(function* () {
    const open = opened;
    if (open === undefined) return;
    opened = undefined;
    const window = yield* readWindow(open.connection.db);
    if (!memory) {
      yield* open.connection.db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
      yield* Effect.ignore(open.connection.db.run(sql`PRAGMA journal_mode = DELETE`));
    }
    const bytes = yield* weigh(open.segment, open.connection);
    yield* catalog.seal(open.segment, window, bytes);
    if (memory) readers.set(open.segment.startedAt, open.connection);
    else yield* closeConnection(open.connection);
  });

  const writable = Effect.fnUntraced(function* (maxStoredBytes: number) {
    const open = opened;
    if (open !== undefined && !rollDue(open.segment, maxStoredBytes, yield* Clock.currentTimeMillis)) return open;
    if (open !== undefined) yield* seal();
    return yield* start();
  });

  const unlink = Effect.fnUntraced(function* (segment: Segment, at: number) {
    const reading = readers.get(segment.startedAt);
    if (reading !== undefined) {
      readers.delete(segment.startedAt);
      yield* closeConnection(reading);
    }
    if (!memory) {
      const file = fileOf(segment.startedAt);
      yield* Effect.sync(() => {
        for (const candidate of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) rmSync(candidate, { force: true });
      });
    }
    yield* catalog.remove(segment, at, instanceId);
  });

  return {
    catalog,
    root,
    memory,
    get all() {
      return readersFor(undefined, undefined);
    },
    readersFor,
    write: Effect.fnUntraced(function* (write: SegmentWrite, droppedKinds: LossKindCounts, maxStoredBytes: number) {
      const open = yield* writable(maxStoredBytes);
      if (write.rows.length > 0) {
        yield* open.connection.db.transaction(() =>
          Effect.gen(function* () {
            for (let at = 0; at < write.rows.length; at += write.chunk) {
              yield* open.connection.db.insert(performanceRecord).values(write.rows.slice(at, at + write.chunk));
            }
          }),
        );
        yield* catalog.observe(open.segment, { ...write, records: write.rows.length }, yield* weigh(open.segment, open.connection));
      }
      for (const group of write.groups) {
        const floor = groupFloor.get(group);
        if (floor === undefined || open.segment.startedAt < floor) groupFloor.set(group, open.segment.startedAt);
      }
      yield* catalog.addDrops(droppedKinds);
    }),
    maintain: Effect.fnUntraced(function* (maxStoredBytes: number, protectedGroups: ReadonlyArray<string>) {
      const startedAt = yield* monotonicMs;
      const held = new Set(protectedGroups);
      for (const group of [...groupFloor.keys()]) {
        if (!held.has(group)) groupFloor.delete(group);
      }
      const open = opened;
      if (open !== undefined) {
        catalog.resize(open.segment, yield* weigh(open.segment, open.connection));
        if (rollDue(open.segment, maxStoredBytes, yield* Clock.currentTimeMillis)) yield* seal();
      }
      if (catalog.storedBytes <= maxStoredBytes) {
        return { evicted: 0, records: 0, kinds: {}, elapsedMs: (yield* monotonicMs) - startedAt, blocked: false } satisfies EvictionStep;
      }
      let floor = Number.POSITIVE_INFINITY;
      for (const groupStart of groupFloor.values()) floor = Math.min(floor, groupStart);
      const lowWater = Math.max(0, maxStoredBytes - segmentBytesFor(maxStoredBytes));
      const kinds = new Map<PerformanceRecordKind, number>();
      let evicted = 0;
      let records = 0;
      const at = yield* Clock.currentTimeMillis;
      for (const segment of catalog.standing) {
        if (catalog.storedBytes <= lowWater) break;
        if (segment.state === 'open') break;
        if (segment.startedAt >= floor) break;
        for (const [kind, count] of segment.counts) kinds.set(kind, (kinds.get(kind) ?? 0) + count);
        records += segment.records;
        evicted += 1;
        yield* unlink(segment, at);
      }
      return {
        evicted,
        records,
        kinds: Object.fromEntries(kinds) as LossKindCounts,
        elapsedMs: (yield* monotonicMs) - startedAt,
        blocked: evicted === 0 && catalog.storedBytes > maxStoredBytes,
      } satisfies EvictionStep;
    }),
    get weight(): { readonly bytes: number; readonly segments: number } {
      return { bytes: catalog.storedBytes, segments: catalog.standing.length };
    },
    get logBytes(): number {
      return opened === undefined || memory ? 0 : logBytesOf(fileOf(opened.segment.startedAt));
    },
    get writer(): Database | undefined {
      return opened?.connection.db;
    },
    close: Effect.fnUntraced(function* () {
      const open = opened;
      opened = undefined;
      if (open !== undefined) yield* closeConnection(open.connection);
      for (const connection of readers.values()) yield* closeConnection(connection);
      readers.clear();
      yield* closeConnection(catalogConnection);
    }),
    refresh: catalog.load,
    release: Effect.fnUntraced(function* () {
      const held = [...readers.values()];
      readers.clear();
      for (const connection of held) yield* closeConnection(connection);
    }),
    reopen: Effect.fnUntraced(function* () {
      const stale = catalog.open;
      if (stale === undefined) return;
      const connection = yield* openConnection(fileOf(stale.startedAt), { readonly: false, busyTimeout });
      opened = { segment: stale, connection };
      yield* seal();
    }),
  };
};

export type SegmentRing = ReturnType<typeof makeRing>;

export const openSegmentRing = Effect.fnUntraced(function* (path: string, instanceId: string, busyTimeout: Duration.Duration) {
  const root = ringRoot(path);
  const memory = root === MEMORY;
  const catalogFile = memory ? MEMORY : join(root, 'catalog.sqlite');
  if (!memory) {
    let current = false;
    if (existsSync(catalogFile)) {
      const probe = yield* openConnection(catalogFile, { readonly: true, busyTimeout });
      current = yield* hasRingSchema(probe, root, busyTimeout).pipe(Effect.ensuring(closeConnection(probe)));
    }
    yield* discardTelemetryFile(path, busyTimeout);
    yield* Effect.try({
      try: () => {
        if (!current) rmSync(root, { recursive: true, force: true });
        mkdirSync(join(root, 'segments'), { recursive: true });
      },
      catch: (cause) => new SegmentOpenFailed({ message: String(cause) }),
    });
    if (!current) yield* Effect.logInfo('performance ring created for its current schema', { path: root });
  }
  const catalogConnection = yield* openConnection(catalogFile, { readonly: false, busyTimeout });
  let ring: SegmentRing | undefined;
  return yield* Effect.gen(function* () {
    yield* catalogConnection.db.run(sql`PRAGMA journal_mode = WAL`);
    yield* catalogConnection.db.run(sql`PRAGMA synchronous = NORMAL`);
    yield* catalogConnection.db.transaction(() =>
      Effect.gen(function* () {
        for (const statement of CATALOG_DDL) yield* catalogConnection.db.run(sql.raw(statement));
      }),
    );
    const catalog = makeSegmentCatalog(catalogConnection.db);
    yield* catalog.load();
    ring = makeRing({ catalog, root, instanceId, busyTimeout, catalogConnection });
    yield* ring.reopen();
    return ring;
  }).pipe(
    Effect.onExit((exit) =>
      Exit.isFailure(exit) ? (ring === undefined ? closeConnection(catalogConnection) : ring.close()) : Effect.void,
    ),
  );
});

export const watchSegmentRing = Effect.fnUntraced(function* (path: string, busyTimeout: Duration.Duration) {
  const root = ringRoot(path);
  const catalogFile = join(root, 'catalog.sqlite');
  if (root === MEMORY || !existsSync(catalogFile)) {
    return yield* new SegmentOpenFailed({ message: `no performance ring stands at ${root}` });
  }
  const catalogConnection = yield* openConnection(catalogFile, { readonly: true, busyTimeout });
  return yield* Effect.gen(function* () {
    if (!(yield* hasRingSchema(catalogConnection, root, busyTimeout))) {
      return yield* new SegmentOpenFailed({ message: `the performance ring at ${root} has a different schema` });
    }
    const catalog = makeSegmentCatalog(catalogConnection.db);
    yield* catalog.load();
    return makeRing({ catalog, root, instanceId: 'watch', busyTimeout, catalogConnection });
  }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? closeConnection(catalogConnection) : Effect.void)));
});
