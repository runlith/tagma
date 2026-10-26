import * as Schema from 'effect/Schema';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { loadSubjectKindSchema } from './records.js';

const nonEmptyString = Schema.String.check(Schema.isMinLength(1));
const positiveLimit = Schema.Int.check(Schema.isGreaterThan(0));
const nonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const nonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const reportLimit = (rowBytes: number, rowLines: number) =>
  positiveLimit.check(Schema.isLessThanOrEqualTo(Math.min(Math.floor((50 * 1024 - 2048) / rowBytes), Math.floor((2000 - 64) / rowLines))));

export const PERFORMANCE_QUERY_TYPES = [
  'memory',
  'captures',
  'growth',
  'names',
  'stalls',
  'stall',
  'slow',
  'trace',
  'breakdown',
  'vitals',
  'metrics',
  'overview',
  'profiles',
  'profile',
  'losses',
  'commands',
  'load',
] as const;

export const timeCursorSchema = Schema.Struct({ wallTime: nonNegativeInt, id: nonEmptyString });
export type TimeCursor = typeof timeCursorSchema.Type;

export const slowCursorSchema = Schema.Struct({
  durationMs: nonNegativeNumber,
  wallTime: nonNegativeInt,
  id: nonEmptyString,
});
export type SlowCursor = typeof slowCursorSchema.Type;

export const metricCursorSchema = Schema.Struct({ hourStart: nonNegativeInt, boundaryKey: nonEmptyString });
export type MetricCursor = typeof metricCursorSchema.Type;

export const overviewCursorSchema = Schema.Struct({ name: nonEmptyString, boundaryKey: nonEmptyString });
export type OverviewCursor = typeof overviewCursorSchema.Type;

const listTimeFields = {
  since: Schema.optional(nonNegativeInt),
  limit: positiveLimit,
  after: Schema.optional(timeCursorSchema),
} as const;

const retainedName = nonEmptyString.annotate({
  description: 'A retained span or metric name. Use type names to list the names the store currently holds.',
});

export const memoryQuerySchema = Schema.Struct({ type: Schema.tag('memory') });
export type MemoryQuery = typeof memoryQuerySchema.Type;

export const capturesQuerySchema = Schema.Struct({ type: Schema.tag('captures'), ...listTimeFields });
export type CapturesQuery = typeof capturesQuerySchema.Type;
export const growthQuerySchema = Schema.Struct({
  type: Schema.tag('growth'),
  id: nonEmptyString,
  against: Schema.optional(nonEmptyString),
});
export type GrowthQuery = typeof growthQuerySchema.Type;

export const NAME_KINDS = ['metric', 'span'] as const;
export const namesCursorSchema = Schema.Struct({
  span: Schema.optional(nonEmptyString),
  metric: Schema.optional(nonEmptyString),
});
export type NamesCursor = typeof namesCursorSchema.Type;

export const namesQuerySchema = Schema.Struct({
  type: Schema.tag('names'),
  since: Schema.optional(nonNegativeInt),
  limit: positiveLimit,
  after: Schema.optional(namesCursorSchema),
});
export type NamesQuery = typeof namesQuerySchema.Type;
export const stallsQuerySchema = Schema.Struct({ type: Schema.tag('stalls'), ...listTimeFields });
export type StallsQuery = typeof stallsQuerySchema.Type;
export const stallQuerySchema = Schema.Struct({
  type: Schema.tag('stall'),
  id: nonEmptyString,
  limit: Schema.optional(positiveLimit),
  after: Schema.optional(timeCursorSchema),
});
export type StallQuery = typeof stallQuerySchema.Type;
export const slowQuerySchema = Schema.Struct({
  type: Schema.tag('slow'),
  name: retainedName,
  since: Schema.optional(nonNegativeInt),
  limit: reportLimit(856, 25),
  after: Schema.optional(slowCursorSchema),
});
export type SlowQuery = typeof slowQuerySchema.Type;
export const traceCursorSchema = Schema.Struct({
  instanceId: nonEmptyString,
  monotonicStart: Schema.Number,
  id: nonEmptyString,
});
export type TraceCursor = typeof traceCursorSchema.Type;

export const traceQuerySchema = Schema.Struct({
  type: Schema.tag('trace'),
  traceId: nonEmptyString,
  spanId: Schema.optional(
    nonEmptyString.annotate({
      description: 'Descend: this span and everything under it, instead of the whole trace.',
    }),
  ),
  limit: positiveLimit,
  after: Schema.optional(traceCursorSchema),
});
export type TraceQuery = typeof traceQuerySchema.Type;

export const breakdownCursorSchema = Schema.Struct({
  coveredMs: nonNegativeNumber.check(Schema.isFinite()),
  id: nonEmptyString,
});
export type BreakdownCursor = typeof breakdownCursorSchema.Type;
export const breakdownQuerySchema = Schema.Struct({
  type: Schema.tag('breakdown'),
  id: nonEmptyString.annotate({ description: 'The retained span record whose direct children explain its elapsed time.' }),
  limit: positiveLimit,
  after: Schema.optional(breakdownCursorSchema),
});
export type BreakdownQuery = typeof breakdownQuerySchema.Type;

export const vitalsQuerySchema = Schema.Struct({ type: Schema.tag('vitals'), ...listTimeFields });
export type VitalsQuery = typeof vitalsQuerySchema.Type;
export const lossesQuerySchema = Schema.Struct({
  type: Schema.tag('losses'),
  ...listTimeFields,
  source: Schema.optional(
    Schema.Literal('live').annotate({
      description:
        'Read current pressure and loss counters from process memory without waiting for the worker; retained loss windows are not read.',
    }),
  ),
});
export type LossesQuery = typeof lossesQuerySchema.Type;
export const commandsQuerySchema = Schema.Struct({ type: Schema.tag('commands'), ...listTimeFields });
export type CommandsQuery = typeof commandsQuerySchema.Type;
export const loadQuerySchema = Schema.Struct({
  type: Schema.tag('load'),
  ...listTimeFields,
  subject: Schema.optional(loadSubjectKindSchema),
  execution: Schema.optional(ExecutionRef),
  threadId: Schema.optional(nonEmptyString),
  stepMs: positiveLimit,
});
export type LoadQuery = typeof loadQuerySchema.Type;
export const metricsQuerySchema = Schema.Struct({
  type: Schema.tag('metrics'),
  name: retainedName,
  since: Schema.optional(nonNegativeInt),
  limit: positiveLimit,
  after: Schema.optional(metricCursorSchema),
});
export type MetricsQuery = typeof metricsQuerySchema.Type;
export const overviewQuerySchema = Schema.Struct({
  type: Schema.tag('overview'),
  since: nonNegativeInt,
  until: nonNegativeInt,
  limit: reportLimit(1805, 94),
  after: Schema.optional(overviewCursorSchema),
}).pipe(
  Schema.check(Schema.makeFilter((query) => (query.since < query.until ? undefined : 'Overview requires since strictly before until.'))),
);
export type OverviewQuery = typeof overviewQuerySchema.Type;
export const profilesQuerySchema = Schema.Struct({ type: Schema.tag('profiles'), ...listTimeFields });
export type ProfilesQuery = typeof profilesQuerySchema.Type;
export const profileQuerySchema = Schema.Struct({
  type: Schema.tag('profile'),
  id: nonEmptyString,
  limit: Schema.optional(positiveLimit),
  raw: Schema.optional(Schema.Boolean),
});
export type ProfileQuery = typeof profileQuerySchema.Type;

export const performancePointQuerySchema = Schema.Union([
  stallQuerySchema,
  profileQuerySchema,
  growthQuerySchema,
  breakdownQuerySchema,
]).pipe(Schema.toTaggedUnion('type'));
export type PerformancePointQuery = typeof performancePointQuerySchema.Type;

export const performanceQuerySchema = Schema.Union([
  memoryQuerySchema,
  capturesQuerySchema,
  growthQuerySchema,
  namesQuerySchema,
  stallsQuerySchema,
  stallQuerySchema,
  slowQuerySchema,
  traceQuerySchema,
  breakdownQuerySchema,
  vitalsQuerySchema,
  metricsQuerySchema,
  overviewQuerySchema,
  profilesQuerySchema,
  profileQuerySchema,
  lossesQuerySchema,
  commandsQuerySchema,
  loadQuerySchema,
]).pipe(Schema.toTaggedUnion('type'));
export type PerformanceQuery = typeof performanceQuerySchema.Type;
