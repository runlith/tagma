import { Context, Data, type Effect } from 'effect';
import type { ActivityLoss } from '../fact';
import type { ActivityOrder, ActivityPredicate } from './query';

export class ActivityUnreadable extends Data.TaggedError('ActivityUnreadable')<{ readonly reason: string }> {}

export type ActivityFreshLoss = ActivityLoss & { readonly at: number; readonly until: number };
export type ActivityFreshness = { readonly lost: readonly ActivityFreshLoss[] };

export type ActivityScope = {
  readonly threads?: readonly string[];
  readonly project?: number;
  readonly members?: string;
  readonly window?: ActivityWindow;
  readonly through: number;
  readonly since?: number;
  readonly reading?: string;
  readonly resumed?: true;
  readonly where: readonly ActivityPredicate[];
};

export type ActivityKey = { readonly openedAt: number; readonly id: string };

export type ActivityRowsQuery = ActivityScope & {
  readonly paths: readonly string[];
  readonly order?: ActivityOrder;
  readonly offset?: number;
  readonly limit: number;
};

export type ActivityRow = {
  readonly key: ActivityKey;
  readonly values: Readonly<Record<string, unknown>>;
};

export type ActivityRows = {
  readonly rows: readonly ActivityRow[];
  readonly more: boolean;
  readonly matched: number;
  readonly total: number;
  readonly threads: number;
  readonly reading: string;
  readonly next: number;
  readonly unavailable: readonly string[];
  readonly lost: readonly ActivityLoss[];
};

export type ActivityGroupsQuery = ActivityScope & {
  readonly group: readonly string[];
  readonly count: boolean;
  readonly sum: readonly string[];
  readonly order?: ActivityOrder;
  readonly offset: number;
  readonly limit: number;
};

export type ActivityGroup = {
  readonly by: Readonly<Record<string, unknown>>;
  readonly absent: readonly string[];
  readonly count: number;
  readonly sum: Readonly<Record<string, number>>;
  readonly unknown: Readonly<Record<string, number>>;
};

export type ActivityGroups = {
  readonly groups: readonly ActivityGroup[];
  readonly more: boolean;
  readonly matched: number;
  readonly total: number;
  readonly threads: number;
  readonly reading: string;
  readonly next: number;
  readonly lost: readonly ActivityLoss[];
};

export type ActivityWindow = { readonly project: number; readonly since?: number; readonly before?: number };

export type ActivityThreadsQuery = ActivityWindow & {
  readonly limit: number;
  readonly reading?: string;
  readonly after?: string;
  readonly ids?: readonly string[];
};
export type ActivityThreads = {
  readonly threads: readonly string[];
  readonly total: number;
  readonly reading: string;
  readonly after: string | null;
};

export type ActivityBodyState = 'written' | 'declined' | 'unwritten' | 'evicted';

export type ActivityBodyHeld = {
  readonly n: number;
  readonly kind: string;
  readonly contentType: string;
  readonly size: number;
  readonly bytes: number;
  readonly state: ActivityBodyState;
};

export type ActivityBodyText = { readonly text: string; readonly from: number; readonly bytes: number };

export class ActivityRecord extends Context.Service<
  ActivityRecord,
  {
    rows(query: ActivityRowsQuery): Effect.Effect<ActivityRows, ActivityUnreadable>;
    groups(query: ActivityGroupsQuery): Effect.Effect<ActivityGroups, ActivityUnreadable>;
    threads(query: ActivityThreadsQuery): Effect.Effect<ActivityThreads, ActivityUnreadable>;
    members(reading: string, threads: readonly string[]): Effect.Effect<void, ActivityUnreadable>;
    activity(id: string): Effect.Effect<Readonly<Record<string, unknown>> | null, ActivityUnreadable>;
    body(id: string, n: number, bytes: number, from?: number, thread?: string): Effect.Effect<ActivityBodyText, ActivityUnreadable>;
  }
>()('@runlith/activity/ActivityRecord') {}
