import { Schema } from 'effect';
import { threadNotificationSchema } from '@runlith/agent/thread/storage/settlement';
import { family } from '@runlith/paging';
import { STATUS_MISSING } from './statuses.js';

export const ENDING_DEPTH = 3;

export const ENDINGS = family('endings', 1, 'json', { text: 900, json: 1_500 }, 10, () => ({
  threadId: '01a0cab9-6847-7602-bed6-3503d2788ccf',
  outcome: 'found',
  endings: [
    {
      runId: '01a0cab9-6847-7602-bed6-3503d2788ccf',
      threadId: '01a0cab9-6847-7602-bed6-3503d2788ccf',
      status: 'failed',
      stoppedBy: null,
      failureReason: 'x'.repeat(120),
      finishedAt: '2026-10-02T20:24:16.059Z',
      notification: {
        state: 'notification-exhausted',
        reclaims: 5,
        maxReclaims: 5,
        confirmedAt: null,
        claimExpiresAt: '2026-10-02T20:24:46.059Z',
        evidence: 'recorded',
        attempt: null,
      },
    },
  ],
}));

export const runEndingSchema = Schema.Struct({
  runId: Schema.String,
  threadId: Schema.String,
  status: Schema.Literals(['completed', 'failed', 'aborted', 'cut', 'withdrawn']),
  stoppedBy: Schema.NullOr(Schema.Literals(['reader', 'parent', 'agent', 'model'])),
  failureReason: Schema.NullOr(Schema.String),
  finishedAt: Schema.String,
  notification: threadNotificationSchema,
});

export const endingRowSchema = Schema.Union([
  Schema.Struct({ threadId: Schema.String, outcome: Schema.Literal('found'), endings: Schema.Array(runEndingSchema) }),
  Schema.Struct({ threadId: Schema.String, outcome: Schema.Literals(STATUS_MISSING) }),
]);

export type EndingRowOnTheWire = typeof endingRowSchema.Type;

export type RedeliveryOnTheWire = 'redelivering' | 'not-exhausted' | 'run-not-found';
