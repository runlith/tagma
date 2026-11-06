import { Context, type Effect } from 'effect';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import { ScheduledTools } from '../wire/contributions.js';
import type { Cadence } from '../wire/schedule.js';
import type { Ticks } from './ticks.js';

export const SCHEDULED = new ContributionPoint<never, ScheduledTools>('schedule/scheduled', {
  name: 'schedule',
  title: 'Runs on a schedule',
  schema: ScheduledTools,
});

export type ScheduleRegistration = (
  owner: string,
  cadences: readonly Cadence[],
  receiver: Ticks['Service'],
) => Effect.Effect<() => void, StoreFailure>;

export class ScheduleContributions extends Context.Service<
  ScheduleContributions,
  { declare(register: ScheduleRegistration): Effect.Effect<() => void> }
>()('schedule/Contributions') {}
