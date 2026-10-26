import { afterAll, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { it } from '@runlith/effect-test';
import { Duration, Effect } from 'effect';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReport, reportMeta } from './reports/dispatch.js';
import { openSegmentRing, SegmentOpenFailed, type SegmentRing, ringRoot, watchSegmentRing } from './SegmentRing.js';
import { SEGMENT_DDL } from './schema.js';
import type { InitializeStore } from './store/wire.js';

const directory = mkdtempSync(join(tmpdir(), 'performance-schema-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const timeout = Duration.seconds(1);

const loss = {
  id: 'kept-loss',
  kind: 'loss' as const,
  instanceId: 'process',
  wallTime: 100,
  monotonicStart: 80,
  monotonicEnd: 90,
  payload: '{"reason":"pending-limit","kinds":{"span":2}}',
};

const write = (ring: SegmentRing) =>
  ring.write(
    {
      rows: [loss],
      kinds: new Map([['loss', 1]]),
      firstWallTime: 100,
      lastWallTime: 100,
      groups: new Set(),
      chunk: 1,
    },
    { span: 2 },
    1024 * 1024,
  );

const losses = Effect.fnUntraced(function* (ring: SegmentRing, path: string) {
  const options: InitializeStore = { _tag: 'InitializeStore', path, instanceId: 'process', maxStoredBytes: 1024 * 1024 };
  const answer = yield* readReport(ring, options, { type: 'losses', limit: 2 }, reportMeta(ring));
  if (answer._tag !== 'Found' || answer.report.type !== 'losses') return yield* Effect.die('the losses report was not answered');
  return answer.report;
});

const ringAt = (path: string, instanceId: string) =>
  Effect.acquireRelease(openSegmentRing(path, instanceId, timeout), (ring) => ring.close());

const seedPrevious = (path: string) => {
  const root = ringRoot(path);
  mkdirSync(join(root, 'segments'), { recursive: true });
  const catalog = new Database(join(root, 'catalog.sqlite'));
  try {
    catalog.exec(`create table performance_segment (
      started_at integer primary key not null, shape text not null, state text not null,
      first_wall_time integer not null, last_wall_time integer not null, bytes integer not null,
      records integer not null, counts text not null, deleted_at integer, deleted_by text
    );
    create index performance_segment_window_idx on performance_segment (state, first_wall_time, last_wall_time);
    create table performance_meta (key text primary key not null, value integer not null);
    insert into performance_meta values ('format', 1), ('drop_count', 2), ('drop_kind_span', 2);
    insert into performance_segment
      (started_at, shape, state, first_wall_time, last_wall_time, bytes, records, counts)
      values (10, 'native', 'sealed', 100, 100, 4096, 1, '{"loss":1}');`);
  } finally {
    catalog.close();
  }
  const segment = new Database(join(root, 'segments', '10.sqlite'));
  try {
    for (const statement of SEGMENT_DDL) segment.exec(statement);
    segment.exec(`insert into performance_record (id, kind, instance_id, wall_time, monotonic_start, monotonic_end, payload)
      values ('prior-loss', 'loss', 'prior-process', 100, 80, 90, '{"reason":"pending-limit","kinds":{"span":2}}')`);
  } finally {
    segment.close();
  }
};

it.live('a ring from the previous build is recreated and records new telemetry', () =>
  Effect.gen(function* () {
    const path = join(directory, 'previous.sqlite');
    seedPrevious(path);
    const ring = yield* ringAt(path, 'process');
    expect(ring.weight).toEqual({ bytes: 0, segments: 0 });
    expect(ring.catalog.dropCount).toBe(0);
    expect((yield* losses(ring, path)).losses).toEqual([]);
    yield* write(ring);
    expect((yield* losses(ring, path)).losses.map((record) => record.id)).toEqual(['kept-loss']);
  }),
);

it.live('reopening and watching the current schema preserves records and drop counters', () =>
  Effect.gen(function* () {
    const path = join(directory, 'current.sqlite');
    const first = yield* openSegmentRing(path, 'first', timeout);
    yield* write(first);
    yield* first.close();
    const second = yield* ringAt(path, 'second');
    expect((yield* losses(second, path)).losses.map((record) => record.id)).toEqual(['kept-loss']);
    expect(second.catalog.dropCount).toBe(2);
    expect(second.catalog.droppedByKind).toEqual({ span: 2 });
    const watcher = yield* Effect.acquireRelease(watchSegmentRing(path, timeout), (ring) => ring.close());
    expect((yield* losses(watcher, path)).losses.map((record) => record.id)).toEqual(['kept-loss']);
  }),
);

it.live('a changed segment schema refuses a watcher, then the writer recreates the whole ring', () =>
  Effect.gen(function* () {
    const path = join(directory, 'segment.sqlite');
    const first = yield* openSegmentRing(path, 'first', timeout);
    yield* write(first);
    const at = first.catalog.standing[0]!.startedAt;
    yield* first.close();
    const changed = new Database(join(ringRoot(path), 'segments', `${at}.sqlite`));
    changed.exec('alter table performance_record add column unexpected text');
    changed.close();
    expect(yield* Effect.flip(watchSegmentRing(path, timeout))).toBeInstanceOf(SegmentOpenFailed);
    const retained = new Database(join(ringRoot(path), 'segments', `${at}.sqlite`), { readonly: true });
    expect(retained.query('select id from performance_record').all()).toEqual([{ id: 'kept-loss' }]);
    retained.close();
    const second = yield* ringAt(path, 'second');
    expect(second.weight).toEqual({ bytes: 0, segments: 0 });
    expect(second.catalog.dropCount).toBe(0);
    yield* write(second);
    expect((yield* losses(second, path)).losses.map((record) => record.id)).toEqual(['kept-loss']);
  }),
);

it.live('a missing segment refuses opening without deleting the surviving evidence or its loss account', () =>
  Effect.gen(function* () {
    const path = join(directory, 'missing.sqlite');
    const first = yield* openSegmentRing(path, 'first', timeout);
    yield* write(first);
    const at = first.catalog.standing[0]!.startedAt;
    yield* first.catalog.add(10, 'sealed');
    yield* first.close();
    const failure = yield* Effect.flip(openSegmentRing(path, 'second', timeout));
    expect(failure).toBeInstanceOf(SegmentOpenFailed);
    const evidence = new Database(join(ringRoot(path), 'segments', `${at}.sqlite`), { readonly: true });
    try {
      expect(evidence.query('select id from performance_record').all()).toEqual([{ id: 'kept-loss' }]);
    } finally {
      evidence.close();
    }
    const catalog = new Database(join(ringRoot(path), 'catalog.sqlite'), { readonly: true });
    try {
      expect(catalog.query('select count(*) as segments from performance_segment').get()).toEqual({ segments: 2 });
      expect(catalog.query("select value from performance_meta where key = 'drop_count'").get()).toEqual({ value: 2 });
    } finally {
      catalog.close();
    }
  }),
);

it.live('a standalone telemetry file is replaced with an empty ring rather than imported', () =>
  Effect.gen(function* () {
    const path = join(directory, 'standalone.sqlite');
    const file = new Database(path);
    for (const statement of SEGMENT_DDL) file.exec(statement);
    file.exec(`insert into performance_record (id, kind, instance_id, wall_time, monotonic_start, monotonic_end, payload)
    values ('prior-loss', 'loss', 'prior-process', 100, 80, 90, '{"reason":"pending-limit","kinds":{"span":2}}')`);
    file.close();
    const ring = yield* ringAt(path, 'process');
    expect((yield* losses(ring, path)).losses).toEqual([]);
    expect(existsSync(path)).toBe(false);
    yield* write(ring);
    expect((yield* losses(ring, path)).losses.map((record) => record.id)).toEqual(['kept-loss']);
  }),
);

it.live('an in-memory ring records telemetry without a disk catalog', () =>
  Effect.gen(function* () {
    const ring = yield* ringAt(':memory:', 'process');
    yield* write(ring);
    expect((yield* losses(ring, ':memory:')).losses.map((record) => record.id)).toEqual(['kept-loss']);
  }),
);
