import { Context, type Effect, type Stream } from 'effect';
import type { ActivityLoss } from '../fact';
import type { ActivityFaultKind } from '../fault';
import type { ActivityUnreadable } from './record';

export type ActivityFault = {
  readonly fingerprint: string;
  readonly kind: ActivityFaultKind;
  readonly place: string;
  readonly message: string;
  readonly stack: string | null;
  readonly count: number;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly activity: string;
  readonly thread: string | null;
  readonly run: string | null;
  readonly project: number | null;
};

export type ActivityFaultCursor = { readonly lastAt: number; readonly fingerprint: string };

export type ActivityFaultsQuery = { readonly limit: number; readonly after?: ActivityFaultCursor };

export type ActivityFaultsPage = {
  readonly faults: readonly ActivityFault[];
  readonly total: number;
  readonly since: number;
  readonly next: ActivityFaultCursor | null;
  readonly lost: readonly ActivityLoss[];
};

export class ActivityFaults extends Context.Service<
  ActivityFaults,
  {
    read(query: ActivityFaultsQuery): Effect.Effect<ActivityFaultsPage, ActivityUnreadable>;
    since(now: number): number;
    readonly clear: Effect.Effect<void, ActivityUnreadable>;
    readonly changes: Stream.Stream<void>;
  }
>()('@runlith/activity/ActivityFaults') {}
