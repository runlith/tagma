import * as SqliteClient from '@effect/sql-sqlite-bun/SqliteClient';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { join } from 'node:path';
import { scratchDirectory } from './testing/scratchDirectory.js';
import * as PerformanceTracer from './PerformanceTracer.js';
import { PerformanceStore, performanceStoreLayer } from './store/store.js';
import { PerformanceReports, performanceReportsLayer } from './PerformanceReports.js';

it.live('an Effect SQL span keeps explicit operation and table attributes but drops statement text', () =>
  Effect.gen(function* () {
    const directory = yield* scratchDirectory('performance-tracer-sql-');
    const path = join(directory, 'performance.sqlite');
    const page = yield* PerformanceStore.use((store) =>
      Effect.gen(function* () {
        const reports = yield* PerformanceReports;
        const tracer = yield* PerformanceTracer.make({ instanceId: 'process', recordFloorMicros: 0, keepOneTraceIn: () => 1 });
        yield* SqliteClient.SqliteClient.use((sql) => sql`select 1 as value`).pipe(
          Effect.provide(
            SqliteClient.layer({ filename: ':memory:', spanAttributes: { 'db.collection.name': 'example', secret: 'drop-me' } }),
          ),
          Effect.withTracer(tracer),
        );
        yield* store.flush;
        return yield* reports.read({ type: 'slow', name: 'sql.execute', limit: 10 });
      }),
    ).pipe(
      Effect.provide(
        performanceReportsLayer.pipe(
          Layer.provideMerge(
            performanceStoreLayer({ path, instanceId: 'process', maxPendingBytes: () => 1_000_000, maxStoredBytes: () => 8_000_000 }),
          ),
        ),
      ),
    );

    if (page.type !== 'slow') return yield* Effect.die('unexpected report');
    const sql = page.spans.find((record) => record.name === 'sql.execute');
    expect(sql?.payload).toMatchObject({
      attributes: { 'db.system.name': 'sqlite', 'db.operation.name': 'execute', 'db.collection.name': 'example' },
    });
    expect(JSON.stringify(sql?.payload)).not.toContain('select 1');
    expect(JSON.stringify(sql?.payload)).not.toContain('drop-me');
  }),
);
