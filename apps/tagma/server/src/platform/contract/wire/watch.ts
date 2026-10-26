import { Schema } from 'effect';

export const WATCH_RESCANS = ['unnamed', 'rename', 'error', 'lost', 'opened', 'polling'] as const;

export const WatchRescan = Schema.Literals(WATCH_RESCANS);
export type WatchRescan = typeof WatchRescan.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const WatchedPlace = Schema.Struct({
  at: Schema.String,
  recursive: Schema.Boolean,
  state: Schema.Literals(['watching', 'parked']),
  since: Schema.Number,
  events: Count,
  rescans: Schema.Record(WatchRescan, Count),
});
export type WatchedPlace = typeof WatchedPlace.Type;

export const WatchReading = Schema.Struct({
  places: Schema.Array(WatchedPlace),
  total: Count,
});
export type WatchReading = typeof WatchReading.Type;
