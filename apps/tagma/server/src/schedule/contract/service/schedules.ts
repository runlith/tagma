import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Cadence, ScheduleState } from '../wire/schedule.js';

export type ScheduleKey = { readonly owner: string; readonly name: string };

export type ScheduleQuestion = { readonly after: ScheduleKey | null; readonly limit: number };

export type SchedulePage = { readonly rows: readonly ScheduleState[]; readonly total: number; readonly more: boolean };

export class Schedules extends Context.Service<
  Schedules,
  {
    declare(owner: string, cadences: readonly Cadence[]): Effect.Effect<void, StoreFailure>;
    read(question: ScheduleQuestion): Effect.Effect<SchedulePage>;
  }
>()('tagma/schedule/Schedules') {}
