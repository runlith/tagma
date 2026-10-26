import { Context, Effect } from 'effect';
import type { ActivityFact } from './fact';

export interface ActivityLog {
  record(fact: ActivityFact): void;
  readonly settled: Effect.Effect<void>;
}

export const unrecorded: ActivityLog = { record: () => {}, settled: Effect.void };

export const ActivityLog = Context.Reference<ActivityLog>('@runlith/activity/ActivityLog', {
  defaultValue: () => unrecorded,
});
