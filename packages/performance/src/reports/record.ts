import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import type { StoredPerformanceRecord } from '../protocol/records.js';
import { performanceRecordSchema } from '../protocol/records.js';
import { PerformanceRecordUnreadable, type Row } from './answer.js';

export const readRecord = Effect.fn('PerformanceWorker.readRecord')(function* (
  row: Row,
): Effect.fn.Return<StoredPerformanceRecord, PerformanceRecordUnreadable> {
  const payload = yield* Effect.try({
    try: () => JSON.parse(row.payload),
    catch: () => new PerformanceRecordUnreadable({ recordId: row.id }),
  });
  const fields = {
    id: row.id,
    instanceId: row.instanceId,
    wallTime: row.wallTime,
    monotonicStart: row.monotonicStart,
    monotonicEnd: row.monotonicEnd,
  };
  const raw = (() => {
    switch (row.kind) {
      case 'span':
        return {
          ...fields,
          kind: row.kind,
          traceId: row.traceId,
          parentId: row.parentId,
          name: row.name,
          payload,
        };
      case 'metric':
        return { ...fields, kind: row.kind, name: row.name, payload };
      case 'stall':
      case 'vital':
      case 'profile':
      case 'memory':
      case 'loss':
      case 'command':
      case 'load':
        return { ...fields, kind: row.kind, payload };
    }
  })();
  return yield* Schema.decodeUnknownEffect(performanceRecordSchema)(raw).pipe(
    Effect.mapError(() => new PerformanceRecordUnreadable({ recordId: row.id })),
  );
});
