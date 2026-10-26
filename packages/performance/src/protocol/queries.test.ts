import { expect, test } from 'bun:test';
import { Schema } from 'effect';
import { performanceQuerySchema } from './queries.js';
import { overviewReportSchema, slowReportSchema } from './reports.js';

test('heavy report pages refuse limits beyond their carrier envelope', () => {
  const decode = Schema.decodeUnknownResult(performanceQuerySchema);
  for (const [query, ceiling] of [
    [{ type: 'slow', name: 'CheckoutStatus.reading' }, 57],
    [{ type: 'overview', since: 0, until: 1 }, 20],
  ] as const) {
    expect(decode({ ...query, limit: ceiling })._tag).toBe('Success');
    expect(decode({ ...query, limit: ceiling + 1 })._tag).toBe('Failure');
    expect(decode({ ...query, limit: 0 })._tag).toBe('Failure');
  }
});

test('the admitted calibration pages fit the serialized operation envelope', () => {
  const meta = { inheritedDrops: 0, sessionDrops: 0, inheritedDroppedKinds: {}, sessionDroppedKinds: {}, retainedRange: null };
  const span = {
    id: '5a51b0ba8c854844',
    instanceId: 'e7907727-6b5a-4428-a060-d7b1171052dc',
    wallTime: 1792062185906,
    monotonicStart: 44218694.875208,
    monotonicEnd: 44229760.041623995,
    kind: 'span',
    traceId: '8cbb967433c2953be3dc48c850411379',
    parentId: null,
    name: 'CheckoutStatus.reading',
    payload: {
      spanKind: 'internal',
      exit: { _tag: 'Success' },
      attributes: {
        'connection.generation': 1,
        'checkout.root': '01a13f2f-cbbd-7f31-96b9-83c5729ad478',
        'checkout.path': '/Users/someone/.tagma-dev/worktrees/runlith/probe-step-compaction',
        'checkout.reason': 'unnamed',
        'checkout.readers': 2,
        'queue.ms': 0,
      },
    },
  };
  const boundariesMs = Array.from({ length: 34 }, (_, index) => 0.5 * 2 ** index);
  const series = {
    name: 'CheckoutStatus.reading',
    boundaryKey: JSON.stringify(boundariesMs),
    boundariesMs,
    bucketCounts: Array(35).fill(0),
    count: 123456,
    failures: 1234,
    sumMs: 123456789.123456,
    p50: { upperBoundMs: 256 },
    p99: { upperBoundMs: 32768 },
    partial: true,
    reasons: ['missing-baseline', 'reset', 'boundary-change', 'clipped-since', 'clipped-until'],
  };
  const reports = [
    Schema.decodeUnknownSync(slowReportSchema)({ ...meta, type: 'slow', total: null, spans: Array(57).fill(span), next: null }),
    Schema.decodeUnknownSync(overviewReportSchema)({
      ...meta,
      type: 'overview',
      total: null,
      since: 0,
      until: 1,
      observed: null,
      coverageReason: null,
      samplesRead: 20,
      series: Array(20).fill(series),
      stoppedAtBudget: false,
      next: null,
    }),
  ];
  for (const performance of reports) {
    const text = JSON.stringify({ status: 'ok', performance }, null, 2);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(50 * 1024);
    expect(text.split('\n').length).toBeLessThanOrEqual(2000);
  }
});
