import { Schema } from 'effect';
import { Problem, Resolved } from './adapter';
import { Question } from './question';
import { Place, UnverifiedReason, UseKind } from './verdict';

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const Row = Schema.Union([
  Schema.TaggedStruct('use', {
    ...Place.fields,
    kind: UseKind,
    within: Schema.NullOr(Schema.String),
    via: Schema.NullOr(Schema.String),
  }),
  Schema.TaggedStruct('unverified', { ...Place.fields, reason: UnverifiedReason }),
  Schema.TaggedStruct('boundary', { path: Schema.String, reason: UnverifiedReason, matches: Count }),
]);
export type Row = typeof Row.Type;

export const Summary = Schema.Struct({
  others: Schema.Struct({
    matches: Count,
    symbols: Count,
  }),
  texts: Schema.Struct({ matches: Count, files: Count }),
  outside: Schema.Struct({ matches: Count, files: Count }),
  boundary: Schema.Array(Schema.Struct({ reason: UnverifiedReason, matches: Count, files: Count })),
  partial: Schema.Boolean,
});
export type Summary = typeof Summary.Type;

export const EngineReport = Schema.Struct({
  revision: Schema.String,
  lag: Count,
  warming: Schema.Boolean,
  stale: Schema.Array(Schema.String),
  problems: Schema.Array(Problem),
});
export type EngineReport = typeof EngineReport.Type;

export const Answer = Schema.Struct({
  question: Question,
  subject: Schema.NullOr(Resolved),
  rows: Schema.Array(Row),
  total: Count,
  next: Schema.NullOr(Schema.String),
  summary: Summary,
  engine: EngineReport,
});
export type Answer = typeof Answer.Type;

export const Refusal = Schema.Union([
  Schema.TaggedStruct('ambiguous', {
    candidates: Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String, line: Count })),
  }),
  Schema.TaggedStruct('missing', { detail: Schema.String }),
  Schema.TaggedStruct('expired', {}),
  Schema.TaggedStruct('bad-cursor', {}),
  Schema.TaggedStruct('search-failed', { detail: Schema.String }),
  Schema.TaggedStruct('engine-lost', { detail: Schema.String }),
  Schema.TaggedStruct('engine-failed', { detail: Schema.String }),
  Schema.TaggedStruct('engine-disabled', { detail: Schema.String }),
]);
export type Refusal = typeof Refusal.Type;
