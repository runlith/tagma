import { family, PAGE_CURSOR } from '@runlith/paging';
import { Schema } from 'effect';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';

export const MIN_EVERY_MS = 1000;

export const Cadence = Schema.Struct({
  name: Schema.NonEmptyString.annotate({ description: 'The owner-chosen name of this schedule, unique within its owner.' }),
  everyMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(MIN_EVERY_MS)).annotate({
    description: `Milliseconds between runs, at least ${MIN_EVERY_MS}.`,
  }),
});
export type Cadence = typeof Cadence.Type;

export const RUN_OUTCOMES = ['delivered', 'failed'] as const;

export const ScheduleRun = Schema.Struct({
  startedAt: Schema.Int,
  endedAt: Schema.Int,
  outcome: Schema.Literals(RUN_OUTCOMES),
  reason: Schema.NullOr(Schema.String),
  skipped: Schema.Int,
});
export type ScheduleRun = typeof ScheduleRun.Type;

export const ScheduleState = Schema.Struct({
  owner: Schema.String,
  name: Schema.String,
  everyMs: Schema.Int,
  nextAt: Schema.Int,
  running: Schema.Boolean,
  last: Schema.NullOr(ScheduleRun),
});
export type ScheduleState = typeof ScheduleState.Type;

export const SCHEDULE_ROWS = family('schedules', 1, 'json', { text: 420, json: 420 }, 'ceiling', () => ({
  owner: 'x'.repeat(40),
  name: 'x'.repeat(40),
  everyMs: 3_600_000,
  nextAt: 1_790_000_000_000,
  running: false,
  last: { startedAt: 1_790_000_000_000, endedAt: 1_790_000_000_000, outcome: 'failed', reason: 'x'.repeat(160), skipped: 12 },
}));

export const SCHEDULE_OPERATIONS = {
  read_schedules: operation('read_schedules', {
    approval: ASKS_NEVER,
    doors: { http: true },
    callers: 'operator',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: [],
    meaning:
      'Read the periodic runs this server keeps, ordered by owner and name: each with its cadence, the time of its next run and how its last run ended.',
    grammar:
      'A page of rows with the total; `next` is the cursor that continues the walk, null on the last page. Times are epoch milliseconds. A run that is due while the server was stopped or the machine slept happens once; `skipped` of the last run counts the ticks that were passed over, not queued. A failed last run carries its reason, and the next run still comes at `nextAt`.',
    input: Schema.Struct({ limit: limitOf(SCHEDULE_ROWS), cursor: PAGE_CURSOR }),
    answer: arms({
      read: {
        schedules: Schema.Array(ScheduleState),
        shown: Schema.Int,
        total: Schema.Int,
        next: Schema.NullOr(Schema.String),
        complete: Schema.Boolean,
      },
    }),
    refusals: ['bad-cursor', 'cursor-stale'],
    effect: 'read',
    identity: 'none',
    page: SCHEDULE_ROWS,
    subjects: () => [],
    confirmation: () => ({ summary: 'Read the schedules?' }),
    confirmLabel: 'Read schedules',
    presentation: { running: 'Reading the schedules', done: 'Read the schedules' },
  }),
};

export type ScheduleOperationId = keyof typeof SCHEDULE_OPERATIONS;
