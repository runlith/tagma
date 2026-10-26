import * as Effect from 'effect/Effect';
import type { CommandClass } from '@runlith/executions/protocol/command';
import type { StoredCommandRecord } from '../protocol/records.js';
import type { PerformanceQuery } from '../protocol/queries.js';
import type { PerformanceReportMeta } from '../protocol/reports.js';
import { PerformanceRecordUnreadable, type Readers, type ReportAnswer } from './answer.js';
import { timePage } from './page.js';
import { readRecord } from './record.js';

export const readCommands = Effect.fn('PerformanceWorker.readCommands')(function* (
  readers: Readers,
  query: Extract<PerformanceQuery, { readonly type: 'commands' }>,
  meta: PerformanceReportMeta,
) {
  const page = yield* timePage(readers, 'command', query);
  const commands: StoredCommandRecord[] = [];
  const folded = new Map<
    CommandClass,
    {
      count: number;
      failures: number;
      wallMs: number;
      maxWallMs: number;
      cpuMicros: number;
      maxPeakRssBytes: number;
      unmeasured: number;
    }
  >();
  for (const row of page.rows) {
    const record = yield* readRecord(row);
    if (record.kind !== 'command') return yield* new PerformanceRecordUnreadable({ recordId: row.id });
    commands.push(record);
    const payload = record.payload;
    const reading = folded.get(payload.class) ?? {
      count: 0,
      failures: 0,
      wallMs: 0,
      maxWallMs: 0,
      cpuMicros: 0,
      maxPeakRssBytes: 0,
      unmeasured: 0,
    };
    const wallMs = record.monotonicEnd - record.monotonicStart;
    reading.count += 1;
    if (payload.exit._tag !== 'Code' || payload.exit.code !== 0) reading.failures += 1;
    reading.wallMs += wallMs;
    reading.maxWallMs = Math.max(reading.maxWallMs, wallMs);
    if (payload.cost._tag === 'Measured') {
      reading.cpuMicros += payload.cost.cpuMicros;
      reading.maxPeakRssBytes = Math.max(reading.maxPeakRssBytes, payload.cost.peakRssBytes);
    } else {
      reading.unmeasured += 1;
    }
    folded.set(payload.class, reading);
  }
  const classes = [...folded.entries()]
    .map(([name, reading]) => ({ class: name, ...reading }))
    .sort((left, right) => right.cpuMicros - left.cpuMicros || right.count - left.count);
  return {
    _tag: 'Found',
    report: { type: 'commands', ...meta, classes, commands, evidence: 'retained-only', next: page.next },
  } satisfies ReportAnswer;
});
