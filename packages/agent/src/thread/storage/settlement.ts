import { Schema } from 'effect';
import { uuidv7 } from 'uuidv7';
import type { ThreadRunRow } from '../rows';

export const threadSettledBySchema = Schema.NullOr(Schema.Literals(['reader', 'parent', 'agent', 'model']));

export const threadRunStopRequestSchema = Schema.Struct({
  by: threadSettledBySchema,
  key: Schema.optional(Schema.String),
  marker: Schema.Boolean,
  withdraw: Schema.Boolean,
  at: Schema.String,
});
export type ThreadRunStopRequest = typeof threadRunStopRequestSchema.Type;

const reason = Schema.Struct({
  kind: Schema.Literals(['failure', 'defect', 'interruption']),
  tag: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.String),
  message: Schema.String,
  detail: Schema.String,
  fiberId: Schema.NullOr(Schema.Int),
});
const phase = Schema.Literals(['publication', 'subscriber', 'confirmation']);
const failure = Schema.Struct({
  attemptId: Schema.NullOr(Schema.String),
  at: Schema.String,
  phase,
  subscriber: Schema.NullOr(Schema.String),
  cause: Schema.Array(reason),
});

export const threadNotificationRecordSchema = Schema.Struct({
  id: Schema.String,
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  phase,
  subscriber: Schema.NullOr(Schema.String),
  delivered: Schema.Array(Schema.String),
  exhaustedAt: Schema.NullOr(Schema.String),
  lastFailure: Schema.NullOr(failure),
  observationFailure: Schema.NullOr(failure),
});
export type ThreadNotificationRecord = typeof threadNotificationRecordSchema.Type;

export const threadNotificationSchema = Schema.Struct({
  state: Schema.Literals(['confirmed', 'claimed', 'retry-wait', 'notification-exhausted']),
  reclaims: Schema.Int,
  maxReclaims: Schema.Int,
  confirmedAt: Schema.NullOr(Schema.String),
  claimExpiresAt: Schema.String,
  evidence: Schema.Literals(['recorded', 'unavailable']),
  attempt: Schema.NullOr(threadNotificationRecordSchema),
});
export type ThreadNotification = typeof threadNotificationSchema.Type;

export function seedThreadNotification(runId: string, at: Date, previous: ThreadNotificationRecord | null): ThreadNotificationRecord {
  return {
    id: `${runId}:${uuidv7()}`,
    startedAt: at.toISOString(),
    finishedAt: null,
    phase: 'publication',
    subscriber: null,
    delivered: previous?.delivered ?? [],
    exhaustedAt: null,
    lastFailure: previous?.lastFailure ?? null,
    observationFailure: previous?.observationFailure ?? null,
  };
}

export function mergedStopRequest(
  standing: ThreadRunStopRequest | null,
  intent: { readonly by: ThreadRunStopRequest['by']; readonly marker: boolean; readonly withdraw: boolean; readonly key?: string },
  at: Date,
): ThreadRunStopRequest {
  if (standing === null) return { by: intent.by, marker: intent.marker, withdraw: intent.withdraw, key: intent.key, at: at.toISOString() };
  return {
    by: standing.by === 'model' && intent.by !== 'model' ? intent.by : (standing.by ?? intent.by),
    key: standing.key ?? intent.key,
    marker: standing.marker || intent.marker,
    withdraw: standing.withdraw || intent.withdraw,
    at: standing.at,
  };
}

export function threadNotification(
  row: ThreadRunRow,
  rhythm: { readonly settledClaimAfterMs: number; readonly settledNotifyAttemptLimit: number },
  now: Date,
): ThreadNotification | null {
  if (row.status === 'running') return null;
  const attempt = row.settledNotification;
  const expires = row.heartbeatAt.getTime() + rhythm.settledClaimAfterMs;
  const freshClaim = attempt !== null && attempt.finishedAt === null && expires >= now.getTime();
  return {
    state:
      row.settledNotifiedAt !== null
        ? 'confirmed'
        : freshClaim
          ? 'claimed'
          : row.settledNotifyAttempts >= rhythm.settledNotifyAttemptLimit
            ? 'notification-exhausted'
            : 'retry-wait',
    reclaims: row.settledNotifyAttempts,
    maxReclaims: rhythm.settledNotifyAttemptLimit,
    confirmedAt: row.settledNotifiedAt?.toISOString() ?? null,
    claimExpiresAt: new Date(expires).toISOString(),
    evidence: attempt === null ? 'unavailable' : 'recorded',
    attempt,
  };
}
