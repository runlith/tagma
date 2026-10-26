import { Schema } from 'effect';
import { runStatusSchema } from '@runlith/agent/protocol/http';
import { family } from '@runlith/paging';

export const STATUSES = family('statuses', 1, 'json', { text: 640, json: 1_000 }, 50, () => ({
  threadId: '01a0cab9-6847-7602-bed6-3503d2788ccf',
  outcome: 'found',
  status: {
    threadId: '01a0cab9-6847-7602-bed6-3503d2788ccf',
    runId: '01a0cab9-6847-7602-bed6-3503d2788ccf',
    life: 'awaiting',
    stage: 'awaiting-question',
    openQuestions: ['01a0cab9-6847-7602-bed6-3503d2788ccf'],
    since: '2026-10-02T20:24:16.059Z',
    ownership: 'stale-evidence',
    ending: {
      runId: '01a0cab9-6847-7602-bed6-3503d2788ccf',
      status: 'failed',
      stoppedBy: null,
      failureReason: 'x'.repeat(80),
      finishedAt: '2026-10-02T20:24:16.059Z',
      notification: 'notification-exhausted',
    },
    receipts: [
      {
        key: 'x'.repeat(40),
        status: 'steered',
        runId: '01a0cab9-6847-7602-bed6-3503d2788ccf',
        itemId: `input:external.${'x'.repeat(12)}:${'x'.repeat(40)}`,
        occurredAt: '2026-10-02T20:24:16.059Z',
      },
    ],
  },
}));

export const STATUS_MISSING = ['not-found', 'foreign-project'] as const;

export const statusRowSchema = Schema.Union([
  Schema.Struct({ threadId: Schema.String, outcome: Schema.Literal('found'), status: runStatusSchema }),
  Schema.Struct({ threadId: Schema.String, outcome: Schema.Literals(STATUS_MISSING) }),
]);

export type StatusRowOnTheWire = typeof statusRowSchema.Type;
