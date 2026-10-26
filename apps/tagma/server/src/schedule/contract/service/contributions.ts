import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Cadence } from '../wire/schedule.js';
import type { Ticks } from './ticks.js';

export type ScheduleRegistration = (
  owner: string,
  cadences: readonly Cadence[],
  receiver: Ticks['Service'],
) => Effect.Effect<() => void, StoreFailure>;

export class ScheduleContributions extends Context.Service<
  ScheduleContributions,
  { declare(register: ScheduleRegistration): Effect.Effect<() => void> }
>()('schedule/Contributions') {}
