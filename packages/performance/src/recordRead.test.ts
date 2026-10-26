import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { PerformanceRecordUnreadable, type Row } from './reports/answer.js';
import { readRecord } from './reports/record.js';

it.effect('a stored loss decodes its payload, and malformed JSON identifies the unreadable record', () =>
  Effect.gen(function* () {
    const row: Row = {
      id: 'old-loss',
      kind: 'loss',
      instanceId: 'older-process',
      wallTime: 100,
      monotonicStart: 80,
      monotonicEnd: 90,
      traceId: null,
      parentId: null,
      name: null,
      runId: null,
      payload: '{"reason":"pending-limit","kinds":{"span":2}}',
    };
    expect(yield* readRecord(row)).toEqual({
      id: 'old-loss',
      kind: 'loss',
      instanceId: 'older-process',
      wallTime: 100,
      monotonicStart: 80,
      monotonicEnd: 90,
      payload: { reason: 'pending-limit', kinds: { span: 2 } },
    });
    const invalid = yield* Effect.flip(readRecord({ ...row, payload: '{' }));
    expect(invalid).toBeInstanceOf(PerformanceRecordUnreadable);
    expect(invalid.recordId).toBe('old-loss');
  }),
);
